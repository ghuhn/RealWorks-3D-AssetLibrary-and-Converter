import bpy
import sys
import os
import json
import uuid
import shutil
import math
import mathutils
from datetime import datetime

import os
import sys
import tempfile

# Attempt to extract output_dir from sys.argv early to save the log there
log_dir = tempfile.gettempdir()
if "--" in sys.argv:
    try:
        args_after = sys.argv[sys.argv.index("--") + 1:]
        if len(args_after) >= 2:
            log_dir = args_after[1]
    except Exception:
        pass

ASSET_CATEGORIES = [
    "Vehicles", "Vegetation", "Mythical Creatures", "Characters", "Creatures",
    "Furniture", "Appliances", "Fittings", "Buildings", "Animals",
    "Weapons", "Decor", "FX", "Decals", "Food", "Props", "Sports",
]
_CATEGORY_LIST_STR = ", ".join(ASSET_CATEGORIES)

def _normalize_category(raw, fallback="Props"):
    """Return the canonical ASSET_CATEGORIES entry matching raw (case-insensitive), or fallback."""
    stripped = raw.strip().lower()
    for c in ASSET_CATEGORIES:
        if c.lower() == stripped:
            return c
    return fallback

log_path = os.path.join(log_dir, 'usd_converter_debug_log.txt')
try:
    DEBUG_LOG = open(log_path, 'w')
except Exception:
    log_path = os.path.join(tempfile.gettempdir(), 'usd_converter_debug_log.txt')
    DEBUG_LOG = open(log_path, 'w')
    
def my_print(*args):
    msg = ' '.join(str(a) for a in args)
    print(msg)
    DEBUG_LOG.write(msg + '\n')
    DEBUG_LOG.flush()

def call_ai_universal(provider, api_key, model, url, prompt_text, b64_images=[]):
    import urllib.request, urllib.error, json, time
    max_retries = 3

    for attempt in range(max_retries):
        try:
            req = None
            if provider == "Google Gemini":
                if not api_key:
                    my_print(f"DEBUG: LLM skipped — no API key for Google Gemini")
                    return None, "No API Key provided"
                endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                parts = [{"text": prompt_text}]
                for b64 in b64_images:
                    parts.append({"inlineData": {"mimeType": "image/jpeg", "data": b64}})
                payload = {
                    "contents": [{"parts": parts}],
                    "generationConfig": {"responseMimeType": "application/json"}
                }
                req = urllib.request.Request(endpoint, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
                my_print(f"DEBUG: LLM call → Gemini {model} (attempt {attempt+1})")

            elif provider in ["OpenAI", "Local / Custom (Ollama/LM Studio)"]:
                endpoint = url if provider == "Local / Custom (Ollama/LM Studio)" else "https://api.openai.com/v1/chat/completions"
                if not endpoint:
                    my_print(f"DEBUG: LLM skipped — no endpoint URL for {provider}. Set it in Settings → Endpoint URL.")
                    return None, "No endpoint URL provided"
                
                content = [{"type": "text", "text": prompt_text}]
                for b64 in b64_images:
                    content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
                
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": content}]
                }
                if "vision" not in model.lower() and "llava" not in model.lower():
                    payload["response_format"] = {"type": "json_object"}
                
                headers = {'Content-Type': 'application/json'}
                if api_key: headers['Authorization'] = f"Bearer {api_key}"
                req = urllib.request.Request(endpoint, data=json.dumps(payload).encode('utf-8'), headers=headers)
                my_print(f"DEBUG: LLM call → {provider} {model} @ {endpoint[:60]} (attempt {attempt+1})")

            elif provider == "Anthropic":
                if not api_key:
                    my_print(f"DEBUG: LLM skipped — no API key for Anthropic")
                    return None, "No API Key provided"
                endpoint = "https://api.anthropic.com/v1/messages"
                content = [{"type": "text", "text": prompt_text}]
                for b64 in b64_images:
                    content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}})

                payload = {
                    "model": model,
                    "max_tokens": 1024,
                    "messages": [{"role": "user", "content": content}]
                }
                headers = {
                    'Content-Type': 'application/json',
                    'x-api-key': api_key,
                    'anthropic-version': '2023-06-01'
                }
                req = urllib.request.Request(endpoint, data=json.dumps(payload).encode('utf-8'), headers=headers)
                my_print(f"DEBUG: LLM call → Anthropic {model} (attempt {attempt+1})")

            if req is None:
                my_print(f"DEBUG: LLM skipped — unrecognised provider {provider!r}")
                return None, "Unknown provider"
            
            import ssl as _ssl
            _ssl_ctx = _ssl.create_default_context()
            # Blender ships its own Python on Linux without system certs — try known cert stores
            for _cert in ('/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/cert.pem'):
                if os.path.exists(_cert):
                    try: _ssl_ctx = _ssl.create_default_context(cafile=_cert)
                    except Exception: pass
                    break
            with urllib.request.urlopen(req, context=_ssl_ctx) as response:
                res_data = json.loads(response.read().decode('utf-8'))
                llm_text = ""
                if provider == "Google Gemini":
                    llm_text = res_data['candidates'][0]['content']['parts'][0]['text']
                elif provider in ["OpenAI", "Local / Custom (Ollama/LM Studio)"]:
                    llm_text = res_data['choices'][0]['message']['content']
                elif provider == "Anthropic":
                    llm_text = res_data['content'][0]['text']
                    
                llm_text = llm_text.replace('```json', '').replace('```', '').strip()
                try:
                    return json.loads(llm_text), llm_text
                except:
                    # Fallback for messy json
                    start_idx = llm_text.find('{')
                    end_idx = llm_text.rfind('}') + 1
                    if start_idx != -1 and end_idx != -1:
                        return json.loads(llm_text[start_idx:end_idx]), llm_text
                    
                    start_idx_arr = llm_text.find('[')
                    end_idx_arr = llm_text.rfind(']') + 1
                    if start_idx_arr != -1 and end_idx_arr != -1:
                        return json.loads(llm_text[start_idx_arr:end_idx_arr]), llm_text
                        
                    return None, llm_text
                    
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < max_retries - 1:
                my_print(f"DEBUG: AI HTTP Error {e.code}. Retrying in 5s...")
                time.sleep(5)
            else:
                my_print(f"DEBUG: AI HTTP Error {e.code}: {e.read().decode('utf-8')}")
                break
        except Exception as e:
            my_print(f"DEBUG: AI API failed: {e}")
            break
            
    return None, ""

def setup_scene():
    """Clean up the default scene (remove cameras, lights, meshes)."""
    # DO NOT use read_factory_settings as it unloads user extensions like io_scene_max!
    for obj in bpy.context.scene.objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)
    for block in bpy.data.images:
        bpy.data.images.remove(block)
    
def import_asset(filepath, freecad_path=""):
    """Import the asset based on its extension."""
    ext = os.path.splitext(filepath)[1].lower()
    
    if ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=filepath)
    elif ext == '.obj':
        bpy.ops.wm.obj_import(filepath=filepath)
    elif ext in ['.gltf', '.glb']:
        bpy.ops.import_scene.gltf(filepath=filepath)
    elif ext == '.blend':
        bpy.ops.wm.open_mainfile(filepath=filepath)
    elif ext == '.dae':
        bpy.ops.wm.collada_import(filepath=filepath)
    elif ext in ['.stl']:
        bpy.ops.wm.stl_import(filepath=filepath)
    elif ext in ['.ply']:
        bpy.ops.wm.ply_import(filepath=filepath)
    elif ext in ['.usd', '.usda', '.usdc', '.usdz']:
        bpy.ops.wm.usd_import(filepath=filepath)
    elif ext == '.dxf':
        try:
            bpy.ops.import_scene.dxf(filepath=filepath)
        except AttributeError:
            my_print(f"Error: The .dxf importer extension is missing! Please install the 'Import AutoCAD DXF Format (.dxf)' extension from Blender Preferences -> Get Extensions.")
            raise
    elif ext == '.3ds':
        try:
            bpy.ops.import_scene.max3ds(filepath=filepath)
        except AttributeError:
            try:
                bpy.ops.import_scene.autodesk_3ds(filepath=filepath)
            except AttributeError:
                my_print(f"Error: The .3ds importer extension is missing! Please install the 'Import Autodesk 3DS (.3ds)' extension from Blender Preferences -> Get Extensions.")
                raise
    elif ext == '.max':
        try:
            bpy.ops.import_scene.max(filepath=filepath)
        except Exception as e:
            try:
                bpy.ops.import_scene.autodesk_max(filepath=filepath)
            except Exception as e2:
                my_print(f"Warning: Failed to import MAX using known operators. ({e}, {e2})")
                raise
    elif ext in ['.step', '.stp', '.igs', '.iges']:
        import tempfile
        import subprocess
        import uuid
        import shutil as _shutil
        obj_path = os.path.join(tempfile.gettempdir(), f"freecad_temp_{uuid.uuid4().hex[:8]}.obj")

        freecad_exe = None
        # 1. User-configured path takes priority
        if freecad_path and os.path.isfile(freecad_path):
            freecad_exe = freecad_path
            my_print(f"DEBUG: Using configured FreeCAD path: {freecad_exe}")
        if not freecad_exe:
            if sys.platform == 'win32':
                for candidate in [
                    r"D:\FreeCAD\bin\FreeCADCmd.exe",
                    r"C:\Program Files\FreeCAD 1.0\bin\FreeCADCmd.exe",
                    r"C:\Program Files\FreeCAD 0.21\bin\FreeCADCmd.exe",
                    r"C:\Program Files\FreeCAD\bin\FreeCADCmd.exe",
                ]:
                    if os.path.exists(candidate):
                        freecad_exe = candidate
                        break
            else:
                for cmd in ['FreeCADCmd', 'freecadcmd', 'FreeCAD', 'freecad']:
                    found = _shutil.which(cmd)
                    if found:
                        freecad_exe = found
                        break
                if not freecad_exe:
                    for candidate in [
                        '/usr/bin/FreeCADCmd', '/usr/bin/freecadcmd',
                        '/usr/local/bin/FreeCADCmd', '/opt/freecad/bin/FreeCADCmd',
                        '/snap/bin/freecad',
                    ]:
                        if os.path.exists(candidate):
                            freecad_exe = candidate
                            break

        if not freecad_exe:
            my_print(f"Error: FreeCAD not found. Set the FreeCAD path in Settings or install FreeCAD to import {ext} files.")
            raise FileNotFoundError(f"FreeCAD executable not found for {ext} import.")

        script = f'''import FreeCAD, Import, Mesh
doc = FreeCAD.newDocument()
Import.insert("{filepath}", doc.Name)
Mesh.export(doc.Objects, "{obj_path}")'''

        script_path = os.path.join(tempfile.gettempdir(), f"fc_script_{uuid.uuid4().hex[:8]}.py")
        with open(script_path, 'w') as f: f.write(script)

        my_print(f"DEBUG: Launching FreeCAD to tessellate {ext} file...")
        # On Linux, the 'freecad' GUI binary needs --console to run headlessly.
        # 'FreeCADCmd' (Windows/some Linux builds) runs headlessly without it.
        _exe_name = os.path.basename(freecad_exe).lower()
        if sys.platform != 'win32' and 'cmd' not in _exe_name:
            _fc_cmd = [freecad_exe, '--console', script_path]
        else:
            _fc_cmd = [freecad_exe, script_path]
        my_print(f"DEBUG: FreeCAD command: {_fc_cmd}")
        try:
            subprocess.run(_fc_cmd, check=True, timeout=120)
            bpy.ops.wm.obj_import(filepath=obj_path)
        finally:
            try: os.remove(obj_path)
            except: pass
            try: os.remove(script_path)
            except: pass
    else:
        my_print(f"Warning: Format {ext} might not have a dedicated importer or is unsupported.")
        raise ValueError(f"Unsupported format: {ext}")

