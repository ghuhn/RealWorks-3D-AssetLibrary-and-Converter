# Project Memory & Change Log

## Current State (As of Jun 17, 2026)
- **Backend (Blender & Python Pipeline):** The core 3D conversion pipeline (`blender/convert.py`) now features a completely operational **Two-Stage AI Material Mapping** system. 
  - **Stage 1:** Lightning-fast Text-Only LLM Mapping via Gemini 2.5 Flash using semantic logic.
  - **Stage 2:** A Visual Language Model (VLM) fallback triggered automatically when names are arbitrary. It securely generates synthetic neon emission masks using Eevee in headless mode to completely bypass Blender C++ crashes.
  - **Output:** Outputs `.usd` files perfectly and writes dual copies of the mapped `texture_map.json` to both the original asset folder and the converted library directory.
  - **Stability:** Hardened with auto-retries for Google API server overloads (e.g., 503, 429), dynamic Blender 4.2+ engine detection (`EEVEE_NEXT`), recursive deep-folder texture scraping (`os.walk`), and a dedicated `debug_log.txt` for catching silent Tauri process failures.
- **Frontend (Tauri + React + Vite):** A pristine, hyper-modern interface leveraging Tailwind CSS and Shadcn UI components. Features dedicated screens for Asset Browsing, Queue processing, Logging, and App Configuration.

---

## Change Log

### [Jun 10, 2026] Massive UI Revamp (Merge PR #4)
**Context:** Pulled `frontend_design` from `manisha1124`.
- **Frontend Overhaul:** Completely scrapped the legacy MVP UI (`src/App.tsx`, `src/index.css`) in favor of a vastly expanded, component-driven architecture.
- **Frameworks Integrated:** Added **TailwindCSS** (`styles/tailwind.css`) and over 40+ **Shadcn UI** components (`app/components/ui/*` including sidebars, dialogs, charts, and carousels).
- **Screens Added/Refactored:**
  - `Library.tsx`: Now an advanced 500+ line grid with asset browsing and fallback image handlers (`ImageWithFallback.tsx`).
  - `Settings.tsx`: Beautifully designed configuration hub for the Blender path, Output Library, and Gemini API Keys.
  - `Queue.tsx` & `Logs.tsx`: Robust monitoring views for backend conversion tasks.
- **Global State:** Created a comprehensive React context (`AppContext.tsx`) and global `Layout.tsx` for state sharing.
- **Backend Tweaks:** Minor dependency bumps in `src-tauri/Cargo.toml` and subtle adjustments to `main.rs` to keep the Python execution calls compatible with the new Settings state.

### [Jun 09-10, 2026] The "Headless AI" Pipeline Rewrite
**Context:** Building the generative 3D pipeline on the backend.
- Hand-coded the Two-Stage AI architecture into `convert.py` without breaking the original, perfectly functioning mesh extraction logic.
- Traced and destroyed a hidden `Segmentation Fault` triggered by Blender's Headless Workbench engine. Invented a novel workaround that replaces object materials with flat Eevee Emission shaders to snap VLM screenshots dynamically.
- Intercepted a fatal Python `os` scope bug and a hardcoded folder-search bug that was causing the script to bypass folders misspelled as `texure`.
- Patched in comprehensive crash and debug logging.

### [Jun 10, 2026] Stability & Pipeline Hardening
**Context:** Squashing critical bugs related to UI blinking, duplicate assets, and missing textures.
- **Duplicate Handling:** Modified `convert.py` to actively check for an existing `metadata.json` in the library destination. It now seamlessly preserves the original asset `uuid` during reconversions to prevent duplicates in the UI.
- **WebView OOM Protection:** Fixed a memory overflow in the Rust backend (`main.rs`) where printing thousands of log lines crashed the Tauri WebView. Implemented a strict 1000-character truncation (`chars().take(1000)`) before streaming `stdout` to the frontend.
- **Hot-Reload Death Spiral (The "Blinking UI" Bug):** Discovered that saving `debug_log.txt` into the `blender/` folder was triggering `cargo tauri dev` file watchers. This caused the backend to violently restart in an infinite loop, crashing the React state and making the Queue UI disappear. **Fix:** Relocated all debug logs to the OS Temporary Directory (`tempfile.gettempdir()`) completely outside the project workspace.
- **Smart Sibling Texture Search:** Added a highly efficient fallback mechanism to `convert.py`. If the script finds zero textures next to the `.fbx` (which skips the AI step), it safely steps up one directory and scans sibling folders specifically named `textures`, `maps`, `matlibs`, `images`, etc. This ensures completely broken FBX assets still get fully mapped by the AI without aggressively scanning the user's entire hard drive.

