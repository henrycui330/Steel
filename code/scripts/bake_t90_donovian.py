"""Bake Donovian T-90 single mesh into named Hull + Turret GLB.

Cut at the **hull deck** (under the turret ring), not through the turret.
Keep both meshes in one shared world frame (no per-mesh origin recenter)
so they stay locked together after export.
"""
import bpy
import bmesh
import math
import os
from mathutils import Vector

SRC = os.environ.get(
    "STEEL_T90_IN",
    "/Users/cheesydonut/Steel/Tanks/Soviet:Russian tanks/t90.glb",
)
OUT = os.environ.get(
    "STEEL_T90_OUT",
    "/Users/cheesydonut/Steel/code/public/models/t90.glb",
)
# Deck under turret ring (fraction of Blender-Z height after import).
Z_CUT_FRAC = float(os.environ.get("STEEL_T90_YCUT", "0.36"))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("no meshes in T-90 GLB")
src = None
for o in meshes:
    if o.name.startswith("Object_4"):
        src = o
        break
if src is None:
    src = max(meshes, key=lambda o: len(o.data.vertices))
print(f"[bake_t90] source mesh={src.name} verts={len(src.data.vertices)}")

for o in list(bpy.context.scene.objects):
    if o.type != "MESH":
        continue
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.select_set(False)

bpy.context.view_layer.update()

# Face gun toward Blender −Y (= glTF +Z on Yup export). Authored +Y after import.
src.rotation_euler[2] = math.pi
bpy.context.view_layer.objects.active = src
src.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
src.select_set(False)
bpy.context.view_layer.update()

coords = [src.matrix_world @ v.co for v in src.data.vertices]
xs = [c.x for c in coords]
ys = [c.y for c in coords]
zs = [c.z for c in coords]
z_min, z_max = min(zs), max(zs)
y_min, y_max = min(ys), max(ys)
z_cut = z_min + (z_max - z_min) * Z_CUT_FRAC
# Barrel corridor (gun points −Y after yaw).
z_barrel = z_min + (z_max - z_min) * 0.28
gun_half_w = 0.55
y_mantlet = y_min + (y_max - y_min) * 0.45
print(
    f"[bake_t90] size X={max(xs)-min(xs):.3f} "
    f"Y={y_max-y_min:.3f} Z={z_max-z_min:.3f} "
    f"z_cut={z_cut:.3f} (frac={Z_CUT_FRAC}) z_barrel={z_barrel:.3f}"
)

turret = src.copy()
turret.data = src.data.copy()
turret.name = "Turret"
bpy.context.scene.collection.objects.link(turret)
src.name = "Hull"


def is_turret_vert(co):
    if co.z >= z_cut:
        return True
    if co.z >= z_barrel and abs(co.x) <= gun_half_w and co.y <= y_mantlet:
        return True
    return False


def peel(obj, keep_turret: bool):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    mw = obj.matrix_world
    to_del = []
    for f in bm.faces:
        score = sum(1 for v in f.verts if is_turret_vert(mw @ v.co))
        is_tur = score >= 2
        keep = is_tur if keep_turret else not is_tur
        if not keep:
            to_del.append(f)
    bmesh.ops.delete(bm, geom=to_del, context="FACES")
    # Drop loose verts
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    print(f"[bake_t90] {obj.name}: faces={len(obj.data.polygons)} verts={len(obj.data.vertices)}")


peel(turret, keep_turret=True)
peel(src, keep_turret=False)

for o in list(bpy.context.scene.objects):
    if o.type != "MESH":
        bpy.data.objects.remove(o, do_unlink=True)

# Shared frame: force both objects to identity transform with verts in the
# same world space (do NOT origin_set per mesh — that caused floating lids).
bpy.context.view_layer.update()
all_coords = []
for o in (src, turret):
    all_coords.extend(o.matrix_world @ v.co for v in o.data.vertices)
cx = 0.5 * (min(c.x for c in all_coords) + max(c.x for c in all_coords))
cy = 0.5 * (min(c.y for c in all_coords) + max(c.y for c in all_coords))
zmin = min(c.z for c in all_coords)
delta = Vector((-cx, -cy, -zmin))


def shift_mesh(obj, d):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for v in bm.verts:
        v.co = obj.matrix_world @ v.co + d
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    obj.matrix_world = __import__("mathutils").Matrix.Identity(4)
    obj.location = (0, 0, 0)
    obj.rotation_euler = (0, 0, 0)
    obj.scale = (1, 1, 1)


shift_mesh(src, delta)
shift_mesh(turret, delta)
bpy.context.view_layer.update()

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
)

# Verify
hull_z = [v.co.z for v in src.data.vertices]
tur_z = [v.co.z for v in turret.data.vertices]
print(f"[bake_t90] wrote {OUT}")
print(
    f"[bake_t90] Hull Z={min(hull_z):.2f}..{max(hull_z):.2f} "
    f"Turret Z={min(tur_z):.2f}..{max(tur_z):.2f} "
    f"(Blender Z=up; gap={min(tur_z)-max(hull_z):.3f})"
)
