"""Retarget Tennis-MoCap BVH -> rig Mixamo (bpy). Uso: python3 -I retarget.py -- <char.fbx> <bvh_dir> <selected.json> <out_dir> [nomes...]"""
import bpy, sys, os, json, math
import numpy as np
from mathutils import Matrix, Vector, Quaternion
from scipy.spatial.transform import Rotation as R, Slerp
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bvh_lib import BVH

a = sys.argv[sys.argv.index("--") + 1:]
CHAR, BVHD, SEL, OUT = a[:4]; ONLY = set(a[4:])
FPS = 30
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=CHAR)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
arm.rotation_euler = (0, 0, 0)  # importador deixa o personagem deitado (cima local = -Y mundo); alinha cima local = +Z mundo
bpy.context.view_layer.update()
_v = [(arm.matrix_world.inverted() @ mesh.matrix_world) @ v.co for v in mesh.data.vertices]
print("malha no espaco do armature: z", round(min(v.z for v in _v), 1), round(max(v.z for v in _v), 1), " altura mundo m:", round(max((mesh.matrix_world @ v.co).z for v in mesh.data.vertices) - min((mesh.matrix_world @ v.co).z for v in mesh.data.vertices), 3))
B = arm.data.bones; P = "mixamorig:"
bone = lambda n: B[P + n]
H = lambda n: Vector(bone(n).head_local)
# --- eixos anatomicos no espaco local do armature
up = (H("Head") - H("Hips")).normalized()
left = (H("LeftArm") - H("RightArm")).normalized()
fwd = left.cross(up).normalized()
left = up.cross(fwd).normalized()
Mb = Matrix(((left.x, up.x, fwd.x), (left.y, up.y, fwd.y), (left.z, up.z, fwd.z)))  # BVH(x=esq,y=cima,z=frente) -> local
Mn = np.array(Mb)
print("eixos local: esq", tuple(round(x, 2) for x in left), "cima", tuple(round(x, 2) for x in up), "frente", tuple(round(x, 2) for x in fwd))
upw = arm.matrix_world.to_3x3() @ up; print("cima em mundo:", tuple(round(x, 2) for x in upw.normalized()))

# --- mapa Mixamo -> (junta BVH de rotacao, direcao BVH de repouso, fracao tronco)
SIDES = (("Left", 1), ("Right", -1))
MAP = {"Hips": ("Hips", (0, 1, 0)), "Neck": ("Neck", (0, 1, 0)), "Head": ("Head", (0, 1, 0)), "HeadTop_End": ("Head", (0, 1, 0))}
TRUNK = {"Spine": 1 / 3, "Spine1": 2 / 3, "Spine2": 1.0}
foot_dir = (0, -4.86, 16.53)
for s, sg in SIDES:
    MAP[s + "Shoulder"] = (s + "Collar", (sg, 0, 0)); MAP[s + "Arm"] = (s + "Shoulder", (sg, 0, 0))
    MAP[s + "ForeArm"] = (s + "Elbow", (sg, 0, 0)); MAP[s + "Hand"] = (s + "Wrist", (sg, 0, 0))
    MAP[s + "UpLeg"] = (s + "Hip", (0, -1, 0)); MAP[s + "Leg"] = (s + "Knee", (0, -1, 0)); MAP[s + "Foot"] = (s + "Ankle", foot_dir)
FOLLOW = {}  # osso -> osso que fornece A e D (rigido)
for s, sg in SIDES:
    for f in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
        for i in (1, 2, 3, 4): FOLLOW[f"{s}Hand{f}{i}"] = s + "Hand"
    FOLLOW[s + "ToeBase"] = s + "Foot"; FOLLOW[s + "Toe_End"] = s + "Foot"
trunk_dir = (0, 1, 0)

def rest3(n): return np.array(bone(n).matrix_local.to_3x3())
def dm(n):
    b = bone(n); return (Vector(b.tail_local) - Vector(b.head_local)).normalized()
def Aof(n, d_bvh):
    db = Mb @ Vector(d_bvh).normalized()
    q = dm(n).rotation_difference(db); return np.array(q.to_matrix())
A = {}
for n, (j, d) in MAP.items(): A[n] = Aof(n, d)
for n in TRUNK: A[n] = Aof(n, trunk_dir)
for n, p in FOLLOW.items(): A[n] = A[p]
# ordem topologica dos ossos
order = [b.name[len(P):] for b in B]
parent = {b.name[len(P):]: (b.parent.name[len(P):] if b.parent else None) for b in B}

# curvatura de empunhadura (dedos em torno do eixo anteroposterior do mundo-local)
def curl_local(n, ang):
    b = bone(n); d = dm(n); axis = fwd
    best = None
    for sgn in (1, -1):
        Rw = Matrix.Rotation(sgn * ang, 3, axis); z = (Rw @ d).dot(up)
        if best is None or z < best[0]: best = (z, Rw)
    return np.array(best[1])
CURL = {}
for s, sg in SIDES:
    for f, angs in (("Index", (35, 45, 25)), ("Middle", (40, 50, 25)), ("Ring", (45, 50, 25)), ("Pinky", (50, 50, 25))):
        for i, ag in zip((1, 2, 3), angs):
            n = f"{s}Hand{f}{i}"; Rw = curl_local(n, math.radians(ag)); CURL[n] = rest3(n).T @ Rw @ rest3(n)
    for i, ag in zip((1, 2, 3), (10, 15, 15)):
        n = f"{s}HandThumb{i}"; Rw = curl_local(n, math.radians(ag)); CURL[n] = rest3(n).T @ Rw @ rest3(n)

