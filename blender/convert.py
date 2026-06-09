import bpy
import sys
import os
import json
import uuid
import shutil
import math
import mathutils
from datetime import datetime

def setup_scene():
    """Clean up the default scene (remove cameras, lights, meshes)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    
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
    else:
        print(f"Warning: Format {ext} might not have a dedicated importer or is unsupported.")
        # Attempt generic import if possible, but for now just fail or log
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
                print(f"DEBUG: Could not apply transforms to {obj.name}: {e}")

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
            print(f"DEBUG: Forcefully rebuilt Principled BSDF for {mat.name}")
        
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

def heuristic_texture_linking(input_dir, dest_folder):
    """Finds all loose textures in the directory, copies them over, and attempts heuristic material linking."""
    texture_exts = {'.png', '.jpg', '.jpeg', '.tif', '.tiff', '.tga', '.exr'}
    found_textures = []
    
    dirs_to_search = [
        input_dir, 
        os.path.join(input_dir, 'Textures'), 
        os.path.join(input_dir, 'textures'),
        os.path.join(input_dir, 'Maps'),
        os.path.join(input_dir, 'maps'),
        os.path.join(input_dir, 'Images'),
        os.path.join(input_dir, 'images')
    ]
    for d in dirs_to_search:
        if os.path.exists(d):
            for f in os.listdir(d):
                if os.path.splitext(f)[1].lower() in texture_exts:
                    abs_path = os.path.join(d, f)
                    if abs_path not in found_textures:
                        found_textures.append(abs_path)
                        
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
            print(f"DEBUG: Failed to copy loose texture {tex}: {e}")

    # Load images into Blender to attempt heuristic material linking
    images = {}
    for tex in found_textures:
        try:
            # Check if it's already loaded
            img = bpy.data.images.get(os.path.basename(tex))
            if not img:
                img = bpy.data.images.load(tex)
            images[os.path.basename(tex).lower()] = img
        except:
            pass

    # Check for LLM generated texture map
    texture_map_path = os.path.join(input_dir, "texture_map.json")
    llm_map = None
    
    # Check if we should generate the map dynamically using Gemini
    gemini_key = sys.argv[-1] if len(sys.argv) > 5 else ""
    if len(gemini_key) > 30 and found_textures:
        import urllib.request, json
        print("DEBUG: Asking Gemini to map textures...")
        
        # Collect material names
        mat_names = [m.name for o in bpy.context.scene.objects if o.type == 'MESH' for m in o.data.materials if m]
        mat_names = list(set(mat_names))
        tex_names = [os.path.basename(t) for t in found_textures]
        
        prompt = f"""You are a 3D asset pipeline assistant.
