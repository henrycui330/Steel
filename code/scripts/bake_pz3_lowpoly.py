"""Bake panzer_3l_low-poly: apply stacked scales, keep Hull/Turret/Wheels/tracks, export."""
import bpy
import math
from mathutils import Vector

SRC = __import__("os").environ.get(
    "STEEL_PZ3_IN",
    "/Users/cheesydonut/Steel/Tanks/German Tanks/panzer_3l_low-poly.glb",
)
OUT = __import__("os").environ.get(
    "STEEL_PZ3_OUT",
    "/Users/cheesydonut/Steel/code/public/models/pz3.glb",
)
TARGET_LENGTH = 5.5  # Pz-III is a bit shorter than Pz-IV

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# Tag meshes by nearest named ancestor (Hull / Turret / Wheels / tracks)
ROLE_NAMES = ("Hull", "Turret", "Wheels", "tracks")


def role_for(obj):
    p = obj
    while p is not None:
        if p.name in ROLE_NAMES:
            return p.name
        p = p.parent
    return "Hull"


mesh_roles = {}
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    mesh_roles[obj.name] = role_for(obj)
    print(f"role {obj.name} <- {mesh_roles[obj.name]}")

# Bake world transforms into each mesh
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        bpy.data.objects.remove(obj, do_unlink=True)

by_role = {n: [] for n in ROLE_NAMES}
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    role = mesh_roles.get(obj.name, "Hull")
    by_role.setdefault(role, []).append(obj)


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def join_role(role, out_name):
    parts = by_role.get(role) or []
    if not parts:
        print(f"WARN: no meshes for {role}")
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
    if len(parts) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = out_name
    return joined


hull = join_role("Hull", "Hull")
turret = join_role("Turret", "Turret")
wheels = join_role("Wheels", "Wheels")
tracks = join_role("tracks", "Tracks")

parts = [p for p in (hull, turret, wheels, tracks) if p is not None]
if not parts:
    raise RuntimeError("No parts")


def world_bbox_objs(objs):
    bpy.context.view_layer.update()
    pts = []
    for obj in objs:
        pts.extend(obj.matrix_world @ Vector(c) for c in obj.bound_box)
    mn = Vector((min(v.x for v in pts), min(v.y for v in pts), min(v.z for v in pts)))
    mx = Vector((max(v.x for v in pts), max(v.y for v in pts), max(v.z for v in pts)))
    return mn, mx, mx - mn


def plant_center_all(objs):
    mn, mx, _ = world_bbox_objs(objs)
    cx = (mn.x + mx.x) * 0.5
    cy = (mn.y + mx.y) * 0.5
    for obj in objs:
        select_only(obj)
        obj.location.x -= cx
        obj.location.y -= cy
        obj.location.z -= mn.z
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


for obj in parts:
    select_only(obj)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")

plant_center_all(parts)

mn, mx, size = world_bbox_objs(parts)
print(f"Pre-scale W={abs(size.x):.3f} D={abs(size.y):.3f} H={abs(size.z):.3f}")

longest = max(abs(size.x), abs(size.y), abs(size.z))
s = TARGET_LENGTH / max(longest, 1e-6)
for obj in parts:
    select_only(obj)
    obj.scale = (s, s, s)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

mn, mx, size = world_bbox_objs(parts)
# Length along Y (Blender)
if abs(size.x) >= abs(size.y):
    for obj in parts:
        select_only(obj)
        obj.rotation_euler[2] = math.radians(90)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    print("Rotated 90deg so length along Y")

plant_center_all(parts)

# Parent wheels/tracks under Hull so they stay with chassis when turret yaws
for child in (wheels, tracks):
    if child is None or hull is None:
        continue
    mw = child.matrix_world.copy()
    child.parent = hull
    child.matrix_world = mw
    print(f"Parented {child.name} under Hull")

bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
root = bpy.context.view_layer.objects.active
root.name = "PanzerIII"
for obj in (hull, turret):
    if obj is None:
        continue
    mw = obj.matrix_world.copy()
    obj.parent = root
    obj.matrix_world = mw

mn, mx, size = world_bbox_objs([o for o in (hull, turret) if o])
print(f"CLEAN FINAL W={abs(size.x):.3f} Depth={abs(size.y):.3f} H={abs(size.z):.3f}")
print("parts:", [o.name for o in bpy.context.scene.objects if o.type in ("MESH", "EMPTY")])

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=False,
    export_apply=True,
    export_yup=True,
)
print("Wrote", OUT)
