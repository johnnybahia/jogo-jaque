import bpy, sys
a = sys.argv[sys.argv.index("--") + 1:]; BLEND, OUT = a[:2]
bpy.ops.wm.open_mainfile(filepath=BLEND)
names = [f"{k}_{i}" for k in ("forehand","backhand","serve","smash","fvolley","bvolley") for i in (1,2)]
for n in names:
    act = bpy.data.actions[n]
    cb = act.layers[0].strips[0].channelbags[0]
    for fc in cb.fcurves:
        if fc.data_path == 'pose.bones["mixamorig:Hips"].location' and fc.array_index in (0, 2):
            ks = fc.keyframe_points; v0 = ks[0].co[1]; v1 = ks[-1].co[1]; f0 = ks[0].co[0]; f1 = ks[-1].co[0]
            for k in ks:
                d = v0 + (v1 - v0) * (k.co[0] - f0) / (f1 - f0); k.co[1] -= d
            fc.update()
    print(n, "ok")
bpy.ops.wm.save_as_mainfile(filepath=OUT)
