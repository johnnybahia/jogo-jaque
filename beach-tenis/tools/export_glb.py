import bpy, sys, os
a = sys.argv[sys.argv.index("--") + 1:]; blend, out = a[:2]
bpy.ops.wm.open_mainfile(filepath=blend)
for im in bpy.data.images:
    if im.size[0] > 1024 or im.size[1] > 1024:
        k = 1024 / max(im.size); im.scale(max(1, int(im.size[0] * k)), max(1, int(im.size[1] * k)))
for o in bpy.data.objects: o.select_set(o.type in ('ARMATURE', 'MESH'))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE'); bpy.context.view_layer.objects.active = arm
for tr in arm.animation_data.nla_tracks: tr.mute = False
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_animation_mode='NLA_TRACKS',
    export_nla_strips=True, export_animations=True, export_skins=True, export_image_format='JPEG', export_image_quality=85, export_yup=True,
    export_force_sampling=True, export_optimize_animation_size=True)
print("OK", os.path.getsize(out))