def normalize_scene():
    """Remove cameras, lights, empties; apply transforms; normalize scale to real-world size."""
    import mathutils as _mu

    # Remove cameras and lights using low-level API to avoid View Layer selection errors
    objs_to_remove = [obj for obj in bpy.data.objects if obj.type in ['CAMERA', 'LIGHT']]
    for obj in objs_to_remove:
        bpy.data.objects.remove(obj, do_unlink=True)

    # Apply transforms for all meshes
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            try:
                obj.hide_viewport = False
                obj.hide_set(False)
                obj.hide_select = False
                obj.select_set(True)
                bpy.context.view_layer.objects.active = obj
                bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
                obj.select_set(False)
            except Exception as e:
                my_print(f"DEBUG: Could not apply transforms to {obj.name}: {e}")

    # Normalize scale: if the asset is wildly off from real-world meter scale, rescale it.
    # Handles common unit mismatches: cm-authored assets (100x too large), mm (1000x), etc.
    TARGET_SIZE = 2.0   # target longest bounding-box dimension in Blender units (≈ metres)
    SCALE_MIN   = 0.05  # below this → asset is too tiny (e.g. authored in mm or microns)
    SCALE_MAX   = 100.0 # above this → asset is too large (e.g. authored in cm without conversion)
    min_co = [float('inf')] * 3
    max_co = [float('-inf')] * 3
    has_mesh = False
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            has_mesh = True
            for pt in obj.bound_box:
                wp = obj.matrix_world @ _mu.Vector(pt)
                for i in range(3):
                    min_co[i] = min(min_co[i], wp[i])
                    max_co[i] = max(max_co[i], wp[i])
    if has_mesh:
        max_dim = max(max_co[i] - min_co[i] for i in range(3)) if max_co[0] != float('-inf') else 0
        if max_dim > 0 and (max_dim > SCALE_MAX or max_dim < SCALE_MIN):
            scale_factor = TARGET_SIZE / max_dim
            my_print(f"DEBUG: Rescaling scene by {scale_factor:.6f} (bounding box was {max_dim:.4f} units)")
            for obj in bpy.context.scene.objects:
                if obj.type == 'MESH':
                    obj.scale = (obj.scale.x * scale_factor,
                                 obj.scale.y * scale_factor,
                                 obj.scale.z * scale_factor)
                    try:
                        bpy.context.view_layer.objects.active = obj
                        obj.select_set(True)
                        bpy.ops.object.transform_apply(scale=True)
                        obj.select_set(False)
                    except Exception as e:
                        my_print(f"DEBUG: Could not apply scale to {obj.name}: {e}")

def sanitize_materials():
    """Auto-correct extreme PBR values that are almost certainly import artifacts.

    Returns a list of correction records so the caller can save them to
    metadata.json as 'material_sanitizations'.  The user can then review,
    revert, or accept each correction from the UI.
    """
    sanitizations = []

    for mat in bpy.data.materials:
        if not mat.use_nodes:
            mat.use_nodes = True

        bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)

        # If the importer created a material without a Principled BSDF, USD export will fail.
        if not bsdf:
            mat.node_tree.nodes.clear()
            bsdf = mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
            output = mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
            mat.node_tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
            my_print(f"DEBUG: Forcefully rebuilt Principled BSDF for {mat.name}")

        # 1. Fix Accidental Latex/Metal (Metallic > 0.9 without a texture)
        if 'Metallic' in bsdf.inputs and not bsdf.inputs['Metallic'].is_linked:
            val = bsdf.inputs['Metallic'].default_value
            if val > 0.9:
                sanitizations.append({
                    "material": mat.name, "property": "Metallic",
                    "original_value": round(float(val), 3), "sanitized_value": 0.0,
                    "reason": "Fully metallic with no texture — likely an import artifact.",
                })
                bsdf.inputs['Metallic'].default_value = 0.0

        # 2. Fix Accidental Wet/Oily (Roughness < 0.1 without a texture)
        if 'Roughness' in bsdf.inputs and not bsdf.inputs['Roughness'].is_linked:
            val = bsdf.inputs['Roughness'].default_value
            if val < 0.1:
                sanitizations.append({
                    "material": mat.name, "property": "Roughness",
                    "original_value": round(float(val), 3), "sanitized_value": 0.6,
                    "reason": "Near-zero roughness makes every surface a perfect mirror.",
                })
                bsdf.inputs['Roughness'].default_value = 0.6

        # 3. Fix Pitch Black Base Color (all channels < 0.05 without a texture)
        if 'Base Color' in bsdf.inputs and not bsdf.inputs['Base Color'].is_linked:
            color = bsdf.inputs['Base Color'].default_value
            if color[0] < 0.05 and color[1] < 0.05 and color[2] < 0.05:
                orig = [round(float(color[0]), 3), round(float(color[1]), 3), round(float(color[2]), 3)]
                sanitizations.append({
                    "material": mat.name, "property": "Base Color",
                    "original_value": orig, "sanitized_value": [0.8, 0.8, 0.8],
                    "reason": "Pitch-black base color — asset would appear invisible.",
                })
                bsdf.inputs['Base Color'].default_value = (0.8, 0.8, 0.8, color[3])

    if sanitizations:
        my_print(f"DEBUG: sanitize_materials corrected {len(sanitizations)} value(s): "
                 + ", ".join(f"{s['material']}.{s['property']}" for s in sanitizations))
    return sanitizations

_TEX_FOLDER_NAMES = {'textures', 'tex', 'maps', 'material', 'materials', 'images', 'sourceimages', 'matlibs', 'textures_library'}
_TEX_EXTS = {'.png', '.jpg', '.jpeg', '.tif', '.tiff', '.tga', '.exr', '.bmp', '.hdr', '.dds', '.webp', '.ktx', '.ktx2'}

def _find_texture_dirs(input_dir):
    """Return every likely texture folder at or adjacent to input_dir."""
    found = []
    # Subfolders of input_dir
    try:
        for entry in os.scandir(input_dir):
            if entry.is_dir() and entry.name.lower() in _TEX_FOLDER_NAMES:
                found.append(entry.path)
    except Exception: pass
    # Sibling folders (parent of input_dir)
    parent = os.path.dirname(input_dir)
    if parent and parent != input_dir:
        try:
            for entry in os.scandir(parent):
                if entry.is_dir() and entry.name.lower() in _TEX_FOLDER_NAMES and entry.path != input_dir:
                    found.append(entry.path)
        except Exception: pass
    return found

