"""patch_materials.py — Apply material property overrides directly to a USD file.

Invoked by the Tauri backend:
  blender --background --python patch_materials.py -- <usd_path> <patches_json>

patches_json is a JSON array of:
  { "material": "<Blender mat name>", "property": "<prop>", "value": <number|[r,g,b]> }

Supported properties and their USD equivalents:
  Metallic              → metallic       (float)
  Roughness             → roughness      (float)
  Base Color            → diffuseColor   (vec3)
  Alpha                 → opacity        (float)
  IOR                   → ior            (float)
  Emission Strength     → emissiveColor  (scales existing vec3)
  Specular IOR Level    → specularColor  (float → grey vec3)
  Normal Map Strength   → patched via Blender fallback (no clean USD mapping)
"""

import sys
import os
import json
import re

argv = sys.argv
if "--" not in argv:
    print("ERROR: Missing arguments after '--'")
    sys.exit(1)

args = argv[argv.index("--") + 1:]
if len(args) < 2:
    print("ERROR: Usage: patch_materials.py -- <usd_path> <patches_json>")
    sys.exit(1)

usd_path   = os.path.abspath(args[0])
patches    = json.loads(args[1])

# ---------------------------------------------------------------------------
# Name normalisation — Blender material names get sanitised for USD prim paths
# (dots → underscore, leading digits prefixed, etc.).  We normalise both sides
# for matching rather than relying on exact string equality.
# ---------------------------------------------------------------------------
def _norm(name):
    n = re.sub(r'\.\d{3,}$', '', name)      # strip Blender .001 suffixes
    n = re.sub(r'[^a-zA-Z0-9]', '_', n)     # non-alphanumeric → _
    return n.lower()

# ---------------------------------------------------------------------------
# USD property map
# ---------------------------------------------------------------------------
_USD_PROP = {
    'Metallic':           'metallic',
    'Roughness':          'roughness',
    'Base Color':         'diffuseColor',
    'Alpha':              'opacity',
    'IOR':                'ior',
}

# ---------------------------------------------------------------------------
# Attempt pxr-based direct edit (fast, surgical, preserves USD structure)
# ---------------------------------------------------------------------------
patched_count = 0
pxr_ok = False

try:
    from pxr import Usd, UsdShade, Gf

    stage = Usd.Stage.Open(usd_path)

    # Build a lookup: normalised_name → list of patches
    patch_map = {}
    for p in patches:
        patch_map.setdefault(_norm(p['material']), []).append(p)

    for prim in stage.Traverse():
        if not prim.IsA(UsdShade.Shader):
            continue
        shader = UsdShade.Shader(prim)
        if shader.GetIdAttr().Get() != 'UsdPreviewSurface':
            continue

        # Walk up to the nearest Material prim to get the canonical name
        mat_name = None
        cur = prim.GetParent()
        while cur and cur.IsValid() and cur.GetPath() != Usd.Stage.GetPseudoRoot(stage).GetPath():
            if UsdShade.Material(cur):
                mat_name = cur.GetName()
                break
            cur = cur.GetParent()
        if not mat_name:
            mat_name = prim.GetParent().GetName() if prim.GetParent() else prim.GetName()

        applicable = patch_map.get(_norm(mat_name), [])
        for patch in applicable:
            prop  = patch['property']
            value = patch['value']

            if prop == 'Emission Strength':
                # Scale the existing emissiveColor by the new strength
                em_inp = shader.GetInput('emissiveColor')
                if em_inp and not em_inp.HasConnectedSource():
                    cur_col = em_inp.Get() or Gf.Vec3f(1, 1, 1)
                    # Normalise current colour to unit and re-scale
                    mag = max(cur_col[0], cur_col[1], cur_col[2], 1e-6)
                    unit = Gf.Vec3f(cur_col[0]/mag, cur_col[1]/mag, cur_col[2]/mag)
                    new_col = Gf.Vec3f(unit[0]*value, unit[1]*value, unit[2]*value)
                    em_inp.Set(new_col)
                    patched_count += 1
                    print(f"DEBUG pxr: patched {mat_name}.emissiveColor scaled to {value}")
                continue

            if prop in ('Specular IOR Level', 'Specular'):
                spec_inp = shader.GetInput('specularColor')
                if spec_inp and not spec_inp.HasConnectedSource():
                    v = float(value)
                    spec_inp.Set(Gf.Vec3f(v, v, v))
                    patched_count += 1
                    print(f"DEBUG pxr: patched {mat_name}.specularColor = {v}")
                continue

            if prop == 'Normal Map Strength':
                # No clean USD mapping — handled by Blender fallback below
                print(f"DEBUG pxr: skipping Normal Map Strength (needs Blender fallback)")
                continue

            usd_inp_name = _USD_PROP.get(prop)
            if not usd_inp_name:
                print(f"DEBUG pxr: unknown property '{prop}' — skipping")
                continue

            inp = shader.GetInput(usd_inp_name)
            if not inp:
                print(f"DEBUG pxr: input '{usd_inp_name}' not found on {mat_name}")
                continue
            if inp.HasConnectedSource():
                print(f"DEBUG pxr: {mat_name}.{usd_inp_name} is texture-driven — skipping")
                continue

            if isinstance(value, list) and len(value) == 3:
                inp.Set(Gf.Vec3f(value[0], value[1], value[2]))
            else:
                inp.Set(float(value))

            patched_count += 1
            print(f"DEBUG pxr: patched {mat_name}.{usd_inp_name} = {value}")

    stage.Save()
    pxr_ok = True
    print(f"PATCH_OK: {patched_count} value(s) updated via pxr")

