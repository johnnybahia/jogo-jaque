import bpy, sys, os, math, numpy as np
from mathutils import Matrix, Vector
a=sys.argv[sys.argv.index("--")+1:]; RK_FBX, BALL_GLB, OUT = a[:3]
def clean(): bpy.ops.wm.read_factory_settings(use_empty=True)
def shrink(path, size):
    im=bpy.data.images.load(path); im.scale(size,size); return im
# ---------- raquete ----------
clean(); bpy.ops.import_scene.fbx(filepath=RK_FBX)
o=next(o for o in bpy.data.objects if o.type=='MESH')
for x in list(bpy.data.objects):
    if x is not o: bpy.data.objects.remove(x, do_unlink=True)
o.parent=None
me=o.data; M=o.matrix_world.copy()
s=0.5/0.98002302
# model(x,y,z) -> local: X=y, Y=-x, Z=z-0.0578 ; escala s ; handle end em y=-0.11
R=Matrix(((0,1,0),(-1,0,0),(0,0,1))); T=Matrix.Translation((0,0.14/ s,-0.05786))
for v in me.vertices:
    w=M@v.co; v.co=(R@w)+Vector((0,0.14/s,-0.05786))
o.matrix_world=Matrix.Identity(4); o.scale=(s,s,s); bpy.context.view_layer.objects.active=o
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
me.update(); me.calc_loop_triangles()
for p in me.polygons: p.use_smooth=True
fbm=os.path.join(os.path.dirname(RK_FBX),[d for d in os.listdir(os.path.dirname(RK_FBX)) if d.endswith('.fbm')][0])
files=os.listdir(fbm); bc=[f for f in files if 'BaseColor' in f][0]; nm=[f for f in files if 'Normal' in f][0]
mat=bpy.data.materials.new("racket"); mat.use_nodes=True; nt=mat.node_tree; b=nt.nodes["Principled BSDF"]
t1=nt.nodes.new("ShaderNodeTexImage"); t1.image=shrink(os.path.join(fbm,bc),1024)
t2=nt.nodes.new("ShaderNodeTexImage"); t2.image=shrink(os.path.join(fbm,nm),1024); t2.image.colorspace_settings.name='Non-Color'
nn=nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(t1.outputs["Color"],b.inputs["Base Color"]); nt.links.new(t2.outputs["Color"],nn.inputs["Color"]); nt.links.new(nn.outputs["Normal"],b.inputs["Normal"])
b.inputs["Metallic"].default_value=0.2; b.inputs["Roughness"].default_value=0.45
me.materials.clear(); me.materials.append(mat)
o.name="racket"; bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
V=np.array([v.co[:] for v in me.vertices]); print("racket bbox",V.min(0),V.max(0))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,"racket.glb"),export_format='GLB',use_selection=True,export_image_format='JPEG',export_jpeg_quality=85,export_yup=False)
# ---------- bolas ----------
for name,keep in (("green","Roundcube_Material_0"),("red","Roundcube.002_Material.001_0")):
    clean(); bpy.ops.import_scene.gltf(filepath=BALL_GLB)
    ob=bpy.data.objects[keep]
    for x in list(bpy.data.objects):
        if x is not ob: bpy.data.objects.remove(x, do_unlink=True)
    ob.parent=None; bpy.context.view_layer.objects.active=ob; ob.select_set(True)
    W=np.array([(ob.matrix_world@v.co)[:] for v in ob.data.vertices]); c=(W.max(0)+W.min(0))/2; d=(W.max(0)-W.min(0)).max()
    for v in ob.data.vertices: v.co=(ob.matrix_world@v.co)-Vector(c)
    ob.matrix_world=Matrix.Identity(4); ob.scale=(0.066/d,)*3
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    dm=ob.modifiers.new("d","DECIMATE"); dm.ratio=0.06; bpy.ops.object.modifier_apply(modifier="d")
    for p in ob.data.polygons: p.use_smooth=True
    ob.name="ball_"+name; print(name,len(ob.data.vertices),"verts")
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,f"ball_{name}.glb"),export_format='GLB',use_selection=True,export_yup=False)
