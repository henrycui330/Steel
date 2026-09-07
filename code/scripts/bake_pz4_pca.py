"""PCA-upright bake for toshueyi Pz-IV."""
import bpy
import bmesh
import math
import numpy as np
from mathutils import Vector, Matrix

SRC = "/Users/cheesydonut/Steel/code/public/models/pz4.toshueyi.raw.glb"
OUT = "/Users/cheesydonut/Steel/code/public/models/pz4.glb"
TARGET = 5.9

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

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

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
if len(meshes) > 1:
    bpy.ops.object.join()

tank = bpy.context.view_layer.objects.active
tank.name = "PanzerIV"


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def world_bbox(obj):
    bpy.context.view_layer.update()
    bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    return mn, mx, mx - mn


def plant(obj):
    select_only(obj)
    mn, mx, _ = world_bbox(obj)
    obj.location.z -= mn.z
    obj.location.x -= (mn.x + mx.x) * 0.5
    obj.location.y -= (mn.y + mx.y) * 0.5
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


def rotate_mesh(obj, R4):
    select_only(obj)
    mw = obj.matrix_world.copy()
    xform = mw.inverted() @ R4 @ mw
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.transform(bm, matrix=xform, verts=bm.verts)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    bpy.context.view_layer.update()


pts = np.array([(tank.matrix_world @ v.co)[:] for v in tank.data.vertices], dtype=np.float64)
c = pts.mean(axis=0)
_, eigvals, eigvecs = np.linalg.svd(pts - c, full_matrices=False)
print("singular", eigvals)
print("axes rows (long, mid, short)", eigvecs)

up = eigvecs[2].copy()
if up[2] < 0:
    up = -up
length = eigvecs[0].copy()
right = np.cross(length, up)
right /= max(np.linalg.norm(right), 1e-9)
length = np.cross(up, right)
length /= max(np.linalg.norm(length), 1e-9)
# Prefer length mostly along +Y after orient
if abs(length[1]) < abs(length[0]):
    # swap length/right if needed later via yaw
    pass

B = np.column_stack([right, length, up])  # world = B @ local
R = B.T
print("right", right, "length", length, "up", up)

R4 = Matrix(
    [
        [float(R[0, 0]), float(R[0, 1]), float(R[0, 2]), 0.0],
        [float(R[1, 0]), float(R[1, 1]), float(R[1, 2]), 0.0],
        [float(R[2, 0]), float(R[2, 1]), float(R[2, 2]), 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
)
loc = Vector((float(c[0]), float(c[1]), float(c[2])))
rotate_mesh(tank, Matrix.Translation(loc) @ R4 @ Matrix.Translation(-loc))
plant(tank)

mn, mx, size = world_bbox(tank)
print(f"After PCA: W={abs(size.x):.3f} D={abs(size.y):.3f} H={abs(size.z):.3f}")

longest = max(abs(size.x), abs(size.y), abs(size.z))
select_only(tank)
tank.scale = (TARGET / longest,) * 3
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
plant(tank)

mn, mx, size = world_bbox(tank)
if abs(size.x) > abs(size.y):
    rotate_mesh(tank, Matrix.Rotation(math.radians(90), 4, "Z"))
    plant(tank)
    mn, mx, size = world_bbox(tank)

# If height ended up along Y (wrong), fix by pitching
if abs(size.y) < abs(size.z) and abs(size.z) > abs(size.x):
    # length might be Z — rotate so length -> Y
    rotate_mesh(tank, Matrix.Rotation(math.radians(-90), 4, "X"))
    plant(tank)
    mn, mx, size = world_bbox(tank)

print(f"FINAL W={abs(size.x):.3f} D={abs(size.y):.3f} H={abs(size.z):.3f}")
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=False,
    export_apply=True,
    export_yup=True,
)
print("Wrote", OUT)