Materials: {mat_names}
Textures: {tex_names}
Return a JSON object where keys are the exact Material names, and values are objects mapping socket names ('Base Color', 'Roughness', 'Metallic', 'Normal', 'Alpha', 'Emission') to exact Texture filenames. Do not use markdown."""
        
        body = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseMimeType": "application/json"}}
        import urllib.error, time
        
        max_retries = 3
        for attempt in range(max_retries):
            try:
                # Upgraded to gemini-2.5-flash as requested
                req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}", data=json.dumps(body).encode('utf-8'), headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(req) as response:
                    res_data = json.loads(response.read().decode('utf-8'))
                    llm_text = res_data['candidates'][0]['content']['parts'][0]['text']
                    llm_text = llm_text.replace('```json', '').replace('```', '').strip()
                    
                    # Save raw text to disk immediately to debug what the LLM actually said
                    try:
                        raw_path = os.path.join(input_dir, "texture_map_raw.txt")
                        with open(raw_path, 'w') as f:
                            f.write(llm_text)
                    except Exception as fe:
                        print(f"DEBUG: Failed to write raw map: {fe}")
                        
                    try:
                        llm_map = json.loads(llm_text)
                    except Exception as je:
                        print(f"DEBUG: Failed to parse LLM JSON: {je}. Raw output was: {llm_text}")
                        break
                    
                    # Save the JSON to disk so the user can debug the LLM's thought process!
                    try:
                        with open(texture_map_path, 'w') as f:
                            json.dump(llm_map, f, indent=2)
                    except:
                        pass
                        
                    print("DEBUG: Successfully mapped textures via Gemini API!")
                    break # Success, exit retry loop
            except urllib.error.HTTPError as e:
                error_body = e.read().decode('utf-8')
                print(f"DEBUG: Gemini API HTTP Error {e.code}: {error_body}")
                if e.code == 429 and attempt < max_retries - 1:
                    print("DEBUG: Rate limited. Waiting 10 seconds before retrying...")
                    time.sleep(10)
                else:
                    break
            except Exception as e:
                print(f"DEBUG: Gemini API mapping failed: {e}")
                break
            
    elif os.path.exists(texture_map_path):
        try:
            with open(texture_map_path, 'r') as f:
                llm_map = json.load(f)
            print("DEBUG: Successfully loaded LLM texture map!")
        except Exception as e:
            print(f"DEBUG: Failed to load texture_map.json: {e}")

    # Heuristic linking: Map textures to object's principled BSDF based on name overlap
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH': continue
        
        # If the object has no materials (like STL files), create a blank one for heuristics to use
        if len(obj.material_slots) == 0:
            new_mat = bpy.data.materials.new(name=f"Mat_{obj.name}")
            new_mat.use_nodes = True
            obj.data.materials.append(new_mat)
            
        # Clean object name (e.g. 'AGol_Branch.001' -> 'agol_branch')
        obj_name_clean = obj.name.lower().split('.')[0]
        has_uv = len(obj.data.uv_layers) > 0
        
        # USD Export physically cannot export Box Projection or Generated coordinates.
        # If mesh has no UVs (like STL), we MUST generate a real UV map so the texture bakes into the USD!
        if not has_uv:
            try:
                bpy.context.view_layer.objects.active = obj
                obj.select_set(True)
                bpy.ops.object.mode_set(mode='EDIT')
                bpy.ops.mesh.select_all(action='SELECT')
                # Cube projection simulates box mapping but writes actual UV data
                dim = max(obj.dimensions) if max(obj.dimensions) > 0 else 1.0
                bpy.ops.uv.cube_project(cube_size=dim)
                bpy.ops.object.mode_set(mode='OBJECT')
                obj.select_set(False)
                has_uv = True
                print(f"DEBUG: Generated Cube UV Map for {obj.name}")
            except Exception as e:
                print(f"DEBUG: Failed to generate UV map for {obj.name}: {e}")
                if bpy.context.object and bpy.context.object.mode != 'OBJECT':
                    bpy.ops.object.mode_set(mode='OBJECT')
        
        for mat_slot in obj.material_slots:
            mat = mat_slot.material
            if not mat: continue
            
            if not mat.use_nodes:
                mat.use_nodes = True
                
            bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if not bsdf: continue
            
            mat_name_clean = mat.name.lower()
            
            # Helper function to check if an input is linked to a valid node
            def is_validly_linked(socket):
                if not socket.is_linked: return False
                from_node = socket.links[0].from_node
                if from_node.type == 'TEX_IMAGE':
                    if not from_node.image or not from_node.image.has_data:
                        return False # Broken image node (renders pink)
                return True
                
            # Helper to add texture with UV mapping (Node Wrangler Ctrl+T)
            def add_mapped_texture(img, is_color=True):
                tex_node = mat.node_tree.nodes.new('ShaderNodeTexImage')
                tex_node.image = img
                if not is_color:
                    img.colorspace_settings.name = 'Non-Color'
                    
                uv_node = mat.node_tree.nodes.new('ShaderNodeTexCoord')
                mapping_node = mat.node_tree.nodes.new('ShaderNodeMapping')
                
                # If mesh has no UVs (like STL), use Box Projection mapping!
                if has_uv:
                    mat.node_tree.links.new(uv_node.outputs['UV'], mapping_node.inputs['Vector'])
                else:
                    mat.node_tree.links.new(uv_node.outputs['Generated'], mapping_node.inputs['Vector'])
                    tex_node.projection = 'BOX'
                    tex_node.projection_blend = 0.2
                    
                mat.node_tree.links.new(mapping_node.outputs['Vector'], tex_node.inputs['Vector'])
                return tex_node

            # Helper to check if texture matches object or material
            def texture_matches(tex_name, obj_name, mat_name):
                import re
                tex_base = os.path.splitext(tex_name)[0]
                obj_base = re.sub(r'[\._-]\d+$', '', obj_name)
                mat_base = re.sub(r'[\._-]\d+$', '', mat_name)
                
                # Split by common separators to get words
                tex_words = set(re.sub(r'[-\s]', '_', tex_base).split('_'))
                obj_words = set(re.sub(r'[-\s]', '_', obj_base).split('_'))
                mat_words = set(re.sub(r'[-\s]', '_', mat_base).split('_'))
                
                ignore = {'material', 'mat', 'wire', 'diffuse', 'color', 'basecolor', 'normal', 'nrm', 'nor', 'opacity', 'alpha', 'mask', 'jpg', 'png'}
                tex_sig = tex_words - ignore
                if tex_sig and (tex_sig & obj_words or tex_sig & mat_words):
                    return True
                return False

            # If LLM map exists, strictly apply it and bypass fuzzy logic
            if llm_map and mat.name in llm_map:
                mat_mapping = llm_map[mat.name]
                for socket_name, tex_filename in mat_mapping.items():
                    if socket_name in bsdf.inputs and not is_validly_linked(bsdf.inputs[socket_name]):
                        # Find the image object
                        img = next((i for name, i in images.items() if i.name == tex_filename or os.path.basename(i.filepath) == tex_filename), None)
                        if img:
                            is_color = socket_name in ['Base Color', 'Emission']
                            tex_node = add_mapped_texture(img, is_color=is_color)
                            
                            # Handle Normal Map special case
                            if socket_name == 'Normal':
                                normal_map = mat.node_tree.nodes.new('ShaderNodeNormalMap')
                                mat.node_tree.links.new(tex_node.outputs['Color'], normal_map.inputs['Color'])
                                mat.node_tree.links.new(normal_map.outputs['Normal'], bsdf.inputs['Normal'])
                            # Handle Alpha special case
                            elif socket_name == 'Alpha':
                                mat.node_tree.links.new(tex_node.outputs['Color'], bsdf.inputs['Alpha'])
                                if hasattr(mat, 'blend_method'):
                                    mat.blend_method = 'HASHED'
                            else:
                                mat.node_tree.links.new(tex_node.outputs['Color'], bsdf.inputs[socket_name])
                            print(f"DEBUG: LLM mapped {img.name} to {mat.name} ({socket_name})")
                continue # Skip fuzzy logic for this material since LLM handled it!

            mesh_count = len([o for o in bpy.context.scene.objects if o.type == 'MESH'])
            
            # Helper for fuzzy scoring
            def get_texture_score(tex_name, obj_words, target_keywords, penalty_keywords):
                import re
                tex_base = os.path.splitext(tex_name)[0]
                tex_words = set(re.sub(r'[-\s]', '_', tex_base).split('_'))
                
                # Base score from word overlap with object name
                score = len(tex_words.intersection(obj_words))
                
                # Bonus for target keywords
                if any(k in tex_name for k in target_keywords):
                    score += 2
                    
                # Massive penalty for wrong keywords
                if any(k in tex_name for k in penalty_keywords):
                    score -= 10
                    
                return score
            
            import re
            obj_base = re.sub(r'[\._-]\d+$', '', obj_name_clean)
            obj_words = set(re.sub(r'[-\s]', '_', obj_base).split('_'))
            
            # 1. Base Color
            if not is_validly_linked(bsdf.inputs['Base Color']):
                target_kws = ['diffuse', 'basecolor', 'albedo', 'color', 'col', 'dif']
                penalty_kws = ['normal', 'nrm', 'nor', 'opacity', 'alpha', 'mask', 'trans', 'rough', 'rgh', 'gloss', 'bump', 'bmp', 'disp', 'height', 'metal', 'spec']
                
                cands = []
                for tex_name, img in images.items():
                    if texture_matches(tex_name, obj_name_clean, mat_name_clean):
                        score = get_texture_score(tex_name, obj_words, target_kws, penalty_kws)
                        if score > -5: # Ensure we don't pick heavily penalized textures
                            cands.append((score, tex_name, img))
                
                if cands:
                    cands.sort(key=lambda x: x[0], reverse=True) # Sort by highest score
                    best_img = cands[0][2]
                    tex_node = add_mapped_texture(best_img, is_color=True)
                    mat.node_tree.links.new(tex_node.outputs['Color'], bsdf.inputs['Base Color'])
                    print(f"DEBUG: Fuzzy linked {best_img.name} to {mat.name} on {obj.name} (Base Color)")
                elif mesh_count == 1:
                    # Greedy fallback
                    diffuse_cands = [i for t, i in images.items() if any(k in t for k in target_kws) and not any(k in t for k in penalty_kws)]
                    if len(diffuse_cands) == 1:
                        tex_node = add_mapped_texture(diffuse_cands[0], is_color=True)
                        mat.node_tree.links.new(tex_node.outputs['Color'], bsdf.inputs['Base Color'])
                        print(f"DEBUG: Greedy Fallback linked {diffuse_cands[0].name} to {mat.name} (Base Color)")
                        
            # 2. Normal Map
            if 'Normal' in bsdf.inputs and not is_validly_linked(bsdf.inputs['Normal']):
                target_kws = ['normal', 'nrm', 'nor', 'bump', 'bmp']
                penalty_kws = ['diffuse', 'basecolor', 'albedo', 'color', 'col', 'dif', 'opacity', 'alpha', 'mask', 'trans', 'rough', 'rgh', 'gloss']
                
                cands = []
                for tex_name, img in images.items():
                    if texture_matches(tex_name, obj_name_clean, mat_name_clean):
                        score = get_texture_score(tex_name, obj_words, target_kws, penalty_kws)
                        if score > -5:
                            cands.append((score, tex_name, img))
                
                if cands:
                    cands.sort(key=lambda x: x[0], reverse=True)
                    best_img = cands[0][2]
                    tex_node = add_mapped_texture(best_img, is_color=False)
                    normal_map = mat.node_tree.nodes.new('ShaderNodeNormalMap')
                    mat.node_tree.links.new(tex_node.outputs['Color'], normal_map.inputs['Color'])
                    mat.node_tree.links.new(normal_map.outputs['Normal'], bsdf.inputs['Normal'])
                    print(f"DEBUG: Fuzzy linked {best_img.name} to {mat.name} on {obj.name} (Normal)")
                elif mesh_count == 1:
                    norm_cands = [i for t, i in images.items() if any(k in t for k in target_kws) and not any(k in t for k in penalty_kws)]
                    if len(norm_cands) == 1:
                        tex_node = add_mapped_texture(norm_cands[0], is_color=False)
                        normal_map = mat.node_tree.nodes.new('ShaderNodeNormalMap')
                        mat.node_tree.links.new(tex_node.outputs['Color'], normal_map.inputs['Color'])
                        mat.node_tree.links.new(normal_map.outputs['Normal'], bsdf.inputs['Normal'])
                        print(f"DEBUG: Greedy Fallback linked {norm_cands[0].name} to {mat.name} (Normal)")
                        
            # 3. Opacity / Alpha
            if 'Alpha' in bsdf.inputs and not is_validly_linked(bsdf.inputs['Alpha']):
                target_kws = ['opacity', 'alpha', 'mask', 'trans']
                penalty_kws = ['diffuse', 'basecolor', 'albedo', 'color', 'col', 'dif', 'normal', 'nrm', 'nor', 'rough', 'rgh', 'gloss', 'bump', 'bmp']
                
                cands = []
                for tex_name, img in images.items():
                    if texture_matches(tex_name, obj_name_clean, mat_name_clean):
                        score = get_texture_score(tex_name, obj_words, target_kws, penalty_kws)
                        if score > -5:
                            cands.append((score, tex_name, img))
                            
                if cands:
                    cands.sort(key=lambda x: x[0], reverse=True)
                    best_img = cands[0][2]
                    tex_node = add_mapped_texture(best_img, is_color=False)
                    mat.node_tree.links.new(tex_node.outputs['Color'], bsdf.inputs['Alpha'])
                    if hasattr(mat, 'blend_method'):
                        mat.blend_method = 'HASHED'
                    print(f"DEBUG: Fuzzy linked {best_img.name} to {mat.name} on {obj.name} (Alpha)")
                elif mesh_count == 1:
                    alpha_cands = [i for t, i in images.items() if any(k in t for k in target_kws) and not any(k in t for k in penalty_kws)]
                    if len(alpha_cands) == 1:
                        tex_node = add_mapped_texture(alpha_cands[0], is_color=False)
                        mat.node_tree.links.new(tex_node.outputs['Color'], bsdf.inputs['Alpha'])
                        if hasattr(mat, 'blend_method'):
                            mat.blend_method = 'HASHED'
                        print(f"DEBUG: Greedy Fallback linked {alpha_cands[0].name} to {mat.name} (Alpha)")

    return copied_count

def collect_and_relink_textures(dest_folder, input_file):
    """Find all image nodes, copy textures to dest_folder, and relink them."""
    if not os.path.exists(dest_folder):
        os.makedirs(dest_folder)
        
    input_dir = os.path.dirname(os.path.abspath(input_file))
    texture_count = 0
    
    for img in bpy.data.images:
        if img.source == 'FILE' and img.filepath:
            print(f"DEBUG: Processing image '{img.name}' with filepath '{img.filepath}'")
            # Resolve relative paths ('//') against the input file's directory instead of CWD
            if img.filepath.startswith('//'):
                rel_path = img.filepath[2:]
                abs_path = os.path.normpath(os.path.join(input_dir, rel_path))
            else:
                abs_path = bpy.path.abspath(img.filepath)

            if not os.path.exists(abs_path):
                print(f"DEBUG: Path {abs_path} not found. Trying aggressive fallback.")
                basename = os.path.basename(img.filepath.replace('\\', '/'))
                alt1 = os.path.join(input_dir, basename)
                alt2 = os.path.join(input_dir, "Textures", basename)
                alt3 = os.path.join(input_dir, "textures", basename)
                
                if os.path.exists(alt1): abs_path = alt1
                elif os.path.exists(alt2): abs_path = alt2
                elif os.path.exists(alt3): abs_path = alt3
                else:
                    # Also try to check if the image name itself is a file in the directory
                    alt4 = os.path.join(input_dir, img.name)
                    if os.path.exists(alt4): abs_path = alt4
            
            print(f"DEBUG: Final resolved path: {abs_path} (Exists: {os.path.exists(abs_path)})")
            
            if os.path.exists(abs_path):
                # Copy to textures folder
                filename = os.path.basename(abs_path)
                new_path = os.path.join(dest_folder, filename)
                
                try:
                    shutil.copy2(abs_path, new_path)
                    # Relink in Blender (using relative path to current blend context or just absolute for now)
                    img.filepath = new_path
                    texture_count += 1
                except Exception as e:
                    print(f"Failed to copy texture {abs_path}: {e}")
            else:
                print(f"Texture not found: {abs_path}")
                
    return texture_count

def generate_thumbnail(dest_path):
    """Render a 512x512 thumbnail."""
    # Setup Camera
    cam_data = bpy.data.cameras.new('ThumbnailCamera')
    cam_data.clip_end = 50000.0 # Increase clip end for huge STL files
    cam_obj = bpy.data.objects.new('ThumbnailCamera', cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj
    
    # Setup Lighting (Simple Sun + Environment)
    light_data = bpy.data.lights.new(name="Sun", type='SUN')
    light_data.energy = 5.0
    light_obj = bpy.data.objects.new(name="Sun", object_data=light_data)
    bpy.context.scene.collection.objects.link(light_obj)
    
    # Point sun diagonally
    light_obj.rotation_euler = (math.radians(45), 0, math.radians(45))
    
    # Add an ambient fill light so shadows aren't pitch black
    fill_data = bpy.data.lights.new(name="Fill", type='SUN')
    fill_data.energy = 1.0
    fill_obj = bpy.data.objects.new(name="Fill", object_data=fill_data)
    bpy.context.scene.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(-45), 0, math.radians(-135))
    
    # Create default clay material for STL/untextured files
    default_mat = bpy.data.materials.new(name="DefaultClay")
    default_mat.use_nodes = True
    if default_mat.node_tree:
        bsdf = default_mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (0.8, 0.8, 0.8, 1.0)
            bsdf.inputs['Roughness'].default_value = 0.4
    
    # Calculate bounding box to position camera
    min_co = [float('inf')] * 3
    max_co = [float('-inf')] * 3
    has_mesh = False
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            has_mesh = True
            
            # Apply default clay material if object has no materials (like STL files)
            if len(obj.material_slots) == 0:
                obj.data.materials.append(default_mat)
            for point in obj.bound_box:
                world_point = obj.matrix_world @ mathutils.Vector(point)
                for i in range(3):
                    min_co[i] = min(min_co[i], world_point[i])
                    max_co[i] = max(max_co[i], world_point[i])
                    
    if has_mesh:
        center = [(max_co[i] + min_co[i]) / 2 for i in range(3)]
        size = max(max_co[i] - min_co[i] for i in range(3))
        cam_obj.location = (center[0], center[1] - size * 1.5, center[2] + size * 0.5)
        
        # Point camera to center
        direction = mathutils.Vector(center) - cam_obj.location
        rot_quat = direction.to_track_quat('-Z', 'Y')
        cam_obj.rotation_euler = rot_quat.to_euler()
    else:
        cam_obj.location = (0, -10, 5)
        cam_obj.rotation_euler = (math.radians(60), 0, 0)
        
    # Render Settings
    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = 32
    bpy.context.scene.render.resolution_x = 512
    bpy.context.scene.render.resolution_y = 512
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.render.filepath = dest_path
    
    bpy.ops.render.render(write_still=True)

def main():
    argv = sys.argv
    if "--" not in argv:
        print("Error: Missing arguments after '--'")
        sys.exit(1)
        
    args = argv[argv.index("--") + 1:]
    if len(args) < 2:
        print("Usage: blender --background --python convert.py -- <input_file> <output_dir> <category>")
        sys.exit(1)
        
    input_file = args[0]
    output_dir = args[1]
    category = args[2] if len(args) > 2 else "Uncategorized"
    debug_blend_path = args[3] if len(args) > 3 else ""
    gemini_api_key = args[4] if len(args) > 4 else ""
    
    asset_id = str(uuid.uuid4())
    filename = os.path.basename(input_file)
    asset_name = os.path.splitext(filename)[0]
    source_format = os.path.splitext(filename)[1].lower().replace(".", "")
    
    print(f"Starting conversion for: {input_file}")
    
    # Create output directory
    asset_dir = os.path.join(output_dir, category, asset_name)
    os.makedirs(asset_dir, exist_ok=True)
    textures_dir = os.path.join(asset_dir, "textures")
    
    try:
        setup_scene()
        import_asset(input_file)
        normalize_scene()
        sanitize_materials()
        
        # Collect textures properly mapped in MTL
        texture_count = collect_and_relink_textures(textures_dir, input_file)
        
        # Run heuristic fallback for missing textures
        heuristic_count = heuristic_texture_linking(os.path.dirname(os.path.abspath(input_file)), textures_dir)
        texture_count = max(texture_count, heuristic_count)
        
        # Save debug .blend file if requested
        if debug_blend_path and os.path.exists(debug_blend_path):
            try:
                debug_file = os.path.join(debug_blend_path, f"{asset_name}_debug.blend")
                bpy.ops.wm.save_as_mainfile(filepath=debug_file)
                print(f"DEBUG: Saved debug blend file to {debug_file}")
            except Exception as e:
                print(f"DEBUG: Failed to save debug blend file: {e}")
        
        # Export USD
        usd_path = os.path.join(asset_dir, "asset.usd")
        bpy.ops.wm.usd_export(filepath=usd_path, selected_objects_only=False, export_textures=True, relative_paths=True)
        
        # Clear the messy original import and load the clean USD we just generated.
        # This guarantees the thumbnail is a 100% accurate representation of the final USD asset!
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.wm.usd_import(filepath=usd_path)
        
        # Generate Thumbnail
        thumbnail_path = os.path.join(asset_dir, "thumbnail.png")
        generate_thumbnail(thumbnail_path)
        
        # Create metadata
        metadata = {
            "id": asset_id,
            "name": asset_name,
            "category": category,
            "tags": [],
            "source_format": source_format,
            "date_added": datetime.now().isoformat(),
            "thumbnail": "thumbnail.png",
            "asset_path": "asset.usd",
            "texture_count": texture_count,
            "animated": False  # Simplified for MVP
        }
        
        with open(os.path.join(asset_dir, "metadata.json"), 'w') as f:
            json.dump(metadata, f, indent=2)
            
        print("Conversion completed successfully.")
        
    except Exception as e:
        import traceback
        print(f"Conversion failed: {e}")
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
