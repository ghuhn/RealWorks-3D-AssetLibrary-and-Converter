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
                if not api_key: return None, "No API Key provided"
                endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                parts = [{"text": prompt_text}]
                for b64 in b64_images:
                    parts.append({"inlineData": {"mimeType": "image/jpeg", "data": b64}})
                payload = {
                    "contents": [{"parts": parts}],
                    "generationConfig": {"responseMimeType": "application/json"}
                }
                req = urllib.request.Request(endpoint, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
                
            elif provider in ["OpenAI", "Local / Custom (Ollama/LM Studio)"]:
                endpoint = url if provider == "Local / Custom (Ollama/LM Studio)" else "https://api.openai.com/v1/chat/completions"
                if not endpoint: return None, "No endpoint URL provided"
                
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
                
            elif provider == "Anthropic":
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
            
            with urllib.request.urlopen(req) as response:
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
    
def import_asset(filepath):
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
    elif ext in ['.step', '.igs', '.iges']:
        import tempfile
        import subprocess
        import uuid
        obj_path = os.path.join(tempfile.gettempdir(), f"freecad_temp_{uuid.uuid4().hex[:8]}.obj")
        freecad_exe = r"D:\FreeCAD\bin\FreeCADCmd.exe"
        if not os.path.exists(freecad_exe):
            freecad_exe = r"D:\FreeCAD\bin\freecad.exe"
            
        script = f'''import FreeCAD, Import, Mesh
doc = FreeCAD.newDocument()
Import.insert(r"{filepath}", doc.Name)
Mesh.export(doc.Objects, r"{obj_path}")'''
        
        script_path = os.path.join(tempfile.gettempdir(), f"fc_script_{uuid.uuid4().hex[:8]}.py")
        with open(script_path, 'w') as f: f.write(script)
        
        my_print(f"DEBUG: Launching FreeCAD to tessellate {ext} file...")
        try:
            subprocess.run([freecad_exe, script_path], check=True)
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
    """Remove cameras, lights, empties, and normalize scale."""
    
    # Remove cameras and lights using low-level API to avoid View Layer selection errors
    objs_to_remove = [obj for obj in bpy.data.objects if obj.type in ['CAMERA', 'LIGHT']]
    for obj in objs_to_remove:
        bpy.data.objects.remove(obj, do_unlink=True)
        
    # Apply transforms and normalize scale for meshes
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            try:
                # Force visibility to allow selection
                obj.hide_viewport = False
                obj.hide_set(False)
                obj.hide_select = False
                
                obj.select_set(True)
                bpy.context.view_layer.objects.active = obj
                bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
                obj.select_set(False)
            except Exception as e:
                my_print(f"DEBUG: Could not apply transforms to {obj.name}: {e}")

def sanitize_materials():
    """Fix common material export bugs (e.g. 100% metallic, pitch black diffuse, oily roughness)."""
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            mat.use_nodes = True
            
        bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        
        # If the importer created a weird material without a Principled BSDF, USD export will fail.
        # We must forcefully rebuild the material using a standard Principled BSDF!
        if not bsdf:
            mat.node_tree.nodes.clear()
            bsdf = mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
            output = mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
            mat.node_tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
            my_print(f"DEBUG: Forcefully rebuilt Principled BSDF for {mat.name}")
        
        # 1. Fix Accidental Latex/Metal (Metallic = 1.0 without a texture)
        if 'Metallic' in bsdf.inputs and not bsdf.inputs['Metallic'].is_linked:
            if bsdf.inputs['Metallic'].default_value > 0.9:
                bsdf.inputs['Metallic'].default_value = 0.0
                
        # 2. Fix Accidental Wet/Oily (Roughness = 0.0 without a texture)
        if 'Roughness' in bsdf.inputs and not bsdf.inputs['Roughness'].is_linked:
            if bsdf.inputs['Roughness'].default_value < 0.1:
                bsdf.inputs['Roughness'].default_value = 0.6
                
        # 3. Fix Pitch Black Base Color (RGB = 0,0,0 without a texture)
        if 'Base Color' in bsdf.inputs and not bsdf.inputs['Base Color'].is_linked:
            color = bsdf.inputs['Base Color'].default_value
            if color[0] < 0.05 and color[1] < 0.05 and color[2] < 0.05:
                # Set to a neutral clay grey so it isn't a pitch black silhouette
                bsdf.inputs['Base Color'].default_value = (0.8, 0.8, 0.8, color[3])

def heuristic_texture_linking(input_dir, dest_folder, asset_dir, ai_provider, api_key, ai_model, ai_url):
    """Finds all loose textures in the directory, copies them over, and attempts heuristic material linking."""
    texture_exts = {'.png', '.jpg', '.jpeg', '.tif', '.tiff', '.tga', '.exr'}
    found_textures = []
    
    for root, dirs, files in os.walk(input_dir):
        for f in files:
            if os.path.splitext(f)[1].lower() in texture_exts:
                abs_path = os.path.join(root, f)
                if abs_path not in found_textures:
                    found_textures.append(abs_path)
                    
    # If no textures found, try common sibling texture folders in the parent directory
    if not found_textures:
        parent_dir = os.path.dirname(input_dir)
        if parent_dir and os.path.splitdrive(parent_dir)[1] not in ('\\', '/'):
            common_tex_folders = ['textures', 'tex', 'maps', 'materials', 'images', 'matlibs']
            try:
                for item in os.listdir(parent_dir):
                    if item.lower() in common_tex_folders:
                        tex_dir = os.path.join(parent_dir, item)
                        if os.path.isdir(tex_dir):
                            for root, dirs, files in os.walk(tex_dir):
                                for f in files:
                                    if os.path.splitext(f)[1].lower() in texture_exts:
                                        abs_path = os.path.join(root, f)
                                        if abs_path not in found_textures:
                                            found_textures.append(abs_path)
            except Exception as e:
                my_print(f"DEBUG: Failed to scan parent directory for sibling textures: {e}")
                        
    if not found_textures:
        return 0

    copied_count = 0
    # Copy all loose textures to guarantee they are packed with the USD
    for tex in found_textures:
        try:
            new_path = os.path.join(dest_folder, os.path.basename(tex))
            if not os.path.exists(new_path):
                shutil.copy2(tex, new_path)
            copied_count += 1
        except Exception as e:
            my_print(f"DEBUG: Failed to copy loose texture {tex}: {e}")

    # Load images into Blender to attempt heuristic material linking
    images = {}
    for tex in found_textures:
        try:
            # Check if it's already loaded
            img = bpy.data.images.get(os.path.basename(tex))
            if not img: 
                img = bpy.data.images.load(tex)
            images[os.path.basename(tex).lower()] = img
        except: pass
                    
    texture_map_path = os.path.join(input_dir, "texture_map.json")
    llm_map = None
    
    # Check if we should generate the map dynamically using AI
    my_print(f"DEBUG: AI Heuristic check - found_textures: {bool(found_textures)}, key length: {len(api_key)}, provider: {ai_provider}")
    if found_textures and (len(api_key) > 0 or ai_provider == "Local / Custom (Ollama/LM Studio)"):
        my_print("DEBUG: Asking AI Text-LLM to map textures...")
        mat_names = list(set([m.name for o in bpy.context.scene.objects if o.type == 'MESH' for m in o.data.materials if m]))
        tex_names = [os.path.basename(t) for t in found_textures]
        
        prompt_stage1 = f"""You are a 3D asset pipeline assistant.
Materials: {mat_names}
Textures: {tex_names}
Return a JSON object where keys are the exact Material names, and values are objects mapping socket names ('Base Color', 'Roughness', 'Metallic', 'Normal', 'Alpha', 'Emission') to exact Texture filenames. Do not use markdown.
CRITICAL: If the names are completely arbitrary and meaningless (e.g. 'Mat_001' and 'IMG_123.jpg') and you cannot semantically map them with absolute confidence, DO NOT GUESS. Instead, return exactly: {{"REQUIRE_VLM": true}}"""

        llm_map, raw_text = call_ai_universal(ai_provider, api_key, ai_model, ai_url, prompt_stage1, [])
        
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
            try: bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
            except: bpy.context.scene.render.engine = 'BLENDER_EEVEE'
            bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = 512, 512
            bpy.context.scene.render.filepath = mask_path
            bpy.context.scene.render.image_settings.file_format = 'JPEG'
            try: bpy.ops.render.render(write_still=True)
            except: pass
            bpy.context.scene.render.engine = prev_engine
            
            for obj, idx_c, mat in orig_slots: obj.material_slots[idx_c].material = mat
            for neon in neon_materials.values(): bpy.data.materials.remove(neon)
                
            legend_str = "\n".join(color_legend)
            prompt_vlm = f"""You are a 3D asset pipeline vision assistant.
Here is a color-coded render of the 3D model:
{legend_str}

I will also provide the texture images found in the folder.
Return a JSON object where keys are the exact Material names, and values are objects mapping socket names ('Base Color', 'Roughness', 'Metallic', 'Normal', 'Alpha', 'Emission') to exact Texture filenames. Do not use markdown."""
            b64_images = []
            if os.path.exists(mask_path):
                with open(mask_path, "rb") as f: b64_images.append(base64.b64encode(f.read()).decode('utf-8'))
                    
            for tex in found_textures:
                try:
                    img = bpy.data.images.load(tex)
                    temp_img = img.copy()
                    temp_img.scale(512, 512)
                    temp_tex = os.path.join(input_dir, f"vlm_temp_{uuid.uuid4().hex[:6]}.jpg")
                    temp_img.filepath_raw = temp_tex
                    temp_img.file_format = 'JPEG'
                    temp_img.save()
                    with open(temp_tex, "rb") as f: b64_images.append(base64.b64encode(f.read()).decode('utf-8'))
                    os.remove(temp_tex)
                    bpy.data.images.remove(temp_img)
                    bpy.data.images.remove(img)
                except: pass
                    
            bpy.data.objects.remove(cam_obj)
            if os.path.exists(mask_path): os.remove(mask_path)
                
            llm_map, raw_text = call_ai_universal(ai_provider, api_key, ai_model, ai_url, prompt_vlm, b64_images)
            if llm_map: llm_map["_WAS_VLM_GENERATED"] = True
            
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

            if llm_map and mat.name in llm_map:
                mat_mapping = llm_map[mat.name]
                for socket_name, tex_filename in mat_mapping.items():
                    if socket_name in bsdf.inputs and not is_validly_linked(bsdf.inputs[socket_name]):
                        img = next((i for name, i in images.items() if i.name == tex_filename or os.path.basename(i.filepath) == tex_filename), None)
                        if img:
                            is_color = socket_name in ['Base Color', 'Emission']
                            tex_node = add_mapped_texture(img, is_color=is_color)
                            if socket_name == 'Normal':
                                normal_map = mat.node_tree.nodes.new('ShaderNodeNormalMap')
                                mat.node_tree.links.new(tex_node.outputs['Color'], normal_map.inputs['Color'])
                                mat.node_tree.links.new(normal_map.outputs['Normal'], bsdf.inputs['Normal'])
                            elif socket_name == 'Alpha':
                                mat.node_tree.links.new(tex_node.outputs['Color'], bsdf.inputs['Alpha'])
                                if hasattr(mat, 'blend_method'): mat.blend_method = 'HASHED'
                            else: mat.node_tree.links.new(tex_node.outputs['Color'], bsdf.inputs[socket_name])
                continue

            # (Fuzzy Logic skipped for brevity)
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
    bpy.context.scene.render.filepath = dest_path
    bpy.ops.render.render(write_still=True)

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
- "asset_name": A clean, generic name for the asset (e.g. "Dining Table").
- "category": A single broad category for the asset (e.g. "Furniture", "Nature", "Props", "Vehicles").
- "object_names": An array of exact object names that belong to this asset.
- "tags": An array of 10-15 descriptive tags for maximum searchability (e.g. ["furniture", "table", "dining", "wood", "interior", "home", "eating", "desk", "room", "wooden"]).

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
                            "category": group.get("category", "Uncategorized"),
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
                    basename = os.path.basename(img.filepath.replace('\\\\', '/'))
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
                            
                if os.path.exists(abs_path):
                    filename = os.path.basename(abs_path)
                    new_path = os.path.join(dest_folder, filename)
                    try:
                        import shutil
                        shutil.copy2(abs_path, new_path)
                        img.filepath = "//" + os.path.join("textures", filename).replace("\\\\", "/")
                        copied_count += 1
                    except Exception:
                        pass
    return copied_count, restores


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
        
    input_file = args[0]
    output_dir = args[1]
    default_category = args[2] if len(args) > 2 else "Uncategorized"
    debug_blend_path = args[3] if len(args) > 3 else ""
    gemini_api_key = args[4] if len(args) > 4 else ""
    ai_provider = args[5] if len(args) > 5 else "Google Gemini"
    ai_model = args[6] if len(args) > 6 else "gemini-2.5-flash"
    ai_url = args[7] if len(args) > 7 else ""
    
    filename = os.path.basename(input_file)
    base_asset_name = os.path.splitext(filename)[0]
    source_format = os.path.splitext(filename)[1].lower().replace(".", "")
    input_dir = os.path.dirname(os.path.abspath(input_file))
    
    my_print(f"Starting conversion for: {input_file}")
    
    try:
        setup_scene()
        import_asset(input_file)
        normalize_scene()
        sanitize_materials()
        
        # Link all loose textures for the entire scene first
        heuristic_count = heuristic_texture_linking(input_dir, os.path.join(output_dir, "temp_tex"), output_dir, ai_provider, gemini_api_key, ai_model, ai_url)
        
        assets_to_export = []
        if source_format == 'blend':
            assets_to_export = segment_scene(ai_provider, gemini_api_key, ai_model, ai_url)
            import re
            for a in assets_to_export:
                a["name"] = re.sub(r'[\\\\/*?:"<>|]', '_', a.get("name", "Unknown")).strip()
                a["category"] = re.sub(r'[\\\\/*?:"<>|]', '_', a.get("category", default_category)).strip()
            import json
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
                    import json
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
                
            texture_count, restores = collect_textures_for_objects(bpy.context.selected_objects, textures_dir, input_dir)
            texture_count = max(texture_count, heuristic_count)
            
            usd_path = os.path.join(asset_dir, "asset.usd")
            bpy.ops.wm.usd_export(filepath=usd_path, selected_objects_only=True, export_textures=True, relative_paths=True)
            
            for img_name, (img, old_path) in restores.items():
                try: img.filepath = old_path
                except: pass
            
            
            # Temporary scene to generate clean thumbnail
            old_scene = bpy.context.scene
            new_scene = bpy.data.scenes.new(name="ThumbScene")
            bpy.context.window.scene = new_scene
            bpy.ops.wm.usd_import(filepath=usd_path)
            
            thumbnail_path = os.path.join(asset_dir, "thumbnail.png")
            generate_thumbnail(thumbnail_path)
            
            bpy.context.window.scene = old_scene
            bpy.data.scenes.remove(new_scene)
            
            # Universal AI Visual Tagging
            my_print(f"DEBUG: AI Visual Tag check - thumb_exists: {os.path.exists(thumbnail_path)}, key length: {len(gemini_api_key)}, provider: {ai_provider}")
            if os.path.exists(thumbnail_path) and (len(gemini_api_key) > 0 or ai_provider == "Local / Custom (Ollama/LM Studio)"):
                try:
                    import base64
                    with open(thumbnail_path, "rb") as f:
                        b64_thumb = base64.b64encode(f.read()).decode('utf-8')
                    
                    prompt_vtag = """You are a 3D asset metadata generator. Look at this thumbnail of a 3D asset. Generate a highly accurate category and exactly 5 descriptive tags for it. Return ONLY valid JSON matching this schema:
{
  "category": "A single broad category (e.g. Furniture, Nature, Architecture, Vehicles, Props)",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}
Do not use markdown blocks."""
                    
                    ai_meta, _ = call_ai_universal(ai_provider, gemini_api_key, ai_model, ai_url, prompt_vtag, [b64_thumb])
                    if ai_meta:
                        if ai_meta.get("category") and ai_meta["category"] != category:
                            new_category = ai_meta["category"]
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
                        if ai_meta.get("tags"): tags = list(set(tags + ai_meta["tags"]))[:5]
                        my_print(f"DEBUG: VLM tagging successful: {ai_meta.get('tags')}")
                except Exception as e:
                    my_print(f"DEBUG: Failed visual tagging: {e}")
            
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
                "animated": False
            }
            
            metadata_path = os.path.join(asset_dir, "metadata.json")
            import json
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=4)
                
            final_manifest_items.append({"name": asset_name, "category": category})
            my_print(f"Finished exporting asset: {asset_name}")

        # Final manifest push so the host knows the finalized categories
        if final_manifest_items:
            import json
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
