"""Bake Panther A mid-prod GLB: apply transforms, Hull/Turret/Barrel + road wheels."""
import bpy
import math
from mathutils import Vector

SRC = __import__("os").environ.get(
    "STEEL_PANTHER_IN",
    "/Users/cheesydonut/Steel/Tanks/German Tanks/panther-a_mid_prod..glb",
)
OUT = __import__("os").environ.get(
    "STEEL_TIGER_OUT",
    "/Users/cheesydonut/Steel/code/public/models/tiger.glb",
)
TARGET_LENGTH = 6.9  # Panther ~6.9m

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
    names = ancestor_names(obj)
    joined = " ".join(names)
    mesh_l = obj.name.lower()
    # Main gun
    if "weapon.001" in mesh_l or (
        "weapon" in joined and "weapon2" not in mesh_l and "turret" in joined
    ):
        if "weapon2" in mesh_l:
            return "turret"
        return "barrel"
    if "turret" in joined:
        return "turret"
    # Individual road wheels (keep separate for spin)
    if "wheel" in mesh_l or any(n.startswith("wheel") for n in names):
        # track meshes also may mention wheel textures — exclude track runs
        if "track" in mesh_l and "wheel" not in mesh_l.split("_")[0]:
            return "hull"
        if mesh_l.startswith("track") or "track2" in joined or "track.001" in joined:
            return "hull"
        # gear sprockets named gear* stay hull; wheel* are wheels
        if "wheel" in mesh_l or any(n.startswith("wheel") for n in names if n.startswith("wheel")):
            return "wheel"
    return "hull"


mesh_roles = {}
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    # Skip tiny placeholder option stubs
    if len(obj.data.vertices) < 8:
        mesh_roles[obj.name] = "drop"
        continue
    mesh_roles[obj.name] = classify(obj)
    print(f"role {obj.name[:50]:50} <- {mesh_roles[obj.name]}")

# Bake world transforms
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

# Drop stubs
for obj in list(bpy.context.scene.objects):
    if obj.type == "MESH" and mesh_roles.get(obj.name) == "drop":
        bpy.data.objects.remove(obj, do_unlink=True)

by_role = {"hull": [], "turret": [], "barrel": [], "wheel": []}
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
wheels = list(by_role.get("wheel") or [])
for i, w in enumerate(wheels):
    w.name = f"Wheel_{i}"

parts = [p for p in (hull, turret, barrel) if p is not None] + wheels
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
# Rotate the WHOLE assembly around world origin (not each mesh's own center).
# Per-mesh yaw left length on X and left wheel origins at tank center → tracks tumble as one.
if abs(size.x) >= abs(size.y):
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    align = bpy.context.view_layer.objects.active
    align.name = "AlignYaw"
    for obj in parts:
        mw = obj.matrix_world.copy()
        obj.parent = align
        obj.matrix_world = mw
    # +90° puts length on Y; +180° more flips nose to match game forward (+Z).
    align.rotation_euler[2] = math.radians(270)
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
    print("Rotated assembly +270° Z (length on Y, nose flipped 180 from v3)")

plant_center_all(parts)

# Wheel hubs must be object origins — otherwise spin orbits the tank center.
for w in wheels:
    select_only(w)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")

if hull:
    for w in wheels:
        mw = w.matrix_world.copy()
        w.parent = hull
        w.matrix_world = mw
    print(f"Parented {len(wheels)} wheels under Hull (hub origins)")

bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
root = bpy.context.view_layer.objects.active
root.name = "PantherA"
for obj in (hull, turret, barrel):
    if obj is None:
        continue
    mw = obj.matrix_world.copy()
    obj.parent = root
    obj.matrix_world = mw

mn, mx, size = world_bbox_objs(parts)
print(f"CLEAN FINAL W={abs(size.x):.3f} Depth={abs(size.y):.3f} H={abs(size.z):.3f}")
print(
    "parts:",
    [o.name for o in bpy.context.scene.objects if o.type in ("MESH", "EMPTY")],
)
print(f"wheels={len(wheels)} barrel={'yes' if barrel else 'no'}")
if wheels:
    w0 = wheels[0]
    print(f"sample wheel loc={tuple(round(c, 3) for c in w0.location)}")

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=False,
    export_apply=False,
    export_yup=True,
)
print("Wrote", OUT)
