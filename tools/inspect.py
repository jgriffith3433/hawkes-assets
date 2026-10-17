"""What a model or animation file holds, as JSON. Runs inside Blender (tools/add.mjs calls it):

    blender -b --factory-startup -P tools/inspect.py -- <file> <out.json>

Rigs (bones, family: mixamo, biped, humanoid, rigify or custom), animations (name, frames), meshes, and the height
of what's in it (meters, at rest).
"""

import json
import os
import sys

import bpy
import mathutils

f, out = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(f)[1].lower()
if ext in (".glb", ".gltf"):
    bpy.ops.import_scene.gltf(filepath=f)
elif ext == ".fbx":
    bpy.ops.import_scene.fbx(filepath=f)
elif ext == ".obj":
    bpy.ops.wm.obj_import(filepath=f)
elif ext == ".blend":
    bpy.ops.wm.open_mainfile(filepath=f)
else:
    raise SystemExit(f"can't inspect {ext}")


def family(bones):
    names = " ".join(bones)
    low = names.lower()
    if "mixamorig" in low:
        return "mixamo"
    if "bip01" in low or "bip001" in low:
        return "biped"
    if "LeftUpperArm" in names and "LeftLowerLeg" in names:
        return "humanoid"
    if "upper_arm.L" in names or "DEF-" in names or "ORG-" in names:
        return "rigify"
    return "custom"


scene = bpy.context.scene
rigs = []
for o in scene.objects:
    if o.type == "ARMATURE":
        bones = [b.name for b in o.data.bones]
        ad = o.animation_data
        rigs.append({"name": o.name, "bones": len(bones), "family": family(bones),
                     "action": ad.action.name if ad and ad.action else None})
actions = []
for a in bpy.data.actions:
    s, e = a.frame_range
    actions.append({"name": a.name, "frames": round(e - s + 1), "start": round(s, 2)})
dg = bpy.context.evaluated_depsgraph_get()
lo = mathutils.Vector((1e9,) * 3)
hi = mathutils.Vector((-1e9,) * 3)
meshes = 0
# With a rig, measure what the rig carries (exports sometimes ship a stray sphere or probe beside the character).
arms = [o for o in scene.objects if o.type == "ARMATURE"]


def on_rig(o):
    p = o.parent
    while p:
        if p in arms:
            return True
        p = p.parent
    return any(m.type == "ARMATURE" and m.object in arms for m in o.modifiers)


for o in scene.objects:
    if o.type != "MESH" or (arms and not on_rig(o)):
        continue
    meshes += 1
    ev = o.evaluated_get(dg)
    for c in ev.bound_box:
        w = ev.matrix_world @ mathutils.Vector(c)
        lo = mathutils.Vector(map(min, lo, w))
        hi = mathutils.Vector(map(max, hi, w))
size = [round(x, 3) for x in (hi - lo)] if meshes else None
json.dump({"file": os.path.basename(f), "rigs": rigs, "animations": actions, "meshes": meshes, "size": size,
           "fps": scene.render.fps, "blender": bpy.app.version_string}, open(out, "w"), indent=1)
