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
    
    // Add debug_blend_path column if it doesn't exist (migration)
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN debug_blend_path TEXT DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN gemini_api_key TEXT DEFAULT ''", []);

    // Insert default settings if not exists
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
        .unwrap_or(0);

    if count == 0 {
        conn.execute(
            "INSERT INTO settings (id, blender_path, library_path, debug_blend_path, gemini_api_key) VALUES (1, '', '', '', '')",
            [],
        )
        .expect("Failed to insert default settings");
    }

    conn
}

fn load_settings(conn: &Connection) -> Settings {
    conn.query_row(
        "SELECT blender_path, library_path, debug_blend_path, gemini_api_key FROM settings WHERE id = 1",
        [],
        |row| {
            Ok(Settings {
                blender_path: row.get(0)?,
                library_path: row.get(1)?,
                debug_blend_path: row.get(2).unwrap_or("".to_string()),
                gemini_api_key: row.get(3).unwrap_or("".to_string()),
            })
        },
    )
    .unwrap_or(Settings {
        blender_path: "".to_string(),
        library_path: "".to_string(),
        debug_blend_path: "".to_string(),
        gemini_api_key: "".to_string(),
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
        "UPDATE settings SET blender_path = ?1, library_path = ?2, debug_blend_path = ?3, gemini_api_key = ?4 WHERE id = 1",
        params![settings.blender_path, settings.library_path, settings.debug_blend_path, settings.gemini_api_key],
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
            })
        })
        .map_err(|e| e.to_string())?;

    let mut assets = Vec::new();
    for asset in asset_iter {
        if let Ok(a) = asset {
            assets.push(a);
        }
    }

    // Fix thumbnail paths to be absolute based on library_path
    let settings = state.settings.lock().unwrap();
    let lib_path = Path::new(&settings.library_path);
    
    for asset in &mut assets {
        if !asset.thumbnail.is_empty() {
            let full_path = lib_path.join(&asset.category).join(&asset.name).join(&asset.thumbnail);
            asset.thumbnail = full_path.to_string_lossy().to_string();
        }
    }

    Ok(assets)
}

#[tauri::command]
async fn convert_asset(path: String, is_batch: bool, state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    
    if settings.blender_path.is_empty() || settings.library_path.is_empty() {
        return Err("Blender path or library path is not configured".into());
    }

    // In batch mode, path is a directory. For simplicity in MVP, we just handle single files via this command.
    // The frontend should ideally read the dir and call this command per file, or we handle it here.
    let paths_to_process = if is_batch {
        let mut files = Vec::new();
        if let Ok(entries) = fs::read_dir(&path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
                        let ext = ext.to_lowercase();
                        if ["fbx", "obj", "glb", "gltf", "blend", "dae", "stl", "ply", "usd", "usda", "usdz"].contains(&ext.as_str()) {
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


        
    // In dev mode, blender/convert.py is in the root workspace. Let's use the absolute path if available or relative
    // For MVP, assume it's in the current working directory under blender/convert.py
    let current_dir = std::env::current_dir().unwrap();
    let mut script_path = current_dir.join("blender").join("convert.py");
    
    // If running from src-tauri during dev mode, check the parent directory
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
        
        let output = Command::new(&settings.blender_path)
            .arg("--background")
            .arg("--python")
            .arg(&script_path)
            .arg("--")
            .arg(&file_path)
            .arg(&settings.library_path)
            .arg("Uncategorized")
            .arg(&settings.debug_blend_path)
            .arg(&settings.gemini_api_key)
            .output()
            .map_err(|e| format!("Failed to execute blender: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(format!("Blender conversion failed.\nStdout: {}\nStderr: {}", stdout, stderr));
        }

        // The python script creates the metadata.json inside the output directory.
        // Let's read it and insert it into the database.
        let asset_name = Path::new(&file_path).file_stem().unwrap().to_string_lossy().to_string();
        let metadata_path = Path::new(&settings.library_path).join("Uncategorized").join(&asset_name).join("metadata.json");
        
        if metadata_path.exists() {
            if let Ok(content) = fs::read_to_string(&metadata_path) {
                if let Ok(metadata) = serde_json::from_str::<serde_json::Value>(&content) {
                    let id = metadata["id"].as_str().map(|s| s.to_string()).unwrap_or_else(|| Uuid::new_v4().to_string());
                    let name = metadata["name"].as_str().unwrap_or(&asset_name).to_string();
                    let category = metadata["category"].as_str().unwrap_or("Uncategorized").to_string();
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

    Ok(())
}

fn main() {
    tauri::Builder::default()
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
            convert_asset
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