def heuristic_texture_linking(input_dir, dest_folder, asset_dir, ai_provider, api_key, ai_model, ai_url):
    """Finds all loose textures in the directory, copies them over, and attempts heuristic material linking."""
    found_textures = []

    # Always search: loose files directly in input_dir
    try:
        for entry in os.scandir(input_dir):
            if entry.is_file() and os.path.splitext(entry.name)[1].lower() in _TEX_EXTS:
                if entry.path not in found_textures:
                    found_textures.append(entry.path)
    except Exception: pass

    # Always search: named texture subdirs AND sibling dirs
    for tex_dir in _find_texture_dirs(input_dir):
        for root, dirs, files in os.walk(tex_dir):
            for f in files:
                if os.path.splitext(f)[1].lower() in _TEX_EXTS:
                    abs_path = os.path.join(root, f)
                    if abs_path not in found_textures:
                        found_textures.append(abs_path)

    if not found_textures:
        return 0

    copied_count = 0
    os.makedirs(dest_folder, exist_ok=True)
    # Copy all loose textures to guarantee they are packed with the USD
    for tex in found_textures:
        try:
            new_path = os.path.join(dest_folder, os.path.basename(tex))
            if not os.path.exists(new_path):
                shutil.copy2(tex, new_path)
            copied_count += 1
        except Exception as e:
            my_print(f"DEBUG: Failed to copy loose texture {tex}: {e}")

    # Load images into Blender with guaranteed pixel data.
    # The OBJ/FBX importer often creates bpy.data.images entries with filepath set but
    # has_data=False (headless mode skips pixel reads until actually needed).
    # We must detect this and force-reload from the local copy so Cycles can render them.
    images = {}
    for tex in found_textures:
        basename = os.path.basename(tex)
        local_copy = os.path.join(dest_folder, basename)
        load_path = local_copy if os.path.exists(local_copy) else tex
        try:
            img = bpy.data.images.get(basename)
            if img:
                if not img.has_data:
                    # Importer created the entry but never read pixels — fix that now
                    img.filepath = load_path
                    img.reload()
            else:
                img = bpy.data.images.load(load_path)
            if img:
                images[basename.lower()] = img
        except Exception as _le:
            my_print(f"DEBUG: Could not load image {basename}: {_le}")
    my_print(f"DEBUG: {len(images)} images ready for material linking")

    # Second pass: walk EVERY TEX_IMAGE node across all materials and reload any that still
    # have no pixel data (the OBJ/FBX importer often names images with a path prefix such as
    # "Textures/leaf.jpg" rather than just "leaf.jpg", so get(basename) misses them above).
    _reloaded = 0
    for _mat in bpy.data.materials:
        if not _mat.use_nodes: continue
        for _node in _mat.node_tree.nodes:
            if _node.type != 'TEX_IMAGE' or not _node.image or _node.image.has_data:
                continue
            _bname = os.path.basename(_node.image.filepath.replace('\\', '/'))
            _lc = os.path.join(dest_folder, _bname)
            if os.path.exists(_lc):
                try:
                    _node.image.filepath = _lc
                    _node.image.reload()
                    images[_bname.lower()] = _node.image  # expose to LLM lookup
                    _reloaded += 1
                except Exception as _re:
                    my_print(f"DEBUG: Could not reload {_bname}: {_re}")
    if _reloaded:
        my_print(f"DEBUG: Reloaded pixel data for {_reloaded} importer-created textures")

    texture_map_path = os.path.join(input_dir, "texture_map.json")
    llm_map = None
    
    # Check if we should generate the map dynamically using AI
    my_print(f"DEBUG: AI Heuristic check - found_textures: {bool(found_textures)}, key length: {len(api_key)}, provider: {ai_provider}")
    if found_textures and (len(api_key) > 0 or ai_provider == "Local / Custom (Ollama/LM Studio)"):
        my_print("DEBUG: Asking AI Text-LLM to map textures...")
        mat_names = list(set([m.name for o in bpy.context.scene.objects if o.type == 'MESH' for m in o.data.materials if m]))
        tex_names = [os.path.basename(t) for t in found_textures]
        
        prompt_stage1 = f"""You are a 3D asset pipeline assistant. Map texture filenames to Blender Principled BSDF PBR sockets with studio precision.

Materials: {mat_names}
Textures: {tex_names}

Matching rules — apply ALL:
1. Strip Blender duplicate suffixes (.001, .002, .003 …) — 'Mat.001' and 'Mat.003' both match textures for 'Mat'
2. The '#' character in a material name maps to a SPACE in the texture filename
3. Multiple materials with the same base name share the same texture set
4. Socket assignment by filename keyword (use EXACT socket name from the table):
   BaseColor / Albedo / Diffuse / Color / _BC / _COL / _D / _Diff   → "Base Color"
   Roughness / _Rough / _R / _RGH / _RMS / _ORM (R channel)         → "Roughness"
   Gloss / Glossiness / Specular_Level / _GLOSS / _SPEC              → "Roughness (Inverted)"  ← gloss is inverse of roughness
   Metallic / Metal / _M / _MET / _MTL / _ORM (B channel)           → "Metallic"
   Normal / NRM / NormalMap / _N / _NRM / _Normal                    → "Normal"
   Bump (height-encoded normal)                                      → "Bump"
   Height / Displacement / Disp / _H / _DISP / _HEIGHT              → "Displacement"
   AO / AmbientOcclusion / Occlusion / _AO / _OCC / _ORM (G chan)   → "Ambient Occlusion"
   Emissive / Emission / Emit / Glow / _E / _EM / _EMIS             → "Emission"
   Alpha / Opacity / Transparent / _A / _ALPHA / _OPC               → "Alpha"
   Subsurface / SSS / _SSS                                          → "Subsurface Weight"
5. For ORM/RMA packed textures assign the SAME filename to all three of its channels
6. Leave {{}} for materials where no texture clearly matches

Return ONLY valid JSON — keys are exact material names, values map socket names → exact filenames.
Example: {{"Mat.001": {{"Base Color": "Mat_BaseColor.png", "Roughness": "Mat_Roughness.jpg", "Normal": "Mat_Normal.png", "Ambient Occlusion": "Mat_AO.png"}}, "Mat.002": {{}}}}

Only return {{"REQUIRE_VLM": true}} if BOTH material names AND texture names are entirely devoid of semantic content (e.g. every material is 'Material.001' AND every texture is 'IMG_1234.jpg')."""

        llm_map, raw_text = call_ai_universal(ai_provider, api_key, ai_model, ai_url, prompt_stage1, [])

        if llm_map is None:
            my_print(f"DEBUG: Text-LLM returned None (JSON parse failed). Raw[:300]: {str(raw_text)[:300]}")
        elif llm_map.get("REQUIRE_VLM"):
            pass  # message printed below
        else:
            my_print(f"DEBUG: Text-LLM mapping received — {len(llm_map)} keys: {list(llm_map.keys())[:8]}")
            # If the LLM only mapped a small fraction of materials, fall through to VLM.
            # (e.g. it mapped 2 wire placeholder materials out of 106 real plant materials)
            non_empty = sum(1 for v in llm_map.values() if isinstance(v, dict) and v)
            mat_names_local = list(set([m.name for o in bpy.context.scene.objects if o.type == 'MESH' for m in o.data.materials if m]))
            coverage = non_empty / max(len(mat_names_local), 1)
            # Escalate to VLM when:
            #  - absolute: ≤2 meaningful mappings but ≥6 textures exist
            #    (catches wire-colour-only OBJs with a large texture folder)
            #  - relative: <40% of a medium/large material set was mapped
            _few_mapped  = non_empty <= 2 and len(found_textures) > 5
            _low_coverage = len(mat_names_local) > 3 and coverage < 0.40
            if _few_mapped or _low_coverage:
                my_print(f"DEBUG: Mapping coverage {coverage:.0%} ({non_empty}/{len(mat_names_local)} mats, {len(found_textures)} textures) — escalating to VLM")
                llm_map = {"REQUIRE_VLM": True}

        if llm_map and llm_map.get("REQUIRE_VLM"):
            my_print("DEBUG: Text-LLM requested VLM Fallback. Initializing Multimodal Vision LLM...")
            import base64, math, mathutils, uuid
            palette = [
                (1, 0, 0, 1, "Red"), (0, 1, 0, 1, "Green"), (0, 0, 1, 1, "Blue"), 
                (1, 1, 0, 1, "Yellow"), (1, 0, 1, 1, "Magenta"), (0, 1, 1, 1, "Cyan"), 
                (1, 0.5, 0, 1, "Orange"), (0.5, 0, 1, 1, "Purple"), (1, 0.75, 0.8, 1, "Pink"), 
                (0.5, 1, 0, 1, "Lime"), (0, 0.5, 1, 1, "Light Blue"), (0.5, 0, 0, 1, "Maroon"), 
                (0, 0.5, 0, 1, "Dark Green"), (0, 0, 0.5, 1, "Navy"), (0.5, 0.5, 0.5, 1, "Gray"), 
                (1, 1, 1, 1, "White")
            ]
            
            mat_objects = list(set([m for o in bpy.context.scene.objects if o.type == 'MESH' for m in o.data.materials if m]))
            color_legend = []
            
            neon_materials = {}
            for idx_c, mat in enumerate(mat_objects):
                r, g, b, a, name = palette[idx_c % len(palette)]
                neon = bpy.data.materials.new(name=f"VLM_Neon_{mat.name}")
                neon.use_nodes = True
                neon.node_tree.nodes.clear()
                emission = neon.node_tree.nodes.new('ShaderNodeEmission')
                emission.inputs['Color'].default_value = (r, g, b, 1.0)
                output = neon.node_tree.nodes.new('ShaderNodeOutputMaterial')
                neon.node_tree.links.new(emission.outputs['Emission'], output.inputs['Surface'])
                neon_materials[mat.name] = neon
                color_legend.append(f"Material '{mat.name}' is painted {name}")
                
            orig_slots = []
            for obj in bpy.context.scene.objects:
                if obj.type == 'MESH':
                    for i, slot in enumerate(obj.material_slots):
                        if slot.material and slot.material.name in neon_materials:
                            orig_slots.append((obj, i, slot.material))
                            slot.material = neon_materials[slot.material.name]
                
            mask_path = os.path.join(input_dir, "vlm_mask.jpg")
            cam_data = bpy.data.cameras.new('VLMCam')
            cam_data.clip_end = 50000.0
            cam_obj = bpy.data.objects.new('VLMCam', cam_data)
            bpy.context.scene.collection.objects.link(cam_obj)
            bpy.context.scene.camera = cam_obj
            
            min_co, max_co = [float('inf')]*3, [float('-inf')]*3
            has_mesh = False
            for obj in bpy.context.scene.objects:
                if obj.type == 'MESH':
                    has_mesh = True
                    for point in obj.bound_box:
                        world_point = obj.matrix_world @ mathutils.Vector(point)
                        for idx_c in range(3):
                            min_co[idx_c] = min(min_co[idx_c], world_point[idx_c])
                            max_co[idx_c] = max(max_co[idx_c], world_point[idx_c])
                            
            if has_mesh:
                center = [(max_co[idx_c] + min_co[idx_c]) / 2 for idx_c in range(3)]
                size = max(max_co[idx_c] - min_co[idx_c] for idx_c in range(3)) if max_co[0] != float('-inf') else 10
                cam_obj.location = (center[0], center[1] - size * 1.5, center[2] + size * 0.5)
                direction = mathutils.Vector(center) - cam_obj.location
                cam_obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
            
            prev_engine = bpy.context.scene.render.engine
            bpy.context.scene.render.engine = 'CYCLES'
            bpy.context.scene.cycles.samples = 1
            bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = 512, 512
            bpy.context.scene.render.filepath = mask_path
            bpy.context.scene.render.image_settings.file_format = 'JPEG'
            try: bpy.ops.render.render(write_still=True)
            except Exception as _ve: my_print(f"DEBUG: VLM mask render failed: {_ve}")
            bpy.context.scene.render.engine = prev_engine
            
            for obj, idx_c, mat in orig_slots: obj.material_slots[idx_c].material = mat
            for neon in neon_materials.values(): bpy.data.materials.remove(neon)
                
            legend_str = "\n".join(color_legend)

            # Read mask to base64 while the file is still on disk; we delete the file later.
            mask_b64 = None
            if os.path.exists(mask_path):
                with open(mask_path, "rb") as f: mask_b64 = base64.b64encode(f.read()).decode('utf-8')

            bpy.data.objects.remove(cam_obj)
            if os.path.exists(mask_path): os.remove(mask_path)

            # Helper: scale a texture to 512×512 and return base64 JPEG string, or None on failure.
            def _tex_to_b64(tex_path):
                _bn = os.path.basename(tex_path)
                _lc = os.path.join(dest_folder, _bn)
                _src = _lc if os.path.exists(_lc) else tex_path
                try:
                    _vi = bpy.data.images.load(_src, check_existing=False)
                    _vt = _vi.copy()
                    _vt.scale(256, 256)
                    _vtex = os.path.join(asset_dir, f"vlm_temp_{uuid.uuid4().hex[:6]}.jpg")
                    _vt.filepath_raw = _vtex
                    _vt.file_format = 'JPEG'
                    _vt.save()
                    with open(_vtex, "rb") as _f: _r = base64.b64encode(_f.read()).decode('utf-8')
                    os.remove(_vtex)
                    bpy.data.images.remove(_vt)
                    bpy.data.images.remove(_vi)
                    return _r
                except:
                    return None

            # Detect whether texture filenames carry semantic content.
            # If >70% are arbitrary (img001.png, tex_034.jpg etc.) use two-stage classify+assign.
            import re as _re
            _noise = {'img', 'image', 'tex', 'texture', 'photo', 'pic', 'dsc', 'file', 'scan', 'render', 'map'}
            def _is_semantic(path):
                stem = os.path.splitext(os.path.basename(path))[0].lower()
                parts = [p for p in _re.split(r'[_\-\s\.]+', stem) if p and not p.isdigit()]
                return any(p not in _noise and len(p) > 2 for p in parts)
            _semantic_ratio = sum(1 for t in found_textures if _is_semantic(t)) / max(len(found_textures), 1)
            _use_two_stage = _semantic_ratio < 0.3
            my_print(f"DEBUG: Texture filename semantic ratio {_semantic_ratio:.0%} — {'two-stage classify+assign' if _use_two_stage else 'single-stage with full list'}")

            if _use_two_stage:
                # ---- Stage A: classify ALL textures visually, in batches of 20 ----
                _BATCH = 20
                _tex_cls = {}  # basename → {"type": "BaseColor", "description": "rough bark"}
                _batches = [found_textures[i:i+_BATCH] for i in range(0, len(found_textures), _BATCH)]
                my_print(f"DEBUG: VLM Stage A — {len(found_textures)} textures in {len(_batches)} batch(es)")
                for _bi, _batch in enumerate(_batches):
                    _bb64, _bnames = [], []
                    for _t in _batch:
                        _b = _tex_to_b64(_t)
                        if _b:
                            _bb64.append(_b)
                            _bnames.append(os.path.basename(_t))
                    if not _bb64:
                        continue
                    _nlist = "\n".join(f"  Image {i+1}: {n}" for i, n in enumerate(_bnames))
                    _prompt_cls = f"""You are a 3D asset texture classifier for a professional rendering pipeline.

Images in this batch (in order):
{_nlist}

Classify each image with its exact PBR type from this list:
  BaseColor, Roughness, Gloss, Normal, Bump, Metallic, Emission, Alpha,
  AmbientOcclusion, Displacement, SubsurfaceColor, Unknown

Rules:
- BaseColor: colour/albedo map (sRGB)
- Roughness: linear grey roughness map (bright=rough)
- Gloss: inverse roughness (bright=smooth/specular) — distinguish from Roughness by brightness convention
- Normal: blue-purple tangent-space normal map
- Bump: greyscale height-encoded bump
- Metallic: black/white metalness mask
- AmbientOcclusion: greyscale shadow-cavity map (AO)
- Displacement: greyscale height/displacement map (typically high-contrast)
- Emission: additive glow/light map

Return ONLY valid JSON — keys are exact filenames, values are objects:
  "type": one type from the list above
  "description": 2-4 words describing visual content

Example: {{"bark_BaseColor.png": {{"type": "BaseColor", "description": "rough brown bark"}}, "bark_AO.png": {{"type": "AmbientOcclusion", "description": "bark cavity shadows"}}}}
Do not use markdown."""
                    my_print(f"DEBUG: VLM Stage A batch {_bi+1}/{len(_batches)} — {len(_bb64)} images")
                    _cls, _ = call_ai_universal(ai_provider, api_key, ai_model, ai_url, _prompt_cls, _bb64)
                    if isinstance(_cls, dict):
                        for _k, _v in _cls.items():
                            if isinstance(_v, dict) and 'type' in _v:
                                _tex_cls[_k] = _v
                my_print(f"DEBUG: VLM Stage A complete — {len(_tex_cls)}/{len(found_textures)} textures classified")

                # ---- Stage B: assign classified textures to materials (1 image + text only) ----
                _cls_lines = [
                    f"  {_n}: {_i.get('type','?')} — {_i.get('description','')}"
                    for _n, _i in _tex_cls.items()
                ]
                for _t in found_textures:
                    _bn = os.path.basename(_t)
                    if _bn not in _tex_cls:
                        _cls_lines.append(f"  {_bn}: Unknown — (no visual data)")
                _cls_summary = "\n".join(_cls_lines)

                _prompt_assign = f"""You are a 3D asset pipeline vision assistant building studio-quality material assignments.

Image 1 is a color-coded render of the 3D model — each material is painted a distinct solid color:
{legend_str}

All available textures with their visual classifications:
{_cls_summary}

Task: for each material, assign textures to the correct Blender Principled BSDF socket name.
Use the colour-coded region to identify each material visually, then match classified textures by type and visual content.

Allowed socket names (use EXACT spelling):
  "Base Color", "Roughness", "Roughness (Inverted)", "Metallic", "Normal", "Bump",
  "Displacement", "Ambient Occlusion", "Emission", "Alpha", "Subsurface Weight"

- Use "Roughness (Inverted)" when the classified type is Gloss
- Displacement textures go to "Displacement" (not Normal)
- AmbientOcclusion textures go to "Ambient Occlusion"
- Every texture that has a clear match should be assigned — do not leave textures unmapped if a match is obvious

Return ONLY valid JSON. Keys = exact Material names from the legend. Values = objects mapping socket names → exact filenames.
Leave {{}} only where no match exists. Do not use markdown."""

                _assign_imgs = [mask_b64] if mask_b64 else []
                my_print(f"DEBUG: VLM Stage B — assigning {len(_tex_cls)} classified textures to {len(mat_objects)} materials")
                llm_map, raw_text = call_ai_universal(ai_provider, api_key, ai_model, ai_url, _prompt_assign, _assign_imgs)
                if llm_map: llm_map["_WAS_VLM_GENERATED"] = True
                my_print(f"DEBUG: VLM Stage B result — keys: {list(llm_map.keys())[:8] if llm_map else None}")

            else:
                # ---- Single-stage: 20 visual samples + full filename list in prompt ----
                _prio_keys = ['color', 'albedo', 'diffuse', 'base', '_col', '_dif']
                _sorted_textures = sorted(
                    found_textures,
                    key=lambda t: (0 if any(k in os.path.basename(t).lower() for k in _prio_keys) else 1)
                )
                vlm_tex_names = []
                _vis_b64 = []
                for tex in _sorted_textures:
                    if len(vlm_tex_names) >= 20:
                        break
                    _b = _tex_to_b64(tex)
                    if _b:
                        _vis_b64.append(_b)
                        vlm_tex_names.append(os.path.basename(tex))

                all_tex_names = [os.path.basename(t) for t in found_textures]
                all_tex_str   = "\n".join(f"  - {n}" for n in all_tex_names)
                vis_tex_str   = "\n".join(f"  Image {i+2}: {n}" for i, n in enumerate(vlm_tex_names))
                _vlm_imgs     = ([mask_b64] if mask_b64 else []) + _vis_b64

                prompt_vlm = f"""You are a 3D asset pipeline vision assistant building studio-quality material assignments.

Image 1 is a color-coded render of the 3D model — each material is painted a distinct solid color:
{legend_str}

Images 2 onwards are a VISUAL SAMPLE of textures (up to 20 shown):
{vis_tex_str}

FULL list of ALL available texture filenames (use exact filenames from this list in your response):
{all_tex_str}

Task: for each material, assign every matching texture to the correct Blender Principled BSDF socket.
Use the visual sample to understand content/type; use filename keywords to pick the right file from the FULL LIST.

Allowed socket names (use EXACT spelling):
  "Base Color", "Roughness", "Roughness (Inverted)", "Metallic", "Normal", "Bump",
  "Displacement", "Ambient Occlusion", "Emission", "Alpha", "Subsurface Weight"

Socket assignment keywords:
  BaseColor/Albedo/Diffuse/Color       → "Base Color"
  Roughness/_Rough/_RGH                → "Roughness"
  Gloss/Glossiness/_GLOSS              → "Roughness (Inverted)"
  Metal/Metallic/_MET                  → "Metallic"
  Normal/NRM/_NRM                      → "Normal"
  Bump/_BUMP                           → "Bump"
  Height/Displacement/Disp/_DISP      → "Displacement"
  AO/AmbientOcclusion/Occlusion/_AO  → "Ambient Occlusion"
  Emissive/Emission/Glow/_EM           → "Emission"
  Alpha/Opacity/_A                     → "Alpha"

Return ONLY valid JSON. Keys = exact Material names from the legend. Values = socket name → exact filename from FULL LIST.
Leave {{}} only where no match exists. Do not use markdown."""

                my_print(f"DEBUG: VLM call — {len(_vlm_imgs)} images ({len(vlm_tex_names)} visual samples + mask; {len(all_tex_names)} total filenames in prompt)")
                llm_map, raw_text = call_ai_universal(ai_provider, api_key, ai_model, ai_url, prompt_vlm, _vlm_imgs)
                if llm_map: llm_map["_WAS_VLM_GENERATED"] = True
                my_print(f"DEBUG: VLM mapping result — keys: {list(llm_map.keys())[:8] if llm_map else None}")
            
        if llm_map and not llm_map.get("REQUIRE_VLM"):
            try:
                texture_map_path = os.path.join(asset_dir, "texture_map.json")
                with open(texture_map_path, 'w') as f: json.dump(llm_map, f, indent=2)
                with open(os.path.join(input_dir, "texture_map.json"), 'w') as f: json.dump(llm_map, f, indent=2)
            except Exception as e: my_print(f"DEBUG: Error saving map: {e}")
    elif os.path.exists(texture_map_path):
        try:
            with open(texture_map_path, 'r') as f: llm_map = json.load(f)
        except Exception as e: my_print(f"DEBUG: Failed to load texture_map.json: {e}")

    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH': continue
        if len(obj.material_slots) == 0:
            new_mat = bpy.data.materials.new(name=f"Mat_{obj.name}")
            new_mat.use_nodes = True
            obj.data.materials.append(new_mat)
        obj_name_clean = obj.name.lower().split('.')[0]
        has_uv = len(obj.data.uv_layers) > 0
        if not has_uv:
            try:
                bpy.context.view_layer.objects.active = obj
                obj.select_set(True)
                bpy.ops.object.mode_set(mode='EDIT')
                bpy.ops.mesh.select_all(action='SELECT')
                dim = max(obj.dimensions) if max(obj.dimensions) > 0 else 1.0
                bpy.ops.uv.cube_project(cube_size=dim)
                bpy.ops.object.mode_set(mode='OBJECT')
                obj.select_set(False)
                has_uv = True
            except: 
                if bpy.context.object and bpy.context.object.mode != 'OBJECT': bpy.ops.object.mode_set(mode='OBJECT')
        
        for mat_slot in obj.material_slots:
            mat = mat_slot.material
            if not mat: continue
            if not mat.use_nodes: mat.use_nodes = True
            bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if not bsdf: continue
            
            def is_validly_linked(socket):
                if not socket.is_linked: return False
                from_node = socket.links[0].from_node
                if from_node.type == 'TEX_IMAGE':
                    if not from_node.image or not from_node.image.has_data: return False
                return True
                
            def add_mapped_texture(img, is_color=True):
                tex_node = mat.node_tree.nodes.new('ShaderNodeTexImage')
                tex_node.image = img
                if not is_color: img.colorspace_settings.name = 'Non-Color'
                uv_node = mat.node_tree.nodes.new('ShaderNodeTexCoord')
                mapping_node = mat.node_tree.nodes.new('ShaderNodeMapping')
                if has_uv: mat.node_tree.links.new(uv_node.outputs['UV'], mapping_node.inputs['Vector'])
                else:
                    mat.node_tree.links.new(uv_node.outputs['Generated'], mapping_node.inputs['Vector'])
                    tex_node.projection = 'BOX'
                    tex_node.projection_blend = 0.2
                mat.node_tree.links.new(mapping_node.outputs['Vector'], tex_node.inputs['Vector'])
                return tex_node

            def _find_img(tex_filename):
                tfl = tex_filename.lower()
                return next((i for nm, i in images.items()
                             if nm == tfl or i.name.lower() == tfl
                             or os.path.basename(i.filepath).lower() == tfl), None)

            def _apply_socket(socket_name, img):
                """Wire img into the correct shader socket, handling all special cases."""
                output_node = next((n for n in mat.node_tree.nodes if n.type == 'OUTPUT_MATERIAL'), None)

                if socket_name == 'Normal':
                    if 'Normal' in bsdf.inputs and not is_validly_linked(bsdf.inputs['Normal']):
                        tn = add_mapped_texture(img, is_color=False)
                        nm = mat.node_tree.nodes.new('ShaderNodeNormalMap')
                        mat.node_tree.links.new(tn.outputs['Color'], nm.inputs['Color'])
                        mat.node_tree.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])

                elif socket_name == 'Bump':
                    if 'Normal' in bsdf.inputs and not is_validly_linked(bsdf.inputs['Normal']):
                        tn = add_mapped_texture(img, is_color=False)
                        bump = mat.node_tree.nodes.new('ShaderNodeBump')
                        bump.inputs['Strength'].default_value = 0.5
                        mat.node_tree.links.new(tn.outputs['Color'], bump.inputs['Height'])
                        mat.node_tree.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

                elif socket_name == 'Roughness (Inverted)':
                    # Gloss map — invert to get roughness
                    if 'Roughness' in bsdf.inputs and not is_validly_linked(bsdf.inputs['Roughness']):
                        tn = add_mapped_texture(img, is_color=False)
                        inv = mat.node_tree.nodes.new('ShaderNodeInvert')
                        inv.inputs['Fac'].default_value = 1.0
                        mat.node_tree.links.new(tn.outputs['Color'], inv.inputs['Color'])
                        mat.node_tree.links.new(inv.outputs['Color'], bsdf.inputs['Roughness'])

                elif socket_name == 'Ambient Occlusion':
                    # Multiply AO into the Base Color
                    bc = bsdf.inputs.get('Base Color')
                    if bc:
                        tn = add_mapped_texture(img, is_color=False)
                        # ShaderNodeMix replaced ShaderNodeMixRGB in Blender 4.x
                        try:
                            mix = mat.node_tree.nodes.new('ShaderNodeMix')
                            mix.data_type = 'RGBA'
                            mix.blend_type = 'MULTIPLY'
                            mix.inputs['Factor'].default_value = 1.0
                            c1_in, c2_in, c_out = 'A', 'B', 'Result'
                        except Exception:
                            mix = mat.node_tree.nodes.new('ShaderNodeMixRGB')
                            mix.blend_type = 'MULTIPLY'
                            mix.inputs['Fac'].default_value = 1.0
                            c1_in, c2_in, c_out = 'Color1', 'Color2', 'Color'
                        if bc.is_linked:
                            src = bc.links[0].from_socket
                            mat.node_tree.links.remove(bc.links[0])
                            mat.node_tree.links.new(src, mix.inputs[c1_in])
                        else:
                            mix.inputs[c1_in].default_value = bc.default_value
                        mat.node_tree.links.new(tn.outputs['Color'], mix.inputs[c2_in])
                        mat.node_tree.links.new(mix.outputs[c_out], bc)

                elif socket_name == 'Displacement':
                    if output_node and 'Displacement' in output_node.inputs and \
                            not output_node.inputs['Displacement'].is_linked:
                        tn = add_mapped_texture(img, is_color=False)
                        disp = mat.node_tree.nodes.new('ShaderNodeDisplacement')
                        disp.inputs['Scale'].default_value = 0.02
                        mat.node_tree.links.new(tn.outputs['Color'], disp.inputs['Height'])
                        mat.node_tree.links.new(disp.outputs['Displacement'],
                                                output_node.inputs['Displacement'])

                elif socket_name == 'Alpha':
                    if 'Alpha' in bsdf.inputs and not is_validly_linked(bsdf.inputs['Alpha']):
                        tn = add_mapped_texture(img, is_color=False)
                        mat.node_tree.links.new(tn.outputs['Color'], bsdf.inputs['Alpha'])
                        if hasattr(mat, 'blend_method'): mat.blend_method = 'HASHED'

                elif socket_name in bsdf.inputs and not is_validly_linked(bsdf.inputs[socket_name]):
                    is_col = socket_name in ('Base Color', 'Emission')
                    tn = add_mapped_texture(img, is_color=is_col)
                    mat.node_tree.links.new(tn.outputs['Color'], bsdf.inputs[socket_name])

            if llm_map and mat.name in llm_map:
                my_print(f"DEBUG: Applying LLM map for '{mat.name}'")
                for socket_name, tex_filename in llm_map[mat.name].items():
                    img = _find_img(tex_filename)
                    if img:
                        _apply_socket(socket_name, img)
                    else:
                        my_print(f"DEBUG: texture not found for socket '{socket_name}': {tex_filename}")
                continue

            # Keyword fallback — used when no LLM map covers this material
            if images:
                if len(images) == 1:
                    _img = next(iter(images.values()))
                    if 'Base Color' in bsdf.inputs and not is_validly_linked(bsdf.inputs['Base Color']):
                        _apply_socket('Base Color', _img)
                else:
                    _kw: list = [
                        # (socket_name, [keywords])  — ordered: more-specific first
                        ('Roughness (Inverted)', ['gloss', 'glossiness', '_gloss', '_spec_level']),
                        ('Base Color',   ['basecolor', 'base_color', 'albedo', 'diffuse', '_bc', '_col', '_dif', '_d_', '_d.']),
                        ('Roughness',    ['roughness', '_rough', '_rgh', '_r_', '_r.', '_rms', '_orm']),
                        ('Metallic',     ['metallic', 'metalness', '_metal', '_met', '_m_', '_m.', '_mtl']),
                        ('Normal',       ['normal', '_nrm', '_nor', '_n_', '_n.']),
                        ('Bump',         ['bump', '_bump', '_bmp']),
                        ('Displacement', ['displacement', 'disp', 'height', '_disp', '_h_', '_h.']),
                        ('Ambient Occlusion', ['ambientocclusion', '_ao', '_occ', 'occlusion']),
                        ('Emission',     ['emissive', 'emission', 'emit', 'glow', '_e_', '_e.', '_em']),
                        ('Alpha',        ['alpha', 'opacity', 'transparent', '_a_', '_a.']),
                        ('Subsurface Weight', ['subsurface', '_sss']),
                    ]
                    for _sock, _keys in _kw:
                        for _iname, _img in images.items():
                            _il = _iname.lower()
                            if any(_k in _il for _k in _keys):
                                _apply_socket(_sock, _img)
                                break
    return copied_count

