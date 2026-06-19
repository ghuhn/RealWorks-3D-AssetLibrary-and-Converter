# RealWorks 3D Asset Library - AI Conversion Pipeline Rules

This document outlines key architectural constraints, known bugs, and workflow rules regarding the Blender-based asset conversion pipeline used in this Tauri application.

## 1. Tauri to Blender Communication
- The Tauri backend (Rust) spawns Blender in a headless subprocess (`Command::new(...)`) to run the `blender/convert.py` script.
- **Silent Failure Warning:** Blender 4.3 runs Python 3.11. If `convert.py` has a `SyntaxError` (e.g., using `\` in an f-string expression), Blender's headless mode may silently log the traceback to `stderr` and still exit with a success code (`0`). Always verify syntax compatibility up to Python 3.11 and do not solely rely on the Rust backend's `status.success()` to guarantee the script didn't crash on import.
- **Manifest Synchronization:** The Python script communicates successfully converted assets back to the Rust backend by printing `QUEUE_MANIFEST: [{"name": "Asset", "category": "Cat"}]` to `stdout`. The Rust backend reads this exact string to know where to locate the generated `metadata.json`.

## 2. Universal AI Integration
- The Python script (`blender/convert.py`) utilizes a custom `call_ai_universal` function for all LLM/VLM tasks (scene segmentation, texture heuristics, and visual tagging) to avoid external library dependencies (uses native `urllib.request`).
- **Local LLM Fallback:** The conversion pipeline supports offline "Local / Custom (Ollama/LM Studio)" models. The AI bridge natively handles connection timeouts.
- **Graceful Degradation:** If the AI fails to group meshes (returns `None`), the pipeline MUST catch this explicitly and gracefully fallback to exporting objects as individual "Uncategorized" meshes, rather than silently discarding them.

## 3. Directory and Category Synchronization
- The Python script generates a temporary category for the output directory before invoking the VLM for visual tagging.
- If the AI returns a *new* category, the script **must** physically move (`shutil.move`) the directory to the new category path before saving the final `metadata.json`. 
- The Python script **must** emit the final `QUEUE_MANIFEST` *after* all directory moves so the Rust backend can correctly locate and index the `metadata.json` in the database. Failure to do this will result in the frontend UI rendering empty placeholders and broken folder links.

## 4. Token Optimization
- When prompting the LLM/VLM for tags, strictly limit the request to a small number (e.g., exactly 5 tags) to optimize token usage and avoid bloating the SQLite database.
