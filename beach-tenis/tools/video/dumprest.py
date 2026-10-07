"""Blender: grava rest.json (pose de repouso dos 65 ossos da Jaqueline: pai, cabeça, ponta, matriz) usado por solve.py.
Uso: BPY_PATH=<pasta do bpy> CHAR_FBX=<JAQUELINE+OK PRONTA.fbx> python3 -I dumprest.py"""
import sys, json
import os
if os.environ.get('BPY_PATH'): sys.path.insert(0, os.environ['BPY_PATH'])
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.environ.get('CHAR_FBX', 'JAQUELINE+OK PRONTA.fbx'))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
arm.rotation_euler = (0, 0, 0); bpy.context.view_layer.update()
print('armature matrix_world scale', arm.matrix_world.to_scale(), 'loc', arm.matrix_world.translation)
out = {}
for b in arm.data.bones:
    M = arm.matrix_world @ b.matrix_local
    out[b.name] = {'parent': b.parent.name if b.parent else None, 'head': list(arm.matrix_world @ b.head_local), 'tail': list(arm.matrix_world @ b.tail_local), 'M': [list(r) for r in M], 'length': b.length}
json.dump(out, open('rest.json', 'w'), indent=0)
print(len(out), 'bones')
for n in ['mixamorig:Hips','mixamorig:Spine','mixamorig:Spine2','mixamorig:Neck','mixamorig:Head','mixamorig:LeftShoulder','mixamorig:LeftArm','mixamorig:LeftForeArm','mixamorig:LeftHand','mixamorig:RightArm','mixamorig:LeftUpLeg','mixamorig:LeftLeg','mixamorig:LeftFoot','mixamorig:LeftToeBase','mixamorig:RightUpLeg']:
    b = out[n]; print(n.ljust(26), 'parent', str(b['parent']).ljust(24), 'head', [round(v, 3) for v in b['head']], 'tail', [round(v, 3) for v in b['tail']])