def collect_textures_for_objects(objects, dest_folder, input_dir):
    if not os.path.exists(dest_folder): os.makedirs(dest_folder)
    materials = set()
    for obj in objects:
        if obj.type == 'MESH':
            for slot in obj.material_slots:
                if slot.material: materials.add(slot.material)
    copied_count = 0
    restores = {}
    for mat in materials:
        if not mat.use_nodes: continue
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image and node.image.source == 'FILE' and node.image.filepath:
                img = node.image
                if img.name not in restores: restores[img.name] = (img, img.filepath)
                abs_path = bpy.path.abspath(img.filepath)
                if not os.path.exists(abs_path):
                    basename = os.path.basename(img.filepath.replace('\\', '/'))
                    alts = [os.path.join(input_dir, basename), os.path.join(input_dir, "Textures", basename), os.path.join(input_dir, "textures", basename), os.path.join(input_dir, img.name)]
                    for alt in alts:
                        if os.path.exists(alt): abs_path = alt; break
                if os.path.exists(abs_path):
                    new_path = os.path.join(dest_folder, os.path.basename(abs_path))
                    try:
                        shutil.copy2(abs_path, new_path)
                        img.filepath = "//" + os.path.join("textures", os.path.basename(abs_path)).replace("\\", "/")
                        copied_count += 1
                    except: pass
    return copied_count, restores