legM = (H("LeftUpLeg") - Vector(bone("LeftFoot").head_local)).length
for pb in arm.pose.bones: pb.rotation_mode = 'QUATERNION'

def process(c):
    b = BVH(os.path.join(BVHD, c["file"])); G, Pp = b.globals()
    t0, t1 = c["start"] * b.dt, c["end"] * b.dt
    ts = np.arange(t0, t1 + 1e-9, 1 / FPS); ts = np.clip(ts, t0, t1); nfr = len(ts)
    src = np.arange(b.nf) * b.dt; i0, i1 = c["start"], c["end"] + 1
    GJ = {}
    for n in b.names:
        GJ[n] = Slerp(src[i0:i1], G[b.idx[n]][i0:i1])(ts)
    rp = np.stack([np.interp(ts, src[i0:i1], b.rootpos[i0:i1, k]) for k in range(3)], 1)
    legB = np.linalg.norm(b.offset[b.idx["LeftKnee"]]) + np.linalg.norm(b.offset[b.idx["LeftAnkle"]])
    s = legM / legB
    refy = np.percentile(b.rootpos[:, 1], 90)
    act = bpy.data.actions.new(c["name"]); arm.animation_data_create(); arm.animation_data.action = act
    hipsR = rest3("Hips")
    def pose_frame(fi, dz=0.0):
        Dw = {}
        for n in b.names: Dw[n] = GJ[n][fi].as_matrix()
        Dn = {}
        for n, (j, _) in MAP.items(): Dn[n] = Dw[j]
        qh, qc = R.from_matrix(Dw["Hips"]), R.from_matrix(Dw["Chest"])
        for n, fr in TRUNK.items():
            Dn[n] = Slerp([0, 1], R.concatenate([qh, qc]))([fr]).as_matrix()[0]
        for n, p in FOLLOW.items(): Dn[n] = Dn[p]
        Rp = {}
        for n in order:
            Da = Mn @ Dn[n] @ Mn.T
            Rp[n] = Da @ A[n] @ rest3(n)
        for n in order:
            p = parent[n]
            L = rest3(n).T @ (rest3(p) @ Rp[p].T if p else np.eye(3)) @ Rp[n]
            if n in CURL: L = L @ CURL[n]
            q = Matrix(L.tolist()).to_quaternion()
            pb = arm.pose.bones[P + n]; pb.rotation_quaternion = q; pb.keyframe_insert("rotation_quaternion", frame=fi + 1)
        d = np.array([rp[fi, 0] - rp[0, 0], (rp[fi, 1] - refy), rp[fi, 2] - rp[0, 2]]) * s
        da = Mn @ d + np.array(up) * dz
        loc = hipsR.T @ da
        pb = arm.pose.bones[P + "Hips"]; pb.location = Vector(loc); pb.keyframe_insert("location", frame=fi + 1)
    for fi in range(nfr): pose_frame(fi)
    # contato com o chao: mede a altura da sola em cada quadro e ajusta Hips
    sc = bpy.context.scene; sc.render.fps = FPS; lows = []
    for fi in range(nfr):
        sc.frame_set(fi + 1); z = []
        for sd in ("Left", "Right"):
            fz = lambda v: v.dot(up)
            z.append(fz(arm.pose.bones[P + sd + "Foot"].head) - fz(Vector(bone(sd + "Foot").head_local)) + 0.0)
            z.append(fz(arm.pose.bones[P + sd + "ToeBase"].tail) - fz(Vector(bone(sd + "ToeBase").tail_local)))
        lows.append(min(z))
    lows = np.array(lows); dz = -np.percentile(lows, 10)
    for fi in range(nfr): pose_frame(fi, dz)
    # erro de posicao vs BVH (cm do personagem): punho e tornozelo relativos ao quadril
    errs = []
    for fi in range(0, nfr, 3):
        sc.frame_set(fi + 1)
        for mj, bj in (("RightHand", "RightWrist"), ("LeftHand", "LeftWrist"), ("RightFoot", "RightAnkle"), ("LeftFoot", "LeftAnkle")):
            pm = (arm.pose.bones[P + mj].head - arm.pose.bones[P + "Hips"].head)
            pb = Mb @ Vector(((Pp[b.idx[bj]][i0:i1][int(round(ts[fi] / b.dt - c["start"]))] - Pp[0][i0:i1][int(round(ts[fi] / b.dt - c["start"]))]) * s))
            errs.append((pm - pb).length)
    ct = (c["contact"] - c["start"]) * b.dt * FPS
    meta = dict(name=c["name"], source=c["file"], frames=nfr, fps=FPS, contact_frame=int(round(ct)), contact_time=round(ct / FPS, 3),
                kind=c["kind"], root_left_m=round(float((rp[-1,0]-rp[0,0])*s/100),3), root_forward_m=round(float((rp[-1,2]-rp[0,2])*s/100),3), floor_shift_cm=round(float(dz), 2), pos_err_cm_mean=round(float(np.mean(errs)), 2), pos_err_cm_max=round(float(np.max(errs)), 2))
    # empurra para NLA
    tr = arm.animation_data.nla_tracks.new(); tr.name = c["name"]; st = tr.strips.new(c["name"], 1, act); arm.animation_data.action = None
    return meta

sel = json.load(open(SEL)); metas = []
for c in sel:
    if ONLY and c["name"] not in ONLY: continue
    m = process(c); metas.append(m); print(json.dumps(m))
os.makedirs(OUT, exist_ok=True)
json.dump(metas, open(os.path.join(OUT, "clips.json"), "w"), indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "retarget.blend"))
