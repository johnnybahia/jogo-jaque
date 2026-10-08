"""Raquete leve: reduz a malha da raquete (50 mil triângulos, UV em cacos: 87 mil vértices para 25 mil posições) e re-assa a textura numa UV nova.
Uso (bpy como módulo):  python3 slim_racket.py <racket_raw.glb> <pasta de saída> [triângulos=8000] [textura=1024] [normal=1]
  racket_raw.glb = a raquete atual sem meshopt/quantização (tools/glb_tool.mjs raw faz isso; tools/glb_tool.mjs pack comprime a saída); saída: racket_slim.glb (Y para cima, como a entrada; ainda sem meshopt).
Passos: importa → solda posições → copia → Decimate (colapso) até o alvo → UV nova (smart project) → bake COLOR (difuso) e NORMAL (tangente) do original para a cópia → exporta."""
import bpy, sys, os, math

a = sys.argv[1:]
SRC, OUT = a[0], a[1]
TRIS = int(a[2]) if len(a) > 2 else 8000
RES = int(a[3]) if len(a) > 3 else 1024
WITH_NORMAL = (a[4] != "0") if len(a) > 4 else True
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
high = next(o for o in bpy.data.objects if o.type == "MESH")
for o in list(bpy.data.objects):
    if o is not high:
        bpy.data.objects.remove(o, do_unlink=True)
high.parent = None
bpy.context.view_layer.objects.active = high
high.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)   # a escala 0,25 e o deslocamento do gltfpack passam para os vértices

# solda as posições repetidas (a UV fica por canto, não se perde); a malha vira contínua para o Decimate
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=1e-6)
bpy.ops.object.mode_set(mode="OBJECT")
print("original:", len(high.data.vertices), "vértices,", len(high.data.polygons), "faces")

# cópia de baixa resolução
low = high.copy()
low.data = high.data.copy()
low.name = "racket"
bpy.context.collection.objects.link(low)
low.data.materials.clear()
while low.data.uv_layers:
    low.data.uv_layers.remove(low.data.uv_layers[0])
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = low
low.select_set(True)
dm = low.modifiers.new("d", "DECIMATE")
dm.decimate_type = "COLLAPSE"
dm.use_collapse_triangulate = True
dm.ratio = min(1.0, TRIS / max(1, len(high.data.polygons)))
bpy.ops.object.modifier_apply(modifier="d")
low.data.calc_loop_triangles()
print("baixa:", len(low.data.vertices), "vértices,", len(low.data.loop_triangles), "triângulos")

# UV nova
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")
for p in low.data.polygons:
    p.use_smooth = True

# material da baixa: duas imagens para receber o bake
mat = bpy.data.materials.new("racket")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Metallic"].default_value = 0.2
bsdf.inputs["Roughness"].default_value = 0.45
low.data.materials.append(mat)
img_c = bpy.data.images.new("bake_color", RES, RES)
img_n = bpy.data.images.new("bake_normal", RES, RES)
img_n.colorspace_settings.name = "Non-Color"
t_c = nt.nodes.new("ShaderNodeTexImage"); t_c.image = img_c
t_n = nt.nodes.new("ShaderNodeTexImage"); t_n.image = img_n
nm = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(t_c.outputs["Color"], bsdf.inputs["Base Color"])
nt.links.new(t_n.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 8
sc.cycles.use_denoising = False


def bake(kind, node, **kw):
    for n in nt.nodes:
        n.select = False
    node.select = True
    nt.nodes.active = node
    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=0.012, max_ray_distance=0.03, margin=6, margin_type="EXTEND", **kw)


bake("DIFFUSE", t_c, pass_filter={"COLOR"})
if WITH_NORMAL:
    bake("NORMAL", t_n)
else:   # sem normal: tira o nó
    nt.nodes.remove(t_n); nt.nodes.remove(nm)

# exporta só a baixa
bpy.ops.object.select_all(action="DESELECT")
low.select_set(True)
bpy.context.view_layer.objects.active = low
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "racket_slim.glb"), export_format="GLB", use_selection=True, export_image_format="JPEG", export_jpeg_quality=88)
img_c.save_render(os.path.join(OUT, "bake_color.png"))
if WITH_NORMAL:
    img_n.save_render(os.path.join(OUT, "bake_normal.png"))
print("pronto")
