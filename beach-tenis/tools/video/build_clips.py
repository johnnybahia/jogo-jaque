"""Escolhe os golpes, resolve as rotações e grava clips.npz (um por golpe) para o bake no Blender."""
import numpy as np, json, sys
from seg import *; from lift import *; from solve import *; from swings import find_swings, d as POSE
PRE, POST = 36, 30        # quadros antes/depois do contato (1,2 s / 1,0 s a 30 fps)
def build(seg, pick, name):
    a, b, v, pk, dirs, s_px, dmp, extra = find_swings(seg)
    p = pk[pick] if pick < len(pk) else None
    if p is None: return None
    c0 = max(0, p - PRE); c1 = min(len(v), p + POST)          # janela dentro do segmento
    # aparar: começa na última pausa (punho parado) antes do golpe e termina quando o punho para depois dele (sem cortar abaixo de 0,8 s antes / 0,55 s depois)
    THR = 0.45; k = p - c0; i = k - 24
    while i > 0 and not (v[c0 + i - 3:c0 + i + 3] < THR).all(): i -= 1
    if i > 2 and (v[c0 + i - 3:c0 + i + 3] < THR).all(): c0 = c0 + i - 3
    k = p - c0; j = k + 17
    while c0 + j + 6 < c1 and not (v[c0 + j:c0 + j + 6] < THR).all(): j += 1
    if c0 + j + 4 < c1: c1 = c0 + j + 4
    if p - c0 < 20 or c1 - p < 15: print('janela curta', name, p - c0, c1 - p)
    sub = blend({k: x[c0:c1] for k, x in dirs.items()}, {k: x[c0:c1] for k, x in dmp.items()})
    ex = {k: x[c0:c1] for k, x in extra.items()}
    Q, D, yaw0, delta, dbg = solve(sub, s_px[c0:c1], ex)
    hl = np.einsum('ji,tj->ti', RREST[S['Hips']], delta) / 0.01
    return dict(name=name, D=D, delta=delta, dbg=dbg, win=(a + c0, a + c1), Q=Q, hips_loc=hl, contact=int(p - c0), fps=FPS, frames=int(c1 - c0), src=f'{LABELS[seg]} t={(a+p)/FPS:.2f}s', yaw0=float(np.degrees(yaw0)))
CONTACT_FIX = {'v_saque_1': 39}   # saque: o pico de velocidade do punho (0,9 s) é a queda da raquete atrás das costas; o contato é no ponto mais alto (1,3 s)
if __name__ == '__main__':
    plan = json.loads(sys.argv[1]) if len(sys.argv) > 1 else [[1, 0, 'v_fh_est_1']]
    out = {}; meta = {}
    for seg, pick, name in plan:
        r = build(seg, pick, name)
        if r is None: print('sem golpe', seg, pick); continue
        out[name + '_Q'] = r['Q']; out[name + '_loc'] = r['hips_loc']
        meta[name] = {k: r[k] for k in ('contact', 'fps', 'frames', 'src', 'yaw0')}
        if name in CONTACT_FIX: meta[name]['contact'] = CONTACT_FIX[name]
        print(name.ljust(18), r['src'].ljust(34), 'quadros', r['frames'], 'contato', r['contact'], 'yaw0 %.0f°' % r['yaw0'])
    np.savez_compressed('clips.npz', **out); json.dump(meta, open('clips_meta.json', 'w'), indent=1)