def generate_thumbnail(dest_path):
    cam_data = bpy.data.cameras.new('ThumbnailCamera')
    cam_data.clip_end = 50000.0
    cam_obj = bpy.data.objects.new('ThumbnailCamera', cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj
    light_data = bpy.data.lights.new(name="Sun", type='SUN')
    light_data.energy = 5.0
    light_obj = bpy.data.objects.new(name="Sun", object_data=light_data)
    bpy.context.scene.collection.objects.link(light_obj)
    light_obj.rotation_euler = (math.radians(45), 0, math.radians(45))
    fill_data = bpy.data.lights.new(name="Fill", type='SUN')
    fill_data.energy = 1.0
    fill_obj = bpy.data.objects.new(name="Fill", object_data=fill_data)
    bpy.context.scene.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(-45), 0, math.radians(-135))
    default_mat = bpy.data.materials.new(name="DefaultClay")
    default_mat.use_nodes = True
    if default_mat.node_tree:
        bsdf = default_mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (0.8, 0.8, 0.8, 1.0)
            bsdf.inputs['Roughness'].default_value = 0.4
    min_co, max_co = [float('inf')] * 3, [float('-inf')] * 3
    has_mesh = False
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            has_mesh = True
            if len(obj.material_slots) == 0: obj.data.materials.append(default_mat)
            for point in obj.bound_box:
                world_point = obj.matrix_world @ mathutils.Vector(point)
                for i in range(3):
                    min_co[i] = min(min_co[i], world_point[i])
                    max_co[i] = max(max_co[i], world_point[i])
    if has_mesh:
        center = [(max_co[i] + min_co[i]) / 2 for i in range(3)]
        size = max(max_co[i] - min_co[i] for i in range(3))
        cam_obj.location = (center[0], center[1] - size * 1.5, center[2] + size * 0.5)
        direction = mathutils.Vector(center) - cam_obj.location
        cam_obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    else:
        cam_obj.location = (0, -10, 5)
        cam_obj.rotation_euler = (math.radians(60), 0, 0)
    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = 32
    bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = 512, 512
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.render.image_settings.file_format = 'PNG'
    bpy.context.scene.render.filepath = dest_path
    bpy.ops.render.render(write_still=True)

def extract_geometry_data(objects):
    """Extract bounding-box dimensions (mm) and polycount from a list of Blender mesh objects."""
    import mathutils as _mu
    min_co = [float('inf')] * 3
    max_co = [float('-inf')] * 3
    total_polys = 0
    has_mesh = False

    for obj in objects:
        if obj.type != 'MESH':
            continue
        has_mesh = True
        for pt in obj.bound_box:
            wp = obj.matrix_world @ _mu.Vector(pt)
            for i in range(3):
                min_co[i] = min(min_co[i], wp[i])
                max_co[i] = max(max_co[i], wp[i])
        total_polys += len(obj.data.polygons)

    if not has_mesh or min_co[0] == float('inf'):
        return None

    # Blender units are metres — multiply by 1000 to get millimetres
    width_mm  = round((max_co[0] - min_co[0]) * 1000)
    depth_mm  = round((max_co[1] - min_co[1]) * 1000)
    height_mm = round((max_co[2] - min_co[2]) * 1000)
    center = [(max_co[i] + min_co[i]) / 2 for i in range(3)]
    size   = max(max_co[i] - min_co[i] for i in range(3))

    return {
        "width_mm":  width_mm,
        "depth_mm":  depth_mm,
        "height_mm": height_mm,
        "polycount": total_polys,
        "center":    center,
        "size":      size,
    }


