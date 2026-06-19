// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;
use chrono::Utc;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Settings {
    blender_path: String,
    library_path: String,
    debug_blend_path: String,
    gemini_api_key: String,
    ai_provider: String,
    ai_model: String,
    ai_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Asset {
    id: String,
    name: String,
    category: String,
    tags: String,
    path: String,
    thumbnail: String,
    source_format: String,
    animated: bool,
    created_at: String,
    size_bytes: u64,
}

fn get_dir_size(path: impl AsRef<Path>) -> u64 {
    let mut size = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_dir() {
                    size += get_dir_size(entry.path());
                } else {
                    size += metadata.len();
                }
            }
        }
    }
    size
}

struct AppState {
    db: Mutex<Connection>,
    settings: Mutex<Settings>,
}

fn init_db(app_dir: &Path) -> Connection {
    let db_path = app_dir.join("library.db");
    let conn = Connection::open(db_path).expect("Failed to open database");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY,
            name TEXT,
            category TEXT,
            tags TEXT,
            path TEXT,
            thumbnail TEXT,
            source_format TEXT,
            animated INTEGER,
            created_at DATETIME
        )",
        [],
    )
    .expect("Failed to create assets table");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY,
            blender_path TEXT,
            library_path TEXT,
            debug_blend_path TEXT,
            gemini_api_key TEXT
        )",
        [],
    )
    .expect("Failed to create settings table");
    
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN debug_blend_path TEXT DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN gemini_api_key TEXT DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN ai_provider TEXT DEFAULT 'Google Gemini'", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN ai_model TEXT DEFAULT 'gemini-2.5-flash'", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN ai_url TEXT DEFAULT ''", []);

    // Insert default settings if not exists
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
        .unwrap_or(0);

    if count == 0 {
        conn.execute(
            "INSERT INTO settings (id, blender_path, library_path, debug_blend_path, gemini_api_key, ai_provider, ai_model, ai_url) VALUES (1, '', '', '', '', 'Google Gemini', 'gemini-2.5-flash', '')",
            [],
        )
        .expect("Failed to insert default settings");
    }

    conn
}

