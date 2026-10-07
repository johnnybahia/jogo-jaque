import numpy as np
from scipy.signal import find_peaks, savgol_filter
from seg import *; from lift import *
d = np.load('pose.npz')
def wrist_speed(dirs):
    """velocidade (H/s) do punho direito relativo à pelve, a partir das direções levantadas"""
    pos = dirs['spine'] * BONES['spine'][2] + dirs['shoR'] * BONES['shoR'][2] + dirs['uarmR'] * BONES['uarmR'][2] + dirs['farmR'] * BONES['farmR'][2]
    v = np.linalg.norm(np.gradient(savgol_filter(pos, 7, 2, axis=0), axis=0), axis=1) * FPS
    return v, pos
def find_swings(seg, prom=0.5):
    a, b = SEGS[seg]; P2, Zw, V = prep(d['img'], d['world'], d['vis'], a, b); dirs, s, dmp, extra = lift(P2, Zw)
    v, pos = wrist_speed(dirs); v[:4] = 0; v[-4:] = 0
    pk, pr = find_peaks(v, height=prom, distance=20, prominence=0.4)
    return a, b, v, pk, dirs, s, dmp, extra
if __name__ == '__main__':
    for seg in range(14):
        a, b, v, pk, dirs, s_, dmp_, ex_ = find_swings(seg)
        print(LABELS[seg].ljust(20), f'[{a/FPS:5.1f}-{b/FPS:5.1f}s]', ' '.join(f't={(a+p)/FPS:5.2f}s v={v[p]:.1f}' for p in pk), '| máx', round(float(v.max()), 1))
