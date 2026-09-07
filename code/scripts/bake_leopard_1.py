"""Bake Leopard 1 GLB: Hull / Turret / Barrel (fused tracks stay on Hull)."""
import bpy
import math
from mathutils import Vector

SRC = __import__("os").environ.get(
    "STEEL_LEOPARD_IN",
    "/Users/cheesydonut/Steel/Tanks/German Tanks/tank_leopard_1.glb",
)
OUT = __import__("os").environ.get(
    "STEEL_LEOPARD_OUT",
    "/Users/cheesydonut/Steel/code/public/models/leopard.glb",
)
TARGET_LENGTH = 9.5  # Leopard 1 ~9.5m with gun

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)


def ancestor_names(obj):
    names = []
    p = obj
    while p is not None:
        names.append(p.name.lower())
        p = p.parent
    return names


def classify(obj):
    joined = " ".join(ancestor_names(obj))
    mesh_l = obj.name.lower()
    if "gun" in joined or mesh_l.startswith("gun"):
        return "barrel"
    if "turret" in joined:
        return "turret"
    # Tracks / chassis / hull → hull (no separate road wheels in this pack)
    return "hull"


mesh_roles = {}
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    if len(obj.data.vertices) < 8:
        mesh_roles[obj.name] = "drop"
        continue
    mesh_roles[obj.name] = classify(obj)
    print(f"role {obj.name[:55]:55} <- {mesh_roles[obj.name]}")

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

for obj in list(bpy.context.scene.objects):
    if obj.type == "MESH" and mesh_roles.get(obj.name) == "drop":
        bpy.data.objects.remove(obj, do_unlink=True)

by_role = {"hull": [], "turret": [], "barrel": []}
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    role = mesh_roles.get(obj.name, "hull")
    if role == "drop":
        continue
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


hull = join_role("hull", "Hull")
turret = join_role("turret", "Turret")
barrel = join_role("barrel", "Barrel")
parts = [p for p in (hull, turret, barrel) if p is not None]
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
# Match pz4 / panther v4: length on Y. If already on Y, still flip 180 so nose matches game +Z.
yaw_deg = 180.0
if abs(size.x) >= abs(size.y):
    yaw_deg = 270.0  # sideways → length on Y + nose flip
bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
align = bpy.context.view_layer.objects.active
align.name = "AlignYaw"
for obj in parts:
    mw = obj.matrix_world.copy()
    obj.parent = align
    obj.matrix_world = mw
align.rotation_euler[2] = math.radians(yaw_deg)
bpy.context.view_layer.update()
bpy.ops.object.select_all(action="DESELECT")
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
for obj in parts:
    select_only(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.data.objects.remove(align, do_unlink=True)
print(f"Rotated assembly +{yaw_deg:.0f}° Z")

plant_center_all(parts)

bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
root = bpy.context.view_layer.objects.active
root.name = "Leopard1"
for obj in parts:
    mw = obj.matrix_world.copy()
    obj.parent = root
    obj.matrix_world = mw

mn, mx, size = world_bbox_objs(parts)
print(f"CLEAN FINAL W={abs(size.x):.3f} Depth={abs(size.y):.3f} H={abs(size.z):.3f}")
if barrel:
    bp = [barrel.matrix_world @ Vector(c) for c in barrel.bound_box]
    print(
        "barrel size",
        round(max(p.x for p in bp) - min(p.x for p in bp), 3),
        round(max(p.y for p in bp) - min(p.y for p in bp), 3),
        round(max(p.z for p in bp) - min(p.z for p in bp), 3),
    )
    print("barrel center Y", round(sum(p.y for p in bp) / 8, 3))

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=False,
    export_apply=False,
    export_yup=True,
)
print("Wrote", OUT)
