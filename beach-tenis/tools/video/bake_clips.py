"""Blender (python -I): lê clips.npz e grava ações no esqueleto da Jaqueline (FBX), exporta GLB só com o esqueleto + animações (NLA).
Uso: BPY_PATH=<pasta do bpy> CHAR_FBX=<JAQUELINE+OK PRONTA.fbx> python3 -I bake_clips.py -- clips.npz clips_meta.json video_clips.glb"""
"""Blender: lê clips.npz e grava ações no esqueleto da Jaqueline (FBX), exporta GLB só com o esqueleto + animações (NLA)."""
import sys, json
import os
if os.environ.get('BPY_PATH'): sys.path.insert(0, os.environ['BPY_PATH'])   # pasta com o módulo bpy, se não estiver instalado
import numpy as np
import bpy
from mathutils import Quaternion
NPZ, META, OUT = sys.argv[sys.argv.index('--') + 1:][:3]
data = np.load(NPZ); meta = json.load(open(META))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.environ.get('CHAR_FBX', 'JAQUELINE+OK PRONTA.fbx'))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in [o for o in bpy.data.objects if o.type == 'MESH']: bpy.data.objects.remove(o, do_unlink=True)
arm.rotation_euler = (0, 0, 0); bpy.context.view_layer.update()
if not arm.animation_data: arm.animation_data_create()
names = [b.name for b in arm.pose.bones]
for pb in arm.pose.bones: pb.rotation_mode = 'QUATERNION'
# ordem dos ossos usada no solve.py = ordem de arm.data.bones
order = [b.name for b in arm.data.bones]
for name, m in meta.items():
    Q = data[name + '_Q']; L = data[name + '_loc']; T = Q.shape[0]
    act = bpy.data.actions.new(name); act.use_fake_user = True
    arm.animation_data.action = act
    for pb in arm.pose.bones: pb.rotation_quaternion = Quaternion((1, 0, 0, 0)); pb.location = (0, 0, 0)
    for f in range(T):
        for i, bn in enumerate(order):
            pb = arm.pose.bones[bn]
            q = Q[f, i]
            if bn == 'mixamorig:Hips' or abs(q[0]) < 0.99999:
                pb.rotation_quaternion = Quaternion((float(q[0]), float(q[1]), float(q[2]), float(q[3])))
                pb.keyframe_insert('rotation_quaternion', frame=f + 1)
        hp = arm.pose.bones['mixamorig:Hips']; hp.location = (float(L[f, 0]), float(L[f, 1]), float(L[f, 2])); hp.keyframe_insert('location', frame=f + 1)
    arm.animation_data.action = None
    tr = arm.animation_data.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, 1, act); st.action_slot = act.slots[0]
    print('ok', name, T)
for o in bpy.data.objects: o.select_set(o.type == 'ARMATURE')
bpy.context.view_layer.objects.active = arm
for t in arm.animation_data.nla_tracks: t.mute = False
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animation_mode='NLA_TRACKS', export_nla_strips=True, export_animations=True, export_skins=True, export_yup=True, export_force_sampling=True, export_optimize_animation_size=True)
print('GLB', OUT)
