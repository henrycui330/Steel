#!/usr/bin/env bash
# Convert IsolatedSoulStudio PanzerIV.zip → public/models/pz4.glb
# Critical: mesh origin is geometry CENTER — place by nudging world AABB, not location.z alone.
set -euo pipefail
SRC_DIR="${1:-}"
[[ -n "$SRC_DIR" && -d "$SRC_DIR" ]] || { echo "Usage: $0 /path/to/PanzerIV-folder"; exit 1; }
BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
[[ -x "$BLENDER" ]] || { echo "Blender not found"; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/models/pz4.glb"
BODY="$(find "$SRC_DIR" -iname 'PanzerIV_Body.fbx' | head -1)"
TURRET="$(find "$SRC_DIR" -iname 'PanzerIV_Turret.fbx' | head -1)"
BARREL="$(find "$SRC_DIR" -iname 'PanzerIV_Barrel.fbx' | head -1)"
[[ -n "$BODY" && -n "$TURRET" && -n "$BARREL" ]] || { echo "Missing FBX parts"; exit 1; }

"$BLENDER" --background --python-expr "
import bpy, math, bmesh
from mathutils import Vector, Matrix
bpy.ops.wm.read_factory_settings(use_empty=True)

def import_mesh(path, name):
    before={o.name for o in bpy.data.objects}
    bpy.ops.import_scene.fbx(filepath=path)
    for o in list(bpy.data.objects):
        if o.name in before: continue
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    meshes=[o for o in bpy.data.objects if o.name not in before and o.type=='MESH']
    if len(meshes)>1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes: o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
        root = bpy.context.view_layer.objects.active
    else:
        root = meshes[0]
    mw = root.matrix_world.copy(); root.parent=None; root.matrix_world=mw
    root.name=name
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True); bpy.context.view_layer.objects.active=root
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    return root

def world_bb(o):
    bpy.context.view_layer.update()
    corners=[o.matrix_world @ Vector(c) for c in o.bound_box]
    minv=Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners)))
    maxv=Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))
    return minv, maxv, (minv+maxv)*0.5

def rotate_mesh_z(obj, degrees):
    bm=bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.rotate(bm, cent=Vector((0,0,0)), matrix=Matrix.Rotation(math.radians(degrees), 3, 'Z'), verts=bm.verts)
    bm.to_mesh(obj.data); bm.free(); obj.data.update()
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); bpy.context.view_layer.objects.active=obj
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')

hull=import_mesh(r'''$BODY''','Hull')
turret=import_mesh(r'''$TURRET''','Turret')
barrel=import_mesh(r'''$BARREL''','Barrel')
rotate_mesh_z(barrel, 180)
hmin,hmax,hcen=world_bb(hull)
tmin,tmax,tcen=world_bb(turret)
turret.location.x += hcen.x - tcen.x
turret.location.y += hcen.y - tcen.y - 0.1
bpy.context.view_layer.update()
tmin,tmax,tcen=world_bb(turret)
turret.location.z += (hmax.z + 0.06) - tmin.z
bpy.context.view_layer.update()
tmin,tmax,tcen=world_bb(turret)
assert tmin.z >= hmax.z, (tmin.z, hmax.z)
bmin,bmax,bcen=world_bb(barrel)
barrel.location.x += tcen.x - bcen.x
barrel.location.z += (tmin.z + (tmax.z-tmin.z)*0.42) - bcen.z
bpy.context.view_layer.update()
bmin,bmax,bcen=world_bb(barrel)
barrel.location.y += (tmin.y + 0.15) - bmax.y
olive=(0.22, 0.26, 0.18, 1.0)
for obj, shade in ((hull, olive), (turret, (0.24, 0.28, 0.19, 1.0)), (barrel, (0.18, 0.20, 0.14, 1.0))):
    mat=bpy.data.materials.new(obj.name+'Mat'); mat.use_nodes=True
    bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = shade
    bsdf.inputs['Roughness'].default_value = 0.85
    obj.data.materials.clear(); obj.data.materials.append(mat)
bpy.ops.export_scene.gltf(filepath=r'''$OUT''', export_format='GLB', export_apply=True, export_yup=True, export_materials='EXPORT')
print('Wrote', r'''$OUT''', 'turret gap', round(tmin.z-hmax.z,3))
"
ls -lh "$OUT"
