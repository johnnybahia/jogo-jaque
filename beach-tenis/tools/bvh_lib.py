import re, numpy as np
from scipy.spatial.transform import Rotation as R

class BVH:
    def __init__(self, path):
        txt = open(path, errors="ignore").read()
        head, motion = txt.split("MOTION", 1)
        self.names, self.parent, self.offset, self.chan = [], [], [], []
        stack = []
        for line in head.splitlines():
            t = line.split()
            if not t: continue
            if t[0] in ("ROOT", "JOINT"):
                self.names.append(t[1]); self.parent.append(stack[-1] if stack else -1)
                self.offset.append(None); self.chan.append(None)
                stack.append(len(self.names) - 1)
            elif t[0] == "End":
                stack.append(-2)
            elif t[0] == "OFFSET" and stack[-1] >= 0:
                self.offset[stack[-1]] = np.array(t[1:4], float)
            elif t[0] == "CHANNELS":
                self.chan[stack[-1]] = t[2:]
            elif t[0] == "}":
                stack.pop()
        m = motion.split("\n")
        self.nf = int(m[1].split()[1]); self.dt = float(m[2].split()[2])
        data = np.array([l.split() for l in m[3:3 + self.nf]], float)
        self.data = data
        self.n = len(self.names)
        self.idx = {n: i for i, n in enumerate(self.names)}
        col = 0; self.rot = [None] * self.n; self.rootpos = None
        for j in range(self.n):
            ch = self.chan[j]
            if j == 0:
                self.rootpos = data[:, col:col + 3].copy(); col += 3; ch = ch[3:]
            seq = "".join(c[0] for c in ch)  # e.g. ZXY
            ang = data[:, col:col + 3]; col += 3
            self.rot[j] = R.from_euler(seq, ang, degrees=True)

    def globals(self):
        G = [None] * self.n; P = [None] * self.n
        for j in range(self.n):
            p = self.parent[j]
            if p < 0:
                G[j] = self.rot[j]; P[j] = self.rootpos.copy()
            else:
                G[j] = G[p] * self.rot[j]
                P[j] = P[p] + G[p].apply(self.offset[j])
        return G, P
