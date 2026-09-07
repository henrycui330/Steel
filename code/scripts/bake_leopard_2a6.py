"""Bake War Thunder Leopard 2A6 — clean Object_* pack, no duplicate chassis."""
import bpy
import math
from mathutils import Vector

SRC = "/Users/cheesydonut/Steel/Tanks/German Tanks/leopard_2a6_war_thunder.glb"
OUT = "/Users/cheesydonut/Steel/code/public/models/leopard2.glb"
TARGET = 9.7

# Gun tube + muzzle tip
BARREL = {"Object_11", "Object_8"}
# Upper structure / turret / optics (skip WT alpha-disk helpers)
TURRET = {
    "Object_3",
    "Object_4",
    # Object_5 — flat BLEND disk at mantlet
    # Object_9 — tiny BLEND disk pair
    # Object_10 — flat HASHED plane above barrel
    "Object_12",
    "Object_14",
    "Object_24",
    "Object_25",
    "Object_26",
    "Object_27",
}
# Explicitly delete these if present (alpha artifacts)
DROP = {"Object_5", "Object_9", "Object_10"}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def role_for(name):
    if name in DROP:
        return "drop"
    if name in BARREL:
        return "barrel"
    if name in TURRET:
        return "turret"
    return "hull"


# Apply world transforms
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    select_only(obj)
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        bpy.data.objects.remove(obj, do_unlink=True)

by_role = {"hull": [], "turret": [], "barrel": []}
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    if len(obj.data.vertices) < 4:
        bpy.data.objects.remove(obj, do_unlink=True)
        continue
    r = role_for(obj.name)
    if r == "drop":
        print(f"DROP disk {obj.name}")
        bpy.data.objects.remove(obj, do_unlink=True)
        continue
    by_role[r].append(obj)
    print(f"{obj.name:12} -> {r}  v={len(obj.data.vertices)}")


def join_role(role, out_name):
    parts = by_role[role]
    if not parts:
        raise RuntimeError(f"No {role} meshes")
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
parts = [hull, turret, barrel]


def bbox_all(objs):
    bpy.context.view_layer.update()
    pts = []
    for o in objs:
        pts.extend(o.matrix_world @ Vector(c) for c in o.bound_box)
    mn = Vector((min(v.x for v in pts), min(v.y for v in pts), min(v.z for v in pts)))
    mx = Vector((max(v.x for v in pts), max(v.y for v in pts), max(v.z for v in pts)))
    return mn, mx, mx - mn


def plant(objs):
    mn, mx, _ = bbox_all(objs)
    cx = (mn.x + mx.x) * 0.5
    cy = (mn.y + mx.y) * 0.5
    for o in objs:
        select_only(o)
        o.location.x -= cx
        o.location.y -= cy
        o.location.z -= mn.z
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


for o in parts:
    select_only(o)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")

plant(parts)
mn, mx, size = bbox_all(parts)
print(f"pre W={abs(size.x):.2f} D={abs(size.y):.2f} H={abs(size.z):.2f}")
s = TARGET / max(abs(size.x), abs(size.y), abs(size.z), 1e-6)
for o in parts:
    select_only(o)
    o.scale = (s, s, s)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# Facing: 0° = 180° flip from v8 bake
mn, mx, size = bbox_all(parts)
yaw = 0.0 if abs(size.y) >= abs(size.x) else 90.0
bpy.ops.object.empty_add(location=(0, 0, 0))
align = bpy.context.object
for o in parts:
    mw = o.matrix_world.copy()
    o.parent = align
    o.matrix_world = mw
align.rotation_euler[2] = math.radians(yaw)
bpy.context.view_layer.update()
bpy.ops.object.select_all(action="DESELECT")
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
for o in parts:
    select_only(o)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.data.objects.remove(align, do_unlink=True)
print(f"yaw +{yaw}")

plant(parts)

# Turret origin at hull-ring (don't move empty after parent)
hmn, hmx, _ = bbox_all([hull])
tmn, _, _ = bbox_all([turret])
ring = Vector(((hmn.x + hmx.x) * 0.5, (hmn.y + hmx.y) * 0.5, tmn.z))
select_only(turret)
bpy.context.scene.cursor.location = ring
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
select_only(barrel)
bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
select_only(hull)
bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
plant(parts)
# Re-apply turret ring after plant
hmn, hmx, _ = bbox_all([hull])
tmn, _, _ = bbox_all([turret])
ring = Vector(((hmn.x + hmx.x) * 0.5, (hmn.y + hmx.y) * 0.5, tmn.z))
select_only(turret)
bpy.context.scene.cursor.location = ring
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")

bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
root = bpy.context.object
root.name = "Leopard2A6"
for o in parts:
    mw = o.matrix_world.copy()
    o.parent = root
    o.matrix_world = mw

mn, mx, size = bbox_all(parts)
print(f"FINAL W={abs(size.x):.2f} D={abs(size.y):.2f} H={abs(size.z):.2f}")
bp = [barrel.matrix_world @ Vector(c) for c in barrel.bound_box]
print(
    "barrel Y",
    round(min(p.y for p in bp), 2),
    "..",
    round(max(p.y for p in bp), 2),
    "centerY",
    round(sum(p.y for p in bp) / 8, 2),
)
print("turret loc", tuple(round(x, 3) for x in turret.location))

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=False,
    export_apply=False,
    export_yup=True,
)
print("Wrote", OUT)