def render_profile_views(asset_dir, center, size):
    """Render front, side, and top orthographic clay views of the current scene.

    Returns a dict {view_name: base64_jpeg_string}.
    Only renders objects that are currently render-visible (respects the caller's
    hide_render flags so blend-file multi-asset exports stay isolated).
    """
    import base64

    # Three orthographic camera positions — each offset from the asset centre
    view_offsets = {
        "front": (0,            -size * 2.4, 0),
        "side":  (size * 2.4,   0,           0),
        "top":   (0,            0,            size * 2.4),
    }

    # Temporary clay material for clean silhouettes
    clay_mat = bpy.data.materials.new("_ProfileClay")
    clay_mat.use_nodes = True
    _bsdf = clay_mat.node_tree.nodes.get("Principled BSDF")
    if _bsdf:
        _bsdf.inputs['Base Color'].default_value = (0.75, 0.75, 0.75, 1.0)
        _bsdf.inputs['Roughness'].default_value = 0.6

    # Override materials — save originals for restoration
    _mat_restores = []
    for _obj in bpy.context.scene.objects:
        if _obj.type == 'MESH':
            for _i, _slot in enumerate(_obj.material_slots):
                _mat_restores.append((_obj, _i, _slot.material))
                _slot.material = clay_mat

    # Simple sun light for the clay renders
    _sun_data = bpy.data.lights.new("_ProfileSun", type='SUN')
    _sun_data.energy = 4.0
    _sun_obj = bpy.data.objects.new("_ProfileSun", _sun_data)
    bpy.context.scene.collection.objects.link(_sun_obj)
    _sun_obj.rotation_euler = (math.radians(50), 0, math.radians(30))

    # Save render settings
    _prev = {
        "engine":      bpy.context.scene.render.engine,
        "res_x":       bpy.context.scene.render.resolution_x,
        "res_y":       bpy.context.scene.render.resolution_y,
        "transparent": bpy.context.scene.render.film_transparent,
        "fmt":         bpy.context.scene.render.image_settings.file_format,
        "cam":         bpy.context.scene.camera,
    }
    try:
        _prev["samples"] = bpy.context.scene.cycles.samples
    except Exception:
        _prev["samples"] = 4

    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = 4
    bpy.context.scene.render.resolution_x = 512
    bpy.context.scene.render.resolution_y = 512
    bpy.context.scene.render.film_transparent = False
    bpy.context.scene.render.image_settings.file_format = 'JPEG'

    views = {}
    for view_name, (ox, oy, oz) in view_offsets.items():
        _cam_data = bpy.data.cameras.new(f'_ProfileCam_{view_name}')
        _cam_data.type = 'ORTHO'
        _cam_data.ortho_scale = size * 2.6
        _cam_data.clip_end = size * 20
        _cam_obj = bpy.data.objects.new(f'_ProfileCam_{view_name}', _cam_data)
        bpy.context.scene.collection.objects.link(_cam_obj)
        bpy.context.scene.camera = _cam_obj

        _cam_obj.location = (center[0] + ox, center[1] + oy, center[2] + oz)
        _dir = mathutils.Vector(center) - _cam_obj.location
        _cam_obj.rotation_euler = _dir.to_track_quat('-Z', 'Y').to_euler()

        _view_path = os.path.join(asset_dir, f"profile_{view_name}.jpg")
        bpy.context.scene.render.filepath = _view_path
        try:
            bpy.ops.render.render(write_still=True)
            with open(_view_path, 'rb') as _f:
                views[view_name] = base64.b64encode(_f.read()).decode('utf-8')
            os.remove(_view_path)
            my_print(f"DEBUG: Profile view '{view_name}' rendered OK")
        except Exception as _e:
            my_print(f"DEBUG: Profile view '{view_name}' failed: {_e}")
        finally:
            bpy.data.objects.remove(_cam_obj)
            bpy.data.cameras.remove(_cam_data)

    # Restore materials, light, and render settings
    for _obj, _i, _orig in _mat_restores:
        try:
            _obj.material_slots[_i].material = _orig
        except Exception:
            pass
    bpy.data.materials.remove(clay_mat)
    bpy.data.objects.remove(_sun_obj)
    bpy.data.lights.remove(_sun_data)

    bpy.context.scene.render.engine = _prev["engine"]
    bpy.context.scene.render.resolution_x = _prev["res_x"]
    bpy.context.scene.render.resolution_y = _prev["res_y"]
    bpy.context.scene.render.film_transparent = _prev["transparent"]
    bpy.context.scene.render.image_settings.file_format = _prev["fmt"]
    bpy.context.scene.camera = _prev["cam"]
    try:
        bpy.context.scene.cycles.samples = _prev["samples"]
    except Exception:
        pass

    return views


def generate_asset_profile(asset_name, geometry, b64_perspective, b64_views, ai_provider, api_key, ai_model, ai_url):
    """Send 4 views + hard geometry to VLM and return a spatial profile dict.

    The geometry section is always confidence 1.0 (computed from mesh).
    Every other section gets a confidence score from the VLM; anything below
    0.75 is flagged needs_review = True.
    """
    CONFIDENCE_THRESHOLD = 0.75

    images = []
    view_labels = []
    if b64_perspective:
        images.append(b64_perspective)
        view_labels.append("perspective (45-degree render)")
    for _vn in ("front", "side", "top"):
        if _vn in b64_views:
            images.append(b64_views[_vn])
            view_labels.append(f"{_vn} orthographic")

    view_desc = "\n".join(f"  Image {i+1}: {label}" for i, label in enumerate(view_labels))

    prompt = f"""You are a 3D asset spatial profile generator for an AI scene-assembly system.
Analyze the provided views of a 3D asset and generate its complete spatial placement profile.

HARD GEOMETRY (from 3D mesh — do not guess or change these values):
  Width:    {geometry['width_mm']} mm
  Depth:    {geometry['depth_mm']} mm
  Height:   {geometry['height_mm']} mm
  Polygons: {geometry['polycount']:,}

VIEWS PROVIDED (in order):
{view_desc}

Return ONLY valid JSON — no markdown fences. Fill every field with your best guess and assign
a confidence value (0.0–1.0) per section. Set needs_review: true where confidence < 0.75.

{{
  "schema_version": "1.0",
  "identity": {{
    "category": "primary object noun: chair, table, lamp, sofa, shelf, plant, rug...",
    "subcategory": "specific type: dining_chair, coffee_table, floor_lamp...",
    "style_tags": ["contemporary", "rustic", "industrial", "minimal", "traditional", "mid_century", "..."],
    "room_types": ["living_room", "bedroom", "kitchen", "dining_room", "bathroom", "office", "hallway", "outdoor"],
    "confidence": 0.0,
    "needs_review": false
  }},
  "geometry": {{
    "width_mm": {geometry['width_mm']},
    "depth_mm": {geometry['depth_mm']},
    "height_mm": {geometry['height_mm']},
    "polycount": {geometry['polycount']},
    "confidence": 1.0,
    "needs_review": false
  }},
  "orientation": {{
    "up_axis": "+Z",
    "forward_axis": "direction the front face points: +Y, -Y, +X, or -X",
    "notes": "one sentence on how you determined the front",
    "confidence": 0.0,
    "needs_review": false
  }},
  "placement": {{
    "surface": "floor, wall, ceiling, tabletop, shelf, or countertop",
    "snap_mode": "bottom_to_surface, back_to_wall, top_to_ceiling, or center_to_surface",
    "can_stack": false,
    "is_freestanding": true,
    "confidence": 0.0,
    "needs_review": false
  }},
  "anchors": [
    {{
      "name": "descriptive name (e.g. seat_surface, tabletop, backrest_contact)",
      "type": "surface, contact, or attach_point",
      "description": "where other objects can connect to this asset"
    }}
  ],
  "relations": [
    {{
      "relation": "faces, near, beside, below, above, against_wall, or pairs_with",
      "target": "category of related object (e.g. dining_table, sofa, desk)",
      "strength": "required, preferred, or optional"
    }}
  ],
  "style": {{
    "primary_style": "main design style",
    "secondary_style": null,
    "material_finish": "wood, fabric, metal, glass, plastic, stone, ceramic, leather, rattan...",
    "color_family": "neutral, warm, cool, dark, light, or multicolor",
    "confidence": 0.0,
    "needs_review": false
  }},
  "clearance": {{
    "requires_access_space": false,
    "min_clearance_front_mm": 0,
    "min_clearance_sides_mm": 0,
    "is_human_usable": false,
    "ergonomic_notes": null,
    "confidence": 0.0,
    "needs_review": false
  }},
  "material": {{
    "can_be_recoloured": false,
    "primary_material": "main material type",
    "secondary_material": null,
    "has_transparency": false,
    "confidence": 0.0,
    "needs_review": false
  }},
  "room": {{
    "appropriate_rooms": ["list of room types where this asset belongs"],
    "inappropriate_rooms": [],
    "indoor_outdoor": "indoor, outdoor, or both",
    "confidence": 0.0,
    "needs_review": false
  }},
  "qa": {{
    "must_touch_floor": false,
    "must_face_target": false,
    "must_not_intersect": true,
    "min_floor_clearance_mm": 0,
    "notes": null,
    "confidence": 0.0,
    "needs_review": false
  }}
}}

Important rules:
1. geometry is always confidence 1.0 and needs_review false — it is hard data.
2. Use the FRONT orthographic view to determine forward_axis.
3. Use dimensions to cross-check your category (e.g. standard dining chair seat is ~450mm high).
4. anchors = where other objects are placed ON or AGAINST this asset.
5. relations = other furniture categories typically found near this in a real room.
6. Do not wrap in markdown. Return only the JSON object."""

    my_print(f"DEBUG: Generating spatial profile for '{asset_name}' — {len(images)} views, {geometry['width_mm']}x{geometry['depth_mm']}x{geometry['height_mm']}mm")
    profile, raw = call_ai_universal(ai_provider, api_key, ai_model, ai_url, prompt, images)

    if not isinstance(profile, dict):
        my_print(f"DEBUG: Profile generation returned non-dict. Raw[:300]: {str(raw)[:300]}")
        return None

    # Enforce needs_review based on confidence threshold and collect review list
    review_fields = []
    confidences = []
    for _sec in ("identity", "orientation", "placement", "style", "clearance", "material", "room", "qa"):
        _s = profile.get(_sec)
        if not isinstance(_s, dict):
            continue
        _conf = float(_s.get("confidence", 0.5))
        confidences.append(_conf)
        _s["needs_review"] = _conf < CONFIDENCE_THRESHOLD
        if _s["needs_review"]:
            review_fields.append(_sec)

    # Geometry is always authoritative
    if isinstance(profile.get("geometry"), dict):
        profile["geometry"]["confidence"] = 1.0
        profile["geometry"]["needs_review"] = False

    overall = round(sum(confidences) / max(len(confidences), 1), 3) if confidences else 0.5
    profile["asset_name"]        = asset_name
    profile["overall_confidence"] = overall
    profile["needs_review"]      = len(review_fields) > 0
    profile["review_fields"]     = review_fields

    return profile