### [Jun 11, 2026] Scene Segmentation & Pipeline Hardening
**Context:** Ensuring the `.blend` scene batch exporter works flawlessly and resolving silent background crashes.
- **Queue Manifest Handling:** Upgraded the Rust backend (`main.rs`) to properly stream the `QUEUE_MANIFEST` from `convert.py`, allowing the React UI to dynamically update with the individual assets sliced out of large scenes.
- **Geometry Inclusion:** Patched `segment_scene` to include `CURVE`, `SURFACE`, `META`, and `FONT` objects alongside standard meshes so architectural assets no longer go "undetected".
- **Global State Texture Bug:** Fixed a critical bug in `collect_textures_for_objects` where Blender's global `img.filepath` was permanently mutated during the first asset export, completely breaking texture extraction for all subsequent assets in the batch. File paths are now strictly tracked and restored post-export.
- **Regex Path Sanitization:** AI-generated asset names like "Pedestals / Blocks" were crashing Python with `[WinError 3]` during folder creation. Names and categories are now aggressively sanitized of illegal Windows characters before being passed to `os.makedirs` and the Rust manifest.
- **Log Accessibility:** Moved `usd_converter_debug_log.txt` and `usd_converter_crash_log.txt` to the user's Asset Library destination folder to ensure visibility during UI refreshes without triggering Tauri hot-reload lockups.

### [Jun 12, 2026] Architecture Planning: Procedural Asset Clustering
**Context:** Planning a replacement for the Text-LLM based asset grouping, which struggles with unorganized / poorly-named blend files.
- **Designed Pipeline:** Outlined a `Segmentation -> Masking -> Isolation -> Ray-casting` pipeline using purely mathematical physics (Bounding Boxes / AABBs for Broad-Phase and BVH trees for Narrow-Phase collision). This will physically fuse overlapping assets into groups, bypassing naming conventions entirely and reserving the LLM solely for assigning names to the final clusters.

### [Jun 15-16, 2026] Extended File Format Expansion
**Context:** Expanding app compatibility beyond standard 3D files to include `.max`, `.dxf`, `.3ds`, and CAD (`.step`, `.igs`, `.iges`).
- **React & Rust Expansion:** Overhauled `AppContext.tsx` file pickers and the Rust batch listener to officially accept the new legacy and CAD formats.
- **Built-in Blender Modules:** Programmed `convert.py` to seamlessly detect and auto-enable Blender's dormant `io_import_dxf` and `io_scene_3ds` modules.
- **MAX Integration & Factory Bug:** Added support for importing 3ds Max files using the community `io_scene_max` extension. Discovered and fixed a critical bug where `bpy.ops.wm.read_factory_settings(use_empty=True)` was automatically unloading user extensions upon script startup, crashing the `.max` imports. Replaced it with a manual scene deletion loop.
- **Headless FreeCAD Integration:** Built a Python subprocess bridge that automatically intercepts CAD formats (`.step`, `.igs`, `.iges`), launches the user's `FreeCADCmd.exe` silently in the background to tessellate the NURBS mathematical data into temporary `.obj` files, and pipes them effortlessly into Blender for USD conversion.

### [Jun 17, 2026] UI Refinements & Styling Overhaul
**Context:** Pulled latest commits from `main`.
- **Global Typography:** Integrated Google's `Inter` font as the default sans-serif font across the entire Tailwind application.
- **Sonner Toast Redesign:** Completely overhauled the Sonner toast CSS to feature a highly customized, grid-based notification design. Toasts now support structured titles, descriptions, and sleek dark mode tokens. Updated `Settings.tsx` to utilize this new structure on save.
- **Queue Experience:** Improved the Queue table by distinctly labeling completed tasks with a green "Completed" badge instead of just "100%", and fixed time formatting.
- **Scrollbar & Layout:** Added a custom, minimalistic scrollbar across the application and removed deprecated settings (Theme toggles and USDZ compression checkboxes) from the configuration screen.
