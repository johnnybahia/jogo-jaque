import sys, glob, os, json, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from bvh_lib import BVH
from scipy.signal import savgol_filter, find_peaks
D = sys.argv[1]; OUT = sys.argv[2]
labels = {}
for l in open(os.path.join(os.path.dirname(D.rstrip("/")), "labels.csv"), errors="ignore").read().splitlines()[1:]:
    t = l.split(";")
    if len(t) >= 5: labels[t[0]] = (int(t[1]), int(t[2]))
KIND = {"Derecha": "forehand", "Reves": "backhand", "Servicio": "serve", "Remate": "smash", "VDerecha": "fvolley", "VReves": "bvolley"}
WIN = {"serve": (2.0, 0.9), "smash": (1.6, 0.8), "forehand": (1.1, 0.9), "backhand": (1.1, 0.9), "fvolley": (0.7, 0.6), "bvolley": (0.7, 0.6)}
cands = []
for f in sorted(glob.glob(os.path.join(D, "*.bvh"))):
    base = os.path.basename(f)
    kind = next((v for k, v in KIND.items() if f"_{k}" in base), None)
    if not kind: continue
    try: b = BVH(f)
    except Exception as e: print("ERR", base, e); continue
    G, P = b.globals(); fps = 1 / b.dt
    sp = {}
    for side in ("Left", "Right"):
        w = P[b.idx[side + "Wrist"]]
        v = np.gradient(savgol_filter(w, 15, 3, axis=0), b.dt, axis=0)
        sp[side] = np.linalg.norm(v, axis=1)
    side = "Right" if np.percentile(sp["Right"], 98) >= np.percentile(sp["Left"], 98) else "Left"
    s = sp[side]
    thr = 0.55 * np.percentile(s, 99.5)
    pk, _ = find_peaks(s, height=thr, distance=int(1.2 * fps))
    pre, post = WIN[kind]
    hipy = b.rootpos[:, 1]
    for p in pk:
        a = max(0, int(p - pre * fps)); e = min(b.nf - 1, int(p + post * fps))
        if e - a < 0.8 * (pre + post) * fps: continue
        seg = slice(a, e + 1)
        # roughness: angular acceleration spikes
        q = G[b.idx[side + "Wrist"]][seg].as_quat()
        dq = np.abs(np.diff(q, axis=0)).sum(1)
        rough = float(np.percentile(dq, 99) / (np.median(dq) + 1e-6))
        disp = b.rootpos[e] - b.rootpos[a]
        cands.append(dict(file=base, kind=kind, side=side, start=int(a), end=int(e), contact=int(p), fps=fps,
                          peak=float(s[p]), dur=float((e - a) / fps), rough=rough,
                          dx=float(disp[0]), dz=float(disp[2]), hp=labels.get(base, (0, 0))[0], hipy_min=float(hipy[seg].min())))
json.dump(cands, open(OUT, "w"), indent=1)
import collections
c = collections.Counter(x["kind"] for x in cands); print("candidatos", len(cands), dict(c))
for k in KIND.values():
    L = sorted([x for x in cands if x["kind"] == k], key=lambda x: -x["peak"])[:3]
    for x in L: print(k, x["file"], x["side"], "peak %.0f cm/s" % x["peak"], "dur %.1fs" % x["dur"], "hp", x["hp"], "rough %.1f" % x["rough"])
print("lado dominante:", collections.Counter(x["side"] for x in cands))