def segment_scene(ai_provider, api_key, ai_model, ai_url):
    import urllib.request, json
    assets_to_export = []
    mesh_info = {}
    unique_meshes = {}
    instance_collections = [c for c in bpy.data.collections if c.name != "Scene Collection" and len(c.objects) > 0 and all(o.type == 'MESH' for o in c.objects)]
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH' and not any(obj.name in [o.name for o in c.objects] for c in instance_collections):
            unique_meshes[obj.name] = obj
            mesh_info[obj.name] = {
                "dimensions": [round(obj.dimensions.x, 2), round(obj.dimensions.y, 2), round(obj.dimensions.z, 2)],
                "location": [round(obj.location.x, 2), round(obj.location.y, 2), round(obj.location.z, 2)]
            }
    for coll in instance_collections:
        assets_to_export.append({
            "name": coll.name, "objects": list(coll.objects), "category": "Uncategorized", "tags": ["Collection Instance", coll.name]
        })
    # Process Unique Meshes via AI
    my_print(f"DEBUG: AI Segmentation check - mesh_info count: {len(mesh_info)}, key length: {len(api_key)}, provider: {ai_provider}")
    if mesh_info and (len(api_key) > 0 or ai_provider == "Local / Custom (Ollama/LM Studio)"):
        prompt = f'''You are a 3D asset segmentation assistant.
I have a list of unique mesh objects from a scene, along with their bounding box dimensions (X, Y, Z):
{json.dumps(mesh_info, indent=2)}

Please group these objects into logical "Assets". For example, if you see 'Table_Leg', 'Table_Top', group them into an asset named 'Table'.
Return a JSON array of objects. Each object must have:
- "asset_name": A clean, descriptive name for the asset (e.g. "Dining Table", "Oak Tree", "Dragon").
- "category": Exactly one category chosen from this list (use the exact spelling):
  {_CATEGORY_LIST_STR}
- "object_names": An array of exact object names that belong to this asset.
- "tags": 8-12 lowercase search tags covering object type, materials, style, environment, visual features, and use case (e.g. ["dining-table", "wood", "four-legged", "interior", "realistic", "brown", "furniture", "rustic"]).

Do not use markdown blocks. Return ONLY valid JSON.'''

        try:
            groups, _ = call_ai_universal(ai_provider, api_key, ai_model, ai_url, prompt, [])
            if groups:
                for group in groups:
                    objs = [bpy.context.scene.objects.get(name) for name in group.get("object_names", [])]
                    objs = [o for o in objs if o]
                    if objs:
                        assets_to_export.append({
                            "name": group.get("asset_name", "Unknown_Asset"),
                            "category": _normalize_category(group.get("category", ""), "Props"),
                            "objects": objs,
                            "tags": group.get("tags", [])
                        })
            else:
                raise Exception("AI returned empty groups or failed to connect.")
        except Exception as e:
            my_print(f"DEBUG: Failed AI grouping: {e}")
            for data_name, obj in unique_meshes.items():
                assets_to_export.append({
                    "name": obj.name,
                    "category": "Uncategorized",
                    "objects": [obj],
                    "tags": [obj.name]
                })
    else:
        for data_name, obj in unique_meshes.items():
            assets_to_export.append({
                "name": obj.name,
                "category": "Uncategorized",
                "objects": [obj],
                "tags": [obj.name]
            })
            
    return assets_to_export

def collect_textures_for_objects(objects, dest_folder, input_dir):
    if not os.path.exists(dest_folder):
        os.makedirs(dest_folder)
    
    materials = set()
    for obj in objects:
        if obj.type == 'MESH':
            for slot in obj.material_slots:
                if slot.material:
                    materials.add(slot.material)
                    
    copied_count = 0
    restores = {}
    for mat in materials:
        if not mat.use_nodes: continue
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image and node.image.source == 'FILE' and node.image.filepath:
                img = node.image
                if img.name not in restores:
                    restores[img.name] = (img, img.filepath)
                    
                if img.filepath.startswith('//'):
                    rel_path = img.filepath[2:]
                    abs_path = os.path.normpath(os.path.join(input_dir, rel_path))
                else:
                    abs_path = bpy.path.abspath(img.filepath)
                
                if not os.path.exists(abs_path):
                    basename = os.path.basename(img.filepath.replace('\\', '/'))
                    alts = [
                        os.path.join(input_dir, basename),
                        os.path.join(input_dir, "Textures", basename),
                        os.path.join(input_dir, "textures", basename),
                        os.path.join(input_dir, img.name)
                    ]
                    for alt in alts:
                        if os.path.exists(alt):
                            abs_path = alt
                            break
                    # Last resort: case-insensitive recursive search under input_dir
                    if not os.path.exists(abs_path) and basename:
                        basename_lower = basename.lower()
                        for _r, _d, _fs in os.walk(input_dir):
                            for _f in _fs:
                                if _f.lower() == basename_lower:
                                    abs_path = os.path.join(_r, _f)
                                    break
                            if os.path.exists(abs_path):
                                break

                if os.path.exists(abs_path):
                    filename = os.path.basename(abs_path)
                    new_path = os.path.join(dest_folder, filename)
                    try:
                        import shutil
                        if abs_path != new_path:
                            shutil.copy2(abs_path, new_path)
                        img.filepath = "//" + "textures/" + filename
                        # Force pixel data into Blender memory so Cycles can render the thumbnail.
                        # Without this, headless mode never loads pixels even when filepath is valid.
                        img.reload()
                        copied_count += 1
                    except Exception:
                        pass
    return copied_count, restores


def detect_material_anomalies(objects):
    """Scan Principled BSDF inputs for values that are almost certainly wrong.

    Only flags properties that are NOT driven by a texture node — texture-driven
    values are intentional.  sanitize_materials() already auto-fixes the most
    extreme cases (metallic=1, roughness=0, black base color), so thresholds
    here are set to catch what slips through.

    Returns a list of dicts:
      { material, property, current_value, issue, suggested_fix }
    """
    anomalies = []
    seen = set()

    for obj in objects:
        if obj.type != 'MESH':
            continue
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or mat.name in seen:
                continue
            seen.add(mat.name)
            if not mat.use_nodes:
                continue
            bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if not bsdf:
                continue

            def linked(name):
                inp = bsdf.inputs.get(name)
                return inp is not None and inp.is_linked

            def scalar(name):
                inp = bsdf.inputs.get(name)
                if inp is None or inp.is_linked:
                    return None
                return float(inp.default_value)

            def color3(name):
                inp = bsdf.inputs.get(name)
                if inp is None or inp.is_linked:
                    return None
                v = inp.default_value
                return (round(float(v[0]), 3), round(float(v[1]), 3), round(float(v[2]), 3))

            def flag(prop, cur, issue, fix):
                anomalies.append({
                    "material": mat.name,
                    "property": prop,
                    "current_value": cur,
                    "issue": issue,
                    "suggested_fix": fix,
                })

            # --- Metallic ---
            m = scalar('Metallic')
            if m is not None and m > 0.95:
                flag('Metallic', round(m, 3),
                     "Fully metallic with no texture — likely an import artifact.",
                     0.0)

            # --- Roughness ---
            r = scalar('Roughness')
            if r is not None:
                if r < 0.05:
                    flag('Roughness', round(r, 3),
                         "Near-zero roughness makes every surface a perfect mirror.",
                         0.5)
                elif r > 0.97:
                    flag('Roughness', round(r, 3),
                         "Maximum roughness gives a flat chalk appearance with no sheen.",
                         0.6)

            # --- Base Color ---
            bc = color3('Base Color')
            if bc is not None:
                lum = bc[0] * 0.299 + bc[1] * 0.587 + bc[2] * 0.114
                if lum < 0.02:
                    flag('Base Color', list(bc),
                         "Pitch-black base color — asset will appear invisible.",
                         [0.8, 0.8, 0.8])
                elif bc[0] > 0.98 and bc[1] > 0.98 and bc[2] > 0.98:
                    flag('Base Color', list(bc),
                         "Pure white base color — physically impossible for most real materials (max ~0.9).",
                         [0.8, 0.8, 0.8])

            # --- Alpha ---
            a = scalar('Alpha')
            if a is not None and a < 0.01:
                flag('Alpha', round(a, 3),
                     "Fully transparent with no texture — asset will be invisible.",
                     1.0)

            # --- Emission Strength (Blender 4.x separates this) ---
            es_inp = bsdf.inputs.get('Emission Strength')
            if es_inp and not es_inp.is_linked:
                es = float(es_inp.default_value)
                if es > 10.0:
                    flag('Emission Strength', round(es, 3),
                         f"Emission strength of {es:.1f} will blow out renders.",
                         1.0)

            # --- IOR ---
            ior = scalar('IOR')
            if ior is not None and abs(ior - 1.0) < 0.02:
                flag('IOR', round(ior, 3),
                     "IOR = 1.0 removes all Fresnel reflectance — surface won't reflect at grazing angles.",
                     1.45)

            # --- Specular IOR Level (Blender 4.x) / Specular (3.x) ---
            spec_inp = bsdf.inputs.get('Specular IOR Level') or bsdf.inputs.get('Specular')
            if spec_inp and not spec_inp.is_linked:
                spec = float(spec_inp.default_value)
                if spec < 0.01:
                    flag(spec_inp.name, round(spec, 3),
                         "Zero specular — surface has no reflectance at all.",
                         0.5)

            # --- Normal Map strength (if a Normal Map node feeds this BSDF) ---
            normal_inp = bsdf.inputs.get('Normal')
            if normal_inp and normal_inp.is_linked:
                from_node = normal_inp.links[0].from_node
                if from_node.type == 'NORMAL_MAP':
                    str_inp = from_node.inputs.get('Strength')
                    if str_inp and not str_inp.is_linked:
                        strength = float(str_inp.default_value)
                        if strength > 2.0:
                            flag('Normal Map Strength', round(strength, 3),
                                 f"Normal map strength {strength:.1f} is exaggerated and will produce visual artifacts.",
                                 1.0)
                        elif strength < 0.0:
                            flag('Normal Map Strength', round(strength, 3),
                                 "Negative normal map strength inverts surface detail.",
                                 1.0)

    return anomalies


