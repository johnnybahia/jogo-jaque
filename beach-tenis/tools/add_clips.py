"""Clipes Mixamo extras -> GLB só com o esqueleto da Jaqueline (sem malha) + JSON de metadados.
Uso: python3 -I add_clips.py -- <personagem.fbx> <saida.glb> nome=arquivo.fbx [nome=arquivo.fbx ...]
O esqueleto sai do mesmo FBX e da mesma preparação do retarget.py (armature sem rotação), então os ossos e os
eixos locais batem com o jaqueline.glb. Cada clipe vira uma ação em trilha NLA; o deslocamento horizontal do Hips é
zerado (in-place, como add_loco.py) e a velocidade natural (m/s na escala nativa) vai para <saida>.json."""
import bpy, sys, os, json
a = sys.argv[sys.argv.index("--") + 1:]; CHAR, OUT = a[:2]; PAIRS = a[2:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=CHAR)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in [o for o in bpy.data.objects if o.type == 'MESH']: bpy.data.objects.remove(o, do_unlink=True)
arm.rotation_euler = (0, 0, 0)
bpy.context.view_layer.update()
if not arm.animation_data: arm.animation_data_create()
META = {}
for pair in PAIRS:
    name, path = pair.split("=", 1)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in new if o.type == 'ARMATURE')
    act = src.animation_data.action
    act.name = name; act.use_fake_user = True
    f0, f1 = act.frame_range; dur = (f1 - f0) / 30.0
    cb = act.layers[0].strips[0].channelbags[0]
    sp = {}
    for fc in cb.fcurves:
        if fc.data_path == 'pose.bones["mixamorig:Hips"].location' and fc.array_index in (0, 2):
            ks = fc.keyframe_points; v0 = ks[0].co[1]; v1 = ks[-1].co[1]
            sp[fc.array_index] = (v1 - v0) / 100.0 / dur
            for k in ks:
                t = (k.co[0] - f0) / (f1 - f0); d = v0 + (v1 - v0) * t
                k.co[1] -= d; k.handle_left[1] -= d; k.handle_right[1] -= d
            fc.update()
    META[name] = {"name": name, "frames": int(f1 - f0 + 1), "fps": 30, "duration": dur, "source": os.path.basename(path),
                  "speed_x_m_s": round(sp.get(0, 0), 3), "speed_z_m_s": round(sp.get(2, 0), 3)}
    for o in new: bpy.data.objects.remove(o, do_unlink=True)
    tr = arm.animation_data.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, 1, act); st.action_frame_start, st.action_frame_end = f0, f1
    st.action_slot = act.slots[0]
    print("ok", name, META[name])
for o in bpy.data.objects: o.select_set(o.type == 'ARMATURE')
bpy.context.view_layer.objects.active = arm
for t in arm.animation_data.nla_tracks: t.mute = False
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animation_mode='NLA_TRACKS',
    export_nla_strips=True, export_animations=True, export_skins=True, export_yup=True,
    export_force_sampling=True, export_optimize_animation_size=True)
json.dump(META, open(os.path.splitext(OUT)[0] + ".json", "w"), indent=1)
print("OK", OUT, os.path.getsize(OUT))
