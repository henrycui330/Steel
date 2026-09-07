"""Bake toshueyi Pz-IV as named multi-mesh GLB (Hull / Turret / Barrel).

Strips ~20.8° 3DS lean, applies scales, keeps parts separate for turret rig.
"""
import bpy
import bmesh
import math
from mathutils import Vector, Matrix, Euler

SRC = __import__("os").environ.get(
    "STEEL_PZ4_IN",
    "/Users/cheesydonut/Steel/code/public/models/pz4.toshueyi.raw.glb",
)
OUT = __import__("os").environ.get(
    "STEEL_PZ4_OUT",
    "/Users/cheesydonut/Steel/code/public/models/pz4.glb",
)
TARGET_LENGTH = 5.9

# Parent-empty name → role (from Sketchfab/3DS hierarchy)
ROLE_BY_PARENT = {
    "DrawCall_0": "hull",
    "DrawCall_1": "turret",
    "DrawCall_6": "barrel",
    "DrawCall_7": "mantlet",
    # Large side/track-adjacent mesh — stays on hull (NOT turret)
    "DrawCall_8": "hull",
    "Wheel": "hull",
    "Chain": "hull",
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)


def set_world_trs(obj, loc, euler_xyz, scale):
    R = Euler(euler_xyz, "XYZ").to_matrix().to_4x4()
    S = Matrix.Diagonal((scale.x, scale.y, scale.z, 1.0))
    obj.matrix_world = Matrix.Translation(loc) @ R @ S


def role_for_mesh(obj):
    p = obj.parent
    while p is not None:
        if p.name in ROLE_BY_PARENT:
            return ROLE_BY_PARENT[p.name]
        if p.name.startswith("DrawCall_"):
            return "hull"
        p = p.parent
    return "hull"


# Tag roles before we unparent
mesh_roles = {}
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    role = role_for_mesh(obj)
    mesh_roles[obj.name] = role
    print(f"role {obj.name} <- {role} (parent={obj.parent.name if obj.parent else None})")

# Strip lean + unparent
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    loc, rot, sc = obj.matrix_world.decompose()
    e = rot.to_euler("XYZ")
    print(
        f"lean-strip {obj.name}: "
        f"({math.degrees(e.x):.1f},{math.degrees(e.y):.1f},{math.degrees(e.z):.1f})"
    )
    set_world_trs(obj, loc, (-math.pi / 2, 0.0, 0.0), sc)
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = mw

bpy.context.view_layer.update()

# Apply transforms into mesh data
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Drop empties
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        bpy.data.objects.remove(obj, do_unlink=True)


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def separate_above_z(obj, z_cut, new_name):
    """Split faces whose average world Z > z_cut into a new mesh object."""
    mw = obj.matrix_world.copy()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()

    high_faces = []
    for f in bm.faces:
        z_avg = sum((mw @ v.co).z for v in f.verts) / len(f.verts)
        if z_avg > z_cut:
            high_faces.append(f)

    if len(high_faces) < 4 or len(high_faces) >= len(bm.faces) - 4:
        print(f"split skip {obj.name}: high_faces={len(high_faces)}/{len(bm.faces)}")
        bm.free()
        return None

    # Duplicate high faces into a new bmesh
    bm_high = bmesh.new()
    vert_map = {}
    for f in high_faces:
        for v in f.verts:
            if v.index not in vert_map:
                vert_map[v.index] = bm_high.verts.new(v.co)
        bm_high.verts.ensure_lookup_table()
        try:
            bm_high.faces.new([vert_map[v.index] for v in f.verts])
        except ValueError:
            pass
    bm_high.normal_update()

    # Delete high faces from original
    bmesh.ops.delete(bm, geom=high_faces, context="FACES")
    bm.to_mesh(obj.data)
    obj.data.update()
    bm.free()

    mesh_high = bpy.data.meshes.new(new_name + "Mesh")
    bm_high.to_mesh(mesh_high)
    bm_high.free()
    roof = bpy.data.objects.new(new_name, mesh_high)
    roof.matrix_world = mw.copy()
    bpy.context.scene.collection.objects.link(roof)
    print(f"split {obj.name} → {roof.name} (z_avg>{z_cut:.2f})")
    return roof


# DrawCall_8 (Object_10): lower = hull/tracks, upper cupola plate → turret
dc8 = next((o for o in bpy.context.scene.objects if o.name == "Object_10"), None)
if dc8 is not None:
    bb = [dc8.matrix_world @ Vector(c) for c in dc8.bound_box]
    zmin = min(v.z for v in bb)
    zmax = max(v.z for v in bb)
    z_cut = zmin + (zmax - zmin) * 0.62
    roof = separate_above_z(dc8, z_cut, "TurretRoof")
    if roof is not None:
        mesh_roles[roof.name] = "turret"
        mesh_roles[dc8.name] = "hull"

# Refresh role map by current object names
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
by_role = {"hull": [], "turret": [], "barrel": [], "mantlet": []}
for obj in meshes:
    role = mesh_roles.get(obj.name, "hull")
    by_role.setdefault(role, []).append(obj)
    print(f"grouped {obj.name} → {role}")


def join_role(role, out_name):
    parts = by_role.get(role) or []
    if not parts:
        print(f"WARN: no meshes for role={role}")
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
mantlet = join_role("mantlet", "GunMantlet")

parts = [p for p in (hull, turret, barrel, mantlet) if p is not None]
if not parts:
    raise RuntimeError("No mesh parts after bake")


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


# Origins at geometry bounds (pivot-friendly)
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
if abs(size.x) >= abs(size.y):
    for obj in parts:
        select_only(obj)
        obj.rotation_euler[2] = math.radians(90)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    print("Rotated 90deg so length along Y")

plant_center_all(parts)

# Parent mantlet under barrel (keep world pose)
if mantlet and barrel:
    mw = mantlet.matrix_world.copy()
    mantlet.parent = barrel
    mantlet.matrix_world = mw
    print("Parented GunMantlet under Barrel")

# Root empty for a clean glTF hierarchy
bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
root = bpy.context.view_layer.objects.active
root.name = "PanzerIV"
for obj in (hull, turret, barrel):
    if obj is None:
        continue
    mw = obj.matrix_world.copy()
    obj.parent = root
    obj.matrix_world = mw

mn, mx, size = world_bbox_objs([o for o in (hull, turret, barrel) if o])
print(f"CLEAN FINAL W={abs(size.x):.3f} Depth={abs(size.y):.3f} H={abs(size.z):.3f}")
print(
    "parts:",
    [o.name for o in bpy.context.scene.objects if o.type in ("MESH", "EMPTY")],
)

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=False,
    export_apply=True,
    export_yup=True,
)
print("Wrote", OUT)