fn load_settings(conn: &Connection) -> Settings {
    conn.query_row(
        "SELECT blender_path, library_path, debug_blend_path, gemini_api_key, ai_provider, ai_model, ai_url FROM settings WHERE id = 1",
        [],
        |row| {
            Ok(Settings {
                blender_path: row.get(0)?,
                library_path: row.get(1)?,
                debug_blend_path: row.get(2).unwrap_or("".to_string()),
                gemini_api_key: row.get(3).unwrap_or("".to_string()),
                ai_provider: row.get(4).unwrap_or("Google Gemini".to_string()),
                ai_model: row.get(5).unwrap_or("gemini-2.5-flash".to_string()),
                ai_url: row.get(6).unwrap_or("".to_string()),
            })
        },
    )
    .unwrap_or(Settings {
        blender_path: "".to_string(),
        library_path: "".to_string(),
        debug_blend_path: "".to_string(),
        gemini_api_key: "".to_string(),
        ai_provider: "Google Gemini".to_string(),
        ai_model: "gemini-2.5-flash".to_string(),
        ai_url: "".to_string(),
    })
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(settings: Settings, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    conn.execute(
        "UPDATE settings SET blender_path = ?1, library_path = ?2, debug_blend_path = ?3, gemini_api_key = ?4, ai_provider = ?5, ai_model = ?6, ai_url = ?7 WHERE id = 1",
        params![settings.blender_path, settings.library_path, settings.debug_blend_path, settings.gemini_api_key, settings.ai_provider, settings.ai_model, settings.ai_url],
    )
    .map_err(|e| e.to_string())?;

    *state.settings.lock().unwrap() = settings;
    Ok(())
}

#[tauri::command]
fn get_assets(state: State<AppState>) -> Result<Vec<Asset>, String> {
    let conn = state.db.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, name, category, tags, path, thumbnail, source_format, animated, created_at FROM assets ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let asset_iter = stmt
        .query_map([], |row| {
            Ok(Asset {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                tags: row.get(3)?,
                path: row.get(4)?,
                thumbnail: row.get(5)?,
                source_format: row.get(6)?,
                animated: {
                    let a: i32 = row.get(7)?;
                    a != 0
                },
                created_at: row.get(8)?,
                size_bytes: 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let settings = state.settings.lock().unwrap();
    let library_path = PathBuf::from(&settings.library_path);

    let mut assets = Vec::new();
    for asset in asset_iter {
        if let Ok(mut a) = asset {
            let asset_dir = library_path.join(&a.category).join(&a.name);
            a.size_bytes = get_dir_size(asset_dir);
            
            if !a.thumbnail.is_empty() {
                let full_path = library_path.join(&a.category).join(&a.name).join(&a.thumbnail);
                a.thumbnail = full_path.to_string_lossy().to_string();
            }
            assets.push(a);
        }
    }

    Ok(assets)
}

#[tauri::command]
async fn convert_asset(path: String, is_batch: bool, state: State<'_, AppState>, _app: AppHandle) -> Result<(), String> {
    use tokio::process::Command;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use std::process::Stdio;
    use tauri::Emitter;

    let settings = state.settings.lock().unwrap().clone();
    
    if settings.blender_path.is_empty() || settings.library_path.is_empty() {
        return Err("Blender path or library path is not configured".into());
    }

    let paths_to_process = if is_batch {
        let mut files = Vec::new();
        if let Ok(entries) = fs::read_dir(&path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
                        let ext = ext.to_lowercase();
                        if ["fbx", "obj", "glb", "gltf", "blend", "dae", "stl", "ply", "usd", "usda", "usdz", "max", "dxf", "igs", "iges", "step", "3ds"].contains(&ext.as_str()) {
                            files.push(p.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
        files
    } else {
        vec![path]
    };

    let current_dir = std::env::current_dir().unwrap();
    let mut script_path = current_dir.join("blender").join("convert.py");
    
    if !script_path.exists() {
        if let Some(parent) = current_dir.parent() {
            script_path = parent.join("blender").join("convert.py");
        }
    }

    if !script_path.exists() {
        return Err(format!("Conversion script not found at: {:?}", script_path));
    }

    for file_path in paths_to_process {
        println!("Converting {}", file_path);
        
        let mut child = Command::new(&settings.blender_path)
            .arg("--background")
            .arg("--python")
            .arg(&script_path)
            .arg("--")
            .arg(&file_path)
            .arg(&settings.library_path)
            .arg("Uncategorized")
            .arg(&settings.debug_blend_path)
            .arg(&settings.gemini_api_key)
            .arg(&settings.ai_provider)
            .arg(&settings.ai_model)
            .arg(&settings.ai_url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn blender: {}", e))?;

        let stdout = child.stdout.take().unwrap();
        let mut reader = BufReader::new(stdout).lines();
        
        let mut generated_assets = Vec::new();
        let mut raw_stdout = String::new();

        while let Ok(Some(line)) = reader.next_line().await {
            raw_stdout.push_str(&line);
            raw_stdout.push('\n');
            
            if line.starts_with("QUEUE_MANIFEST: ") {
                let json_str = line.trim_start_matches("QUEUE_MANIFEST: ");
                if let Ok(manifest) = serde_json::from_str::<Vec<serde_json::Value>>(json_str) {
                    for item in &manifest {
                        if let (Some(name), Some(cat)) = (item["name"].as_str(), item["category"].as_str()) {
                            generated_assets.push((name.to_string(), cat.to_string()));
                        }
                    }
                    // Emit event to frontend
                    let _ = _app.emit("queue-manifest", manifest.clone());
                }
            }
        }
        
        let status = child.wait().await.map_err(|e| format!("Failed to wait: {}", e))?;

        if !status.success() {
            if raw_stdout.len() > 1000 {
                raw_stdout = format!("{}... [TRUNCATED, length: {}]", raw_stdout.chars().take(1000).collect::<String>(), raw_stdout.len());
            }
            return Err(format!("Blender conversion failed.\nStdout: {}", raw_stdout));
        }

        if generated_assets.is_empty() {
            let asset_name = Path::new(&file_path).file_stem().unwrap().to_string_lossy().to_string();
            generated_assets.push((asset_name, "Uncategorized".to_string()));
        }

        for (asset_name, category) in generated_assets {
            let metadata_path = Path::new(&settings.library_path).join(&category).join(&asset_name).join("metadata.json");
            
            if metadata_path.exists() {
                if let Ok(content) = fs::read_to_string(&metadata_path) {
                    if let Ok(metadata) = serde_json::from_str::<serde_json::Value>(&content) {
                        let id = metadata["id"].as_str().map(|s| s.to_string()).unwrap_or_else(|| Uuid::new_v4().to_string());
                        let name = metadata["name"].as_str().unwrap_or(&asset_name).to_string();
                        let category = metadata["category"].as_str().unwrap_or(&category).to_string();
                        let tags = metadata["tags"].as_array().map(|a| a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(",")).unwrap_or_default();
                        let source_format = metadata["source_format"].as_str().unwrap_or("").to_string();
                        let thumbnail = metadata["thumbnail"].as_str().unwrap_or("").to_string();
                        let asset_path = metadata["asset_path"].as_str().unwrap_or("").to_string();
                        let animated = metadata["animated"].as_bool().unwrap_or(false);
                        let created_at = Utc::now().to_rfc3339();

                        let conn = state.db.lock().unwrap();
                        let _ = conn.execute(
                            "INSERT OR REPLACE INTO assets (id, name, category, tags, path, thumbnail, source_format, animated, created_at) 
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                            params![id, name, category, tags, asset_path, thumbnail, source_format, animated, created_at],
                        );
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn delete_asset(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    
    let (name, category): (String, String) = conn.query_row(
        "SELECT name, category FROM assets WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| format!("Asset not found: {}", e))?;

    let settings = state.settings.lock().unwrap();
    let lib_path = Path::new(&settings.library_path);
    let asset_dir = lib_path.join(&category).join(&name);

    if asset_dir.exists() {
        if let Err(e) = trash::delete(&asset_dir) {
            return Err(format!("Failed to move asset to recycle bin: {}", e));
        }
    }

    conn.execute("DELETE FROM assets WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete from database: {}", e))?;

    Ok(())
}

#[tauri::command]
fn update_asset_tags(id: String, tags: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    let tags_str = tags.join(",");

    let (name, category): (String, String) = conn.query_row(
        "SELECT name, category FROM assets WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| format!("Asset not found: {}", e))?;

    conn.execute(
        "UPDATE assets SET tags = ?1 WHERE id = ?2",
        params![tags_str, id],
    ).map_err(|e| format!("Failed to update database: {}", e))?;

    let settings = state.settings.lock().unwrap();
    let lib_path = Path::new(&settings.library_path);
    let metadata_path = lib_path.join(&category).join(&name).join("metadata.json");

    if metadata_path.exists() {
        if let Ok(content) = fs::read_to_string(&metadata_path) {
            if let Ok(mut metadata) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(obj) = metadata.as_object_mut() {
                    let tags_value = serde_json::Value::Array(
                        tags.into_iter().map(serde_json::Value::String).collect()
                    );
                    obj.insert("tags".to_string(), tags_value);
                }
                
                if let Ok(new_content) = serde_json::to_string_pretty(&metadata) {
                    let _ = fs::write(&metadata_path, new_content);
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let cmd = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(cmd)
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn get_texture_files(category: String, name: String, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let settings = state.settings.lock().unwrap();
    let textures_path = Path::new(&settings.library_path).join(&category).join(&name).join("textures");
    
    let mut files = Vec::new();
    if textures_path.exists() && textures_path.is_dir() {
        if let Ok(entries) = fs::read_dir(textures_path) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        if let Some(file_name) = entry.file_name().to_str() {
                            files.push(file_name.to_string());
                        }
                    }
                }
            }
        }
    }
    
    Ok(files)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_dir = app.path().app_local_data_dir().unwrap_or_else(|_| PathBuf::from("."));
            if !app_dir.exists() {
                fs::create_dir_all(&app_dir).unwrap();
            }
            let db = init_db(&app_dir);
            let settings = load_settings(&db);

            app.manage(AppState {
                db: Mutex::new(db),
                settings: Mutex::new(settings),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_assets,
            convert_asset,
            delete_asset,
            update_asset_tags,
            open_folder,
            get_texture_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