def main():
    import uuid
    argv = sys.argv
    if "--" not in argv:
        my_print("Error: Missing arguments after '--'")
        sys.exit(1)
        
    args = argv[argv.index("--") + 1:]
    if len(args) < 2:
        my_print("Usage: blender --background --python convert.py -- <input_file> <output_dir> <category>")
        sys.exit(1)
        
    input_file = os.path.abspath(args[0])
    output_dir = os.path.abspath(args[1])
    default_category = args[2] if len(args) > 2 else "Uncategorized"
    debug_blend_path = args[3] if len(args) > 3 else ""
    gemini_api_key = (args[4] if len(args) > 4 else "").strip()
    ai_provider = args[5] if len(args) > 5 else "Google Gemini"
    ai_model = args[6] if len(args) > 6 else "gemini-2.5-flash"
    ai_url = (args[7] if len(args) > 7 else "").strip()
    freecad_path = args[8] if len(args) > 8 else ""
    my_print(f"DEBUG: provider={ai_provider!r}, model={ai_model!r}, url={ai_url!r}, key_len={len(gemini_api_key)}, freecad={freecad_path!r}")
    
    filename = os.path.basename(input_file)
    base_asset_name = os.path.splitext(filename)[0]
    source_format = os.path.splitext(filename)[1].lower().replace(".", "")
    input_dir = os.path.dirname(os.path.abspath(input_file))
    
    my_print(f"Starting conversion for: {input_file}")
    
    try:
        setup_scene()
        import_asset(input_file, freecad_path)
        normalize_scene()
        all_sanitizations = sanitize_materials()

        assets_to_export = []
        if source_format == 'blend':
            assets_to_export = segment_scene(ai_provider, gemini_api_key, ai_model, ai_url)
            import re
            for a in assets_to_export:
                a["name"] = re.sub(r'[\\\\/*?:"<>|]', '_', a.get("name", "Unknown")).strip()
                a["category"] = re.sub(r'[\\\\/*?:"<>|]', '_', a.get("category", default_category)).strip()
            manifest = [{"name": a["name"], "category": a["category"]} for a in assets_to_export]
            my_print(f"QUEUE_MANIFEST: {json.dumps(manifest)}")
        else:
            assets_to_export = [{
                "name": base_asset_name,
                "category": default_category,
                "objects": list(bpy.context.scene.objects),
                "tags": []
            }]
            
        final_manifest_items = []
        for asset in assets_to_export:
            asset_name = asset["name"]
            category = asset.get("category", default_category)
            tags = asset.get("tags", [])
            objects = asset["objects"]
            
            # Create output directory
            asset_dir = os.path.join(output_dir, category, asset_name)
            os.makedirs(asset_dir, exist_ok=True)
            textures_dir = os.path.join(asset_dir, "textures")
            
            asset_id = str(uuid.uuid4())
            metadata_path = os.path.join(asset_dir, "metadata.json")
            if os.path.exists(metadata_path):
                try:
                    with open(metadata_path, 'r') as f:
                        existing_meta = json.load(f)
                        if "id" in existing_meta:
                            asset_id = existing_meta["id"]
                            my_print(f"DEBUG: Preserving existing asset ID {asset_id} for {asset_name}")
                except Exception:
                    pass
                    
            # Isolate objects
            bpy.ops.object.select_all(action='DESELECT')
            def select_recursive(obj):
                try:
                    obj.select_set(True)
                    for child in obj.children:
                        select_recursive(child)
                except Exception: pass
            
            for obj in objects:
                select_recursive(obj)

            # Link loose textures and call LLM — copies go directly to textures_dir (the final location)
            heuristic_count = heuristic_texture_linking(input_dir, textures_dir, asset_dir, ai_provider, gemini_api_key, ai_model, ai_url)

            # Copy textures that are already linked in Blender material nodes
            texture_count, restores = collect_textures_for_objects(bpy.context.selected_objects, textures_dir, input_dir)
            texture_count = max(texture_count, heuristic_count)

            # Always copy the entire source textures folder(s) to textures_dir.
            # This is unconditional and copies every file regardless of extension or LLM status.
            def _copy_dir_to_textures(src_dir):
                _count = 0
                for _root, _dirs, _files in os.walk(src_dir):
                    _rel = os.path.relpath(_root, src_dir)
                    _dst_dir = textures_dir if _rel == '.' else os.path.join(textures_dir, _rel)
                    os.makedirs(_dst_dir, exist_ok=True)
                    for _f in _files:
                        _dst_f = os.path.join(_dst_dir, _f)
                        if not os.path.exists(_dst_f):
                            try:
                                shutil.copy2(os.path.join(_root, _f), _dst_f)
                                _count += 1
                            except Exception as _ce:
                                my_print(f"DEBUG: Texture folder copy failed {_f}: {_ce}")
                return _count

            _extra_count = 0
            # Copy named texture directories (subfolders and siblings)
            for _tsrc_dir in _find_texture_dirs(input_dir):
                _n = _copy_dir_to_textures(_tsrc_dir)
                my_print(f"DEBUG: Copied {_n} files from {_tsrc_dir}")
                _extra_count += _n

            # Also copy any loose texture files directly in input_dir
            try:
                for _entry in os.scandir(input_dir):
                    if _entry.is_file() and os.path.splitext(_entry.name)[1].lower() in _TEX_EXTS:
                        os.makedirs(textures_dir, exist_ok=True)
                        _dst_f = os.path.join(textures_dir, _entry.name)
                        if not os.path.exists(_dst_f):
                            try:
                                shutil.copy2(_entry.path, _dst_f)
                                _extra_count += 1
                            except Exception as _ce:
                                my_print(f"DEBUG: Loose texture copy failed {_entry.name}: {_ce}")
            except Exception: pass

            if _extra_count > 0:
                my_print(f"DEBUG: Total extra textures copied to output: {_extra_count}")
                texture_count = max(texture_count, _extra_count)

            usd_path = os.path.join(asset_dir, "asset.usd")
            bpy.ops.wm.usd_export(filepath=usd_path, selected_objects_only=True, export_textures=True, relative_paths=True)
            
            for img_name, (img, old_path) in restores.items():
                try: img.filepath = old_path
                except: pass
            
            
            thumbnail_path = os.path.join(asset_dir, "thumbnail.png")
            # bpy.context.window is None in --background (headless) mode on Linux.
            # When a window exists (GUI mode), re-import USD into a clean scene for
            # the thumbnail so material previews reflect the final USD output.
            # In headless mode, render directly from the current scene.
            if bpy.context.window:
                old_scene = bpy.context.scene
                new_scene = bpy.data.scenes.new(name="ThumbScene")
                bpy.context.window.scene = new_scene
                try:
                    bpy.ops.wm.usd_import(filepath=usd_path)
                    generate_thumbnail(thumbnail_path)
                except Exception as _thumb_err:
                    my_print(f"DEBUG: USD re-import for thumbnail failed, falling back: {_thumb_err}")
                    try:
                        generate_thumbnail(thumbnail_path)
                    except Exception as _e2:
                        my_print(f"DEBUG: Fallback thumbnail also failed: {_e2}")
                finally:
                    bpy.context.window.scene = old_scene
                    bpy.data.scenes.remove(new_scene)
            else:
                # Headless mode (Linux --background): render from current scene
                try:
                    generate_thumbnail(thumbnail_path)
                except Exception as _thumb_err:
                    my_print(f"DEBUG: Thumbnail generation failed: {_thumb_err}")
            
            # Universal AI Visual Tagging
            my_print(f"DEBUG: AI Visual Tag check - thumb_exists: {os.path.exists(thumbnail_path)}, key length: {len(gemini_api_key)}, provider: {ai_provider}")
            if os.path.exists(thumbnail_path) and (len(gemini_api_key) > 0 or ai_provider == "Local / Custom (Ollama/LM Studio)"):
                try:
                    import base64
                    with open(thumbnail_path, "rb") as f:
                        b64_thumb = base64.b64encode(f.read()).decode('utf-8')
                    
                    prompt_vtag = f"""You are a 3D asset metadata generator. Analyze this 3D asset thumbnail and return exactly:
1. The single best-matching category from this list (use the exact spelling shown):
   {_CATEGORY_LIST_STR}
2. 8-10 lowercase search tags optimized for semantic search. Cover: object description, materials, visual style, setting/environment, use case, and distinctive features. Use single words or short hyphenated phrases.

Return ONLY valid JSON — no markdown:
{{
  "category": "<one category from the list above>",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8"]
}}"""

                    ai_meta, _ = call_ai_universal(ai_provider, gemini_api_key, ai_model, ai_url, prompt_vtag, [b64_thumb])
                    if ai_meta:
                        if ai_meta.get("category"):
                            new_category = _normalize_category(ai_meta["category"], category)
                            if new_category != category:
                                import shutil
                                new_asset_dir = os.path.join(output_dir, new_category, asset_name)
                                os.makedirs(os.path.dirname(new_asset_dir), exist_ok=True)
                                if not os.path.exists(new_asset_dir):
                                    shutil.move(asset_dir, new_asset_dir)
                                    asset_dir = new_asset_dir
                                    textures_dir = os.path.join(asset_dir, "textures")
                                    thumbnail_path = os.path.join(asset_dir, "thumbnail.png")
                                    usd_path = os.path.join(asset_dir, "asset.usd")
                            category = new_category
                        if ai_meta.get("tags"): tags = list(set(tags + ai_meta["tags"]))[:10]
                        my_print(f"DEBUG: VLM tagging successful: category={category!r}, tags={ai_meta.get('tags')}")
                except Exception as e:
                    my_print(f"DEBUG: Failed visual tagging: {e}")
            
            # --- Spatial profile generation ---
            # Extract hard geometry, render 3 ortho views, then call VLM once to produce
            # the full placement profile JSON.  This is skipped if no AI key is configured.
            needs_review      = False
            profile_confidence = 0.0
            if (len(gemini_api_key) > 0 or ai_provider == "Local / Custom (Ollama/LM Studio)"):
                try:
                    import base64 as _b64
                    geo = extract_geometry_data(objects)
                    if geo:
                        _center = geo.pop("center")
                        _size   = geo.pop("size")

                        # Perspective thumbnail already rendered — load it as base64
                        _b64_persp = None
                        if os.path.exists(thumbnail_path):
                            with open(thumbnail_path, 'rb') as _tf:
                                _b64_persp = _b64.b64encode(_tf.read()).decode('utf-8')

                        # Render front / side / top orthographic views
                        _profile_views = render_profile_views(asset_dir, _center, _size)

                        profile = generate_asset_profile(
                            asset_name, geo, _b64_persp, _profile_views,
                            ai_provider, gemini_api_key, ai_model, ai_url
                        )
                        if profile:
                            _profile_path = os.path.join(asset_dir, "asset_profile.json")
                            with open(_profile_path, 'w') as _pf:
                                json.dump(profile, _pf, indent=2)
                            needs_review       = profile.get("needs_review", False)
                            profile_confidence = profile.get("overall_confidence", 0.0)
                            my_print(f"DEBUG: Spatial profile saved — conf={profile_confidence:.2f}, review={profile.get('review_fields')}")
                except Exception as _pe:
                    import traceback as _tb
                    my_print(f"DEBUG: Spatial profile failed: {_pe}\n{_tb.format_exc()}")

            # Detect material anomalies on the final processed scene
            try:
                material_anomalies = detect_material_anomalies(objects)
                if material_anomalies:
                    needs_review = True
                    my_print(f"DEBUG: {len(material_anomalies)} material anomaly/ies detected: "
                             + ", ".join(f"{a['material']}.{a['property']}" for a in material_anomalies))
                else:
                    my_print("DEBUG: No material anomalies detected.")
            except Exception as _mae:
                material_anomalies = []
                my_print(f"DEBUG: Material anomaly detection failed: {_mae}")

            # Filter sanitizations to only those belonging to this asset's materials
            asset_mat_names = {
                m.name
                for obj in objects if obj.type == 'MESH'
                for m in obj.data.materials if m
            }
            material_sanitizations = [s for s in all_sanitizations if s["material"] in asset_mat_names]
            if material_sanitizations:
                needs_review = True

            # Write metadata
            metadata = {
                "id": asset_id,
                "name": asset_name,
                "category": category,
                "tags": tags,
                "source_format": source_format,
                "date_added": datetime.now().isoformat(),
                "thumbnail": "thumbnail.png",
                "asset_path": "asset.usd",
                "texture_count": texture_count,
                "animated": False,
                "needs_review": needs_review,
                "profile_confidence": profile_confidence,
                "material_anomalies": material_anomalies,
                "material_sanitizations": material_sanitizations,
            }
            
            metadata_path = os.path.join(asset_dir, "metadata.json")
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=4)
                
            final_manifest_items.append({"name": asset_name, "category": category})
            my_print(f"Finished exporting asset: {asset_name}")

        # Final manifest push so the host knows the finalized categories
        if final_manifest_items:
            my_print(f"QUEUE_MANIFEST: {json.dumps(final_manifest_items)}")
            
    except Exception as e:
        import traceback
        my_print(f"Conversion failed: {e}")
        traceback.print_exc()
        crash_path = os.path.join(log_dir, 'usd_converter_crash_log.txt')
        try:
            with open(crash_path, 'w') as crashf:
                crashf.write(traceback.format_exc())
        except:
            crash_path = os.path.join(tempfile.gettempdir(), 'usd_converter_crash_log.txt')
            with open(crash_path, 'w') as crashf:
                crashf.write(traceback.format_exc())
        sys.exit(1)

if __name__ == "__main__":
    main()