except Exception as _pxr_err:
    print(f"DEBUG: pxr path failed ({_pxr_err}), falling back to Blender import/export")

# ---------------------------------------------------------------------------
# Blender fallback — re-import USD, patch Principled BSDF nodes, re-export
# Used when pxr is unavailable OR for properties with no clean USD mapping
# (e.g. Normal Map Strength).
# ---------------------------------------------------------------------------
if not pxr_ok:
    try:
        import bpy

        # Check if any patch needs the Blender path
        needs_blender = any(
            p['property'] in ('Normal Map Strength',) or _USD_PROP.get(p['property']) is None
            for p in patches
        ) or not pxr_ok

        if needs_blender:
            # Clean scene
            for obj in list(bpy.context.scene.objects):
                bpy.data.objects.remove(obj, do_unlink=True)

            bpy.ops.wm.usd_import(filepath=usd_path)

            for patch in patches:
                mat_name = patch['material']
                prop     = patch['property']
                value    = patch['value']

                mat = bpy.data.materials.get(mat_name)
                if not mat:
                    norm = _norm(mat_name)
                    mat  = next((m for m in bpy.data.materials if _norm(m.name) == norm), None)
                if not mat or not mat.use_nodes:
                    print(f"DEBUG blender: material '{mat_name}' not found")
                    continue

                bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
                if not bsdf:
                    continue

                if prop == 'Normal Map Strength':
                    normal_inp = bsdf.inputs.get('Normal')
                    if normal_inp and normal_inp.is_linked:
                        from_node = normal_inp.links[0].from_node
                        if from_node.type == 'NORMAL_MAP':
                            str_inp = from_node.inputs.get('Strength')
                            if str_inp:
                                str_inp.default_value = float(value)
                                patched_count += 1
                                print(f"DEBUG blender: patched {mat_name} normal strength = {value}")
                    continue

                if prop not in bsdf.inputs or bsdf.inputs[prop].is_linked:
                    print(f"DEBUG blender: skipping {mat_name}.{prop} (not found or texture-driven)")
                    continue

                inp = bsdf.inputs[prop]
                if isinstance(value, list):
                    inp.default_value = (*value, 1.0) if len(value) == 3 else value
                else:
                    inp.default_value = float(value)

                patched_count += 1
                print(f"DEBUG blender: patched {mat_name}.{prop} = {value}")

            # Re-export (geometry only — textures stay in place)
            bpy.ops.object.select_all(action='SELECT')
            bpy.ops.wm.usd_export(
                filepath=usd_path,
                selected_objects_only=False,
                export_textures=False,
                relative_paths=True,
            )
            print(f"PATCH_OK: {patched_count} value(s) updated via Blender re-export")

    except Exception as _bl_err:
        print(f"ERROR: Blender fallback also failed: {_bl_err}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
