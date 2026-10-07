import bpy, sys, os
a = sys.argv[sys.argv.index("--") + 1:]; BLEND, OUT, LOCO = a[:3]
bpy.ops.wm.open_mainfile(filepath=BLEND)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
print("char arm scale", tuple(arm.scale), "rot", tuple(arm.rotation_euler))
META = {}
M = "Magic Locomotion Pack JAQUE"
CL = {"idle": (M, "standing idle.fbx"), "run_f": (M, "Standing Run Forward.fbx"), "run_b": (M, "Standing Run Back.fbx"),
      "run_l": (M, "Standing Run Left.fbx"), "run_r": (M, "Standing Run Right.fbx")}
for name, (d, f) in CL.items():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(LOCO, d, f))
    new = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in new if o.type == 'ARMATURE')
    act = src.animation_data.action
    act.name = name; act.use_fake_user = True
    fr = act.frame_range
    # in-place: zera deslocamento horizontal do Hips (mantem altura)
    cb = act.layers[0].strips[0].channelbags[0]
    hp = [fc for fc in cb.fcurves if fc.data_path == 'pose.bones["mixamorig:Hips"].location']
    info = []
    for fc in hp:
        vals = [k.co[1] for k in fc.keyframe_points]
        info.append((fc.array_index, round(min(vals), 1), round(max(vals), 1)))
    print(name, "frames", tuple(fr), "hips loc ranges (idx,min,max)", info)
    f0, f1 = fr; dur = (f1 - f0) / 30.0; sp = {}
    for fc in hp:
        if fc.array_index in (0, 2):
            ks = fc.keyframe_points; v0 = ks[0].co[1]; v1 = ks[-1].co[1]
            sp[fc.array_index] = (v1 - v0) / 100.0 / dur
            for k in ks:
                t = (k.co[0] - f0) / (f1 - f0); k.co[1] -= v0 + (v1 - v0) * t
                k.handle_left[1] -= v0 + (v1 - v0) * t; k.handle_right[1] -= v0 + (v1 - v0) * t
            fc.update()
    META[name] = {"name": name, "frames": int(f1 - f0 + 1), "fps": 30, "duration": dur, "loop": True, "kind": "loco",
                  "speed_x_m_s": round(sp.get(0, 0), 3), "speed_z_m_s": round(sp.get(2, 0), 3)}
    for o in new: bpy.data.objects.remove(o, do_unlink=True)
    ad = arm.animation_data; 
    tr = ad.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, 1, act); st.action_frame_start, st.action_frame_end = fr
    st.action_slot = act.slots[0]; print("slot", act.slots[0].name_display, "strip slot", st.action_slot)
print([t.name for t in arm.animation_data.nla_tracks])
bpy.ops.wm.save_as_mainfile(filepath=OUT)

import json; json.dump(META, open(OUT.replace(".blend", "_loco.json"), "w"), indent=1)
