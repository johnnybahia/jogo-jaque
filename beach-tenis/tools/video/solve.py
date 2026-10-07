"""Direções 3D por osso (lift.py) -> rotações locais das poses do esqueleto Mixamo da Jaqueline (formato Blender: quaternion local por osso)."""
import json, numpy as np
from scipy.spatial.transform import Rotation as Rot
from scipy.ndimage import gaussian_filter1d, median_filter
from scipy.linalg import solve_banded

REST = json.load(open('rest.json'))
NAMES = list(REST.keys())
IDX = {n: i for i, n in enumerate(NAMES)}
SHORT = [n.replace('mixamorig:', '') for n in NAMES]
S = {n: i for i, n in enumerate(SHORT)}
PAR = np.array([IDX[REST[n]['parent']] if REST[n]['parent'] else -1 for n in NAMES])
assert all(PAR[i] < i for i in range(len(NAMES))), 'ossos fora de ordem hierárquica'
def _rot(M):
    R = np.array(M)[:3, :3]; R = R / np.linalg.norm(R, axis=0, keepdims=True)
    return R
RREST = np.array([_rot(REST[n]['M']) for n in NAMES])           # rotação de repouso (espaço do armature) por osso
HEAD = np.array([REST[n]['head'] for n in NAMES])               # posição de repouso da cabeça do osso (m)
TAIL = np.array([REST[n]['tail'] for n in NAMES])
D0 = TAIL - HEAD; D0 /= np.linalg.norm(D0, axis=1, keepdims=True)   # direção de repouso (cabeça→ponta)
# osso -> filho principal (para direção de repouso até a próxima junta)
def child(n, c): return IDX['mixamorig:' + c]
def rest_dir(a, b):
    v = HEAD[S[b]] - HEAD[S[a]]; return v / np.linalg.norm(v)

def unit(v): return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)
def skew(v):
    z = np.zeros(v.shape[:-1]); return np.stack([np.stack([z, -v[..., 2], v[..., 1]], -1), np.stack([v[..., 2], z, -v[..., 0]], -1), np.stack([-v[..., 1], v[..., 0], z], -1)], -2)
def rot_arc(a, b):
    a = np.broadcast_to(a, b.shape).astype(float); c = np.einsum('...i,...i->...', a, b); v = np.cross(a, b); s2 = np.einsum('...i,...i->...', v, v)
    K = skew(v); k = np.where(s2 > 1e-12, (1 - c) / np.maximum(s2, 1e-12), 0.5)
    R = np.eye(3) + K + np.einsum('...ij,...jk->...ik', K, K) * k[..., None, None]
    bad = c < -0.9999
    if np.any(bad):
        for idx in zip(*np.nonzero(bad)):
            ai = a[idx]; p = np.cross(ai, [1, 0, 0]) if abs(ai[0]) < 0.9 else np.cross(ai, [0, 1, 0]); p /= np.linalg.norm(p); R[idx] = 2 * np.outer(p, p) - np.eye(3)
    return R
def rot_axis(axis, ang):
    K = skew(axis); s = np.sin(ang)[..., None, None]; c = np.cos(ang)[..., None, None]
    return np.eye(3) + s * K + (1 - c) * np.einsum('...ij,...jk->...ik', K, K)
def mm(*Ms):
    out = Ms[0]
    for M in Ms[1:]: out = np.einsum('...ij,...jk->...ik', out, M)
    return out
def mt(M): return np.swapaxes(M, -1, -2)
def slerp_mat(R, t):      # R^t (potência de rotação)
    sh = R.shape[:-2]; r = Rot.from_matrix(R.reshape(-1, 3, 3)).as_rotvec() * t; return Rot.from_rotvec(r).as_matrix().reshape(*sh, 3, 3)
def frame_from(left, up):
    X = unit(left); Z = unit(up - np.einsum('...i,...i->...', up, X)[..., None] * X); Y = np.cross(Z, X)
    return np.stack([X, Y, Z], -1)

def to_A(d, yaw):
    """W (x dir, y cima, z p/ a câmera) -> A (x esquerda da jogadora, y trás, z cima), girando 'yaw' em torno de Z"""
    A = np.stack([d[..., 0], -d[..., 2], d[..., 1]], -1)
    c, s = np.cos(yaw), np.sin(yaw); R = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    return A @ R.T

def smooth_twist(obs, r, lam=8.0, mu=0.03, lim=2.1):
    """torção do braço contínua: segue o plano do cotovelo observado onde ele é confiável (r) e interpola/segura nos trechos incertos
    (braço quase esticado), sem saltos de ±180°; limitada a ±lim rad"""
    T = len(obs); w = np.clip(r, 0, 1); o = np.zeros(T); ok = np.nonzero(w > 0.02)[0]
    if len(ok): o[ok] = np.unwrap(obs[ok])
    ab = np.zeros((3, T)); main = w + mu + 2 * lam; main[0] -= lam; main[-1] -= lam
    ab[1] = main; ab[0, 1:] = -lam; ab[2, :-1] = -lam
    a = solve_banded((1, 1), ab, w * o)
    return lim * np.tanh(a / lim)

def hampel_quat(Q, win=5, tol=np.radians(14)):
    """tira picos isolados de 1–2 quadros (soluções trocadas) das rotações: troca pelo valor mediano da janela se a diferença passar de tol"""
    T, B, _ = Q.shape; out = Q.copy(); h = win // 2
    for i in range(B):
        q = Q[:, i]
        med = median_filter(q, size=(win, 1), mode='nearest'); med /= np.maximum(np.linalg.norm(med, axis=1, keepdims=True), 1e-9)
        dev = 2 * np.arccos(np.clip(np.abs(np.einsum('ti,ti->t', q, med)), 0, 1))
        bad = dev > tol; out[bad, i] = med[bad]
    return out

def smooth_dirs(dirs, sig):
    return {k: unit(gaussian_filter1d(v, sig, axis=0, mode='nearest')) for k, v in dirs.items()}


PCR = (HEAD[S['LeftUpLeg']] + HEAD[S['RightUpLeg']]) / 2        # centro dos quadris no repouso
L1 = {sd: float(np.linalg.norm(HEAD[S[sd + 'Leg']] - HEAD[S[sd + 'UpLeg']])) for sd in ('Left', 'Right')}
L2 = {sd: float(np.linalg.norm(HEAD[S[sd + 'Foot']] - HEAD[S[sd + 'Leg']])) for sd in ('Left', 'Right')}
LT_I, LS_I = 0.245, 0.246                                       # comprimentos de coxa/canela do levantamento (H)
KAPPA_H = 0.925                                                 # m por H para alturas vindas da imagem
ANKLE_H = 0.054
# abertura das pernas (a saia abria demais com o pé muito afastado do quadril): o ângulo da perna (quadril→tornozelo) em relação à vertical é
# comprimido acima de A0 (lateral e frente/trás separados) e o quadril sobe CP da diferença para a perna não dobrar mais por isso
LEG_LAT_A0, LEG_LAT_K = np.radians(20), 0.40
LEG_FB_A0, LEG_FB_K = np.radians(30), 0.45
LEG_CP = 0.45
STANCE_S0, STANCE_K = 0.20, 0.30   # separação lateral dos tornozelos (unid. do esqueleto ≈ 0,57 m no jogo): acima de S0 só passa K do excesso (apoio largo demais abre a saia)
LEG_POLE_W, LEG_TOE_MAX = 0.65, 12      # joelho segue o rumo do pé (peso máximo) e abertura máxima do pé em relação à pelve (°)

def planted(extra, s, still_lo=0.30, still_hi=0.70, gap_ok=0.30, gap_soft=0.15):
    """pé plantado = parado na imagem (câmera fixa) e não muito acima do chão de referência"""
    from scipy.signal import savgol_filter
    ank = extra['ankle2d']; T = len(ank); wl = 7 if T >= 7 else 5
    sm = savgol_filter(ank, wl, 2, axis=0) if T >= wl else ank
    sp = np.linalg.norm(np.gradient(sm, axis=0), axis=2) * 30.0 / s[:, None]            # H/s
    still = np.clip(1 - (sp - still_lo) / (still_hi - still_lo), 0, 1)
    yl = extra['ylow']; floor = yl.max(1); ref = median_filter(floor, size=min(51, T if T % 2 else T - 1), mode='nearest')
    gap = (ref[:, None] - yl) / s[:, None]; low = np.clip(1 - (gap - gap_ok) / gap_soft, 0, 1)
    return gaussian_filter1d(still * low, 1.0, axis=0), ref

def two_bone(Hj, T, l1, l2, pole):
    d = T - Hj; dist = np.linalg.norm(d, axis=-1, keepdims=True); dist = np.clip(dist, abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3)
    u = unit(d); along = (l1 ** 2 - l2 ** 2 + dist ** 2) / (2 * dist); h = np.sqrt(np.maximum(l1 ** 2 - along ** 2, 0))
    n = pole - np.einsum('...i,...i->...', pole, u)[..., None] * u; n = unit(n)
    knee = Hj + u * along + n * h; T2 = Hj + u * dist
    return unit(knee - Hj), unit(T2 - knee), T2

DBG = {}   # intermediários do último solve (diagnóstico)
def solve(dirs, s_px, extra, fps=30, sig=1.2, yaw0=None):
    T = len(next(iter(dirs.values())))
    dirs = smooth_dirs(dirs, sig)
    lW = unit(dirs['pelvisL'] - dirs['pelvisR']); lA0 = to_A(lW, 0.0)
    if yaw0 is None:
        n0 = min(T, 12); th = np.arctan2(lA0[:n0, 1].mean(), lA0[:n0, 0].mean()); yaw0 = -th
    d = {k: to_A(v, yaw0) for k, v in dirs.items()}
    up = np.array([0, 0, 1.0]); Id = np.broadcast_to(np.eye(3), (T, 3, 3)).copy()
    D = {n: Id.copy() for n in SHORT}; driven = {}
    # --- pelve, coluna, cabeça ---
    left_p = unit(d['pelvisL'] - d['pelvisR']); spine = d['spine']
    Dh = frame_from(left_p, unit(0.5 * up + 0.5 * spine)); driven['Hips'] = Dh
    left_c = unit(d['shoL'] - d['shoR']); Dc = frame_from(left_c, spine)
    Srel = mm(mt(Dh), Dc)
    driven['Spine'] = mm(Dh, slerp_mat(Srel, 1 / 3)); driven['Spine1'] = mm(Dh, slerp_mat(Srel, 2 / 3)); driven['Spine2'] = Dc
    left_h = -d['earsLR']; Dhd = frame_from(left_h, d['neck']); Hrel = mm(mt(Dc), Dhd)
    driven['Neck'] = mm(Dc, slerp_mat(Hrel, 0.4)); driven['Head'] = Dhd
    # --- clavículas ---
    for side, key in (('Left', 'shoL'), ('Right', 'shoR')):
        d0 = unit(HEAD[S[side + 'Arm']] - HEAD[S[side + 'Shoulder']])
        pre = mm(rot_arc(np.einsum('tij,j->ti', Dc, d0), d[key]), Dc)
        driven[side + 'Shoulder'] = mm(slerp_mat(mm(pre, mt(Dc)), 0.6), Dc)
    # --- braços ---
    for side, u, f in (('Left', 'uarmL', 'farmL'), ('Right', 'uarmR', 'farmR')):
        du0 = unit(HEAD[S[side + 'ForeArm']] - HEAD[S[side + 'Arm']]); df0 = unit(HEAD[S[side + 'Hand']] - HEAD[S[side + 'ForeArm']])
        fwd = np.array([0, -1.0, 0]); h0 = unit(np.cross(du0, fwd))
        pre = rot_arc(du0, d[u]); n_obs = unit(np.cross(d[u], d[f]))
        flex = np.arccos(np.clip(np.einsum('ti,ti->t', d[u], d[f]), -1, 1)); w = np.clip((flex - np.radians(14)) / np.radians(24), 0, 1)[:, None]
        n_def = np.einsum('tij,j->ti', pre, h0)
        hp = n_def - np.einsum('ti,ti->t', n_def, d[u])[:, None] * d[u]; npj = n_obs - np.einsum('ti,ti->t', n_obs, d[u])[:, None] * d[u]
        ang_obs = np.arctan2(np.einsum('ti,ti->t', d[u], np.cross(hp, npj)), np.einsum('ti,ti->t', hp, npj))
        ang = smooth_twist(ang_obs, w[:, 0])
        Du = mm(rot_axis(d[u], ang), pre); Df = mm(rot_arc(np.einsum('tij,j->ti', Du, df0), d[f]), Du)
        DBG[side + 'Arm'] = dict(flex=np.degrees(flex), w=w[:, 0], ang=np.degrees(ang), du=d[u], df=d[f])
        driven[side + 'Arm'] = Du; driven[side + 'ForeArm'] = Df; driven[side + 'Hand'] = Df
    # --- pernas: vetor quadril->tornozelo do levantamento (escala da Jaqueline), pés plantados, altura e deslocamento da pelve, IK ---
    wpl, ref = planted(extra, s_px)
    sides = (('Left', 'thighL', 'shinL', 'footL'), ('Right', 'thighR', 'shinR', 'footR'))
    off = {sd: np.einsum('tij,j->ti', Dh, HEAD[S[sd + 'UpLeg']] - PCR) for sd, *_ in sides}        # junta do quadril em relação ao centro, no mundo
    vleg = {}; polev = {}
    for (sd, t_, s_, f_), wi in zip(sides, (0, 1)):
        kap = (L1[sd] + L2[sd]) / (LT_I + LS_I)
        vl = d[t_] * LT_I + d[s_] * LS_I; vleg[sd] = vl * kap
        kn = d[t_] * LT_I; u = unit(vl); polev[sd] = kn - np.einsum('ti,ti->t', kn, u)[:, None] * u
    # abertura das pernas: comprime o ângulo quadril→tornozelo (lateral e frente/trás) em relação à vertical, na altura de quadril da imagem
    yl0 = extra['ylow']; ws0 = wpl.sum(1)
    yav0 = np.where(ws0 > 0.05, (wpl * yl0).sum(1) / np.maximum(ws0, 1e-6), ref); hz0 = KAPPA_H * (yav0 - extra['pelvis_y']) / s_px
    latH = np.einsum('tij,j->ti', Dh, np.array([1.0, 0, 0])); latH[:, 2] = 0; latH = unit(latH)
    fwdH = np.einsum('tij,j->ti', Dh, np.array([0, -1.0, 0])); fwdH[:, 2] = 0; fwdH = unit(fwdH)
    need_hz = np.full(T, -1.0)
    vleg0 = {sd: vleg[sd].copy() for sd in vleg}                                               # antes de qualquer compressão (o comprimento da perna vem daqui)
    aLat = {sd: np.einsum('ti,ti->t', off[sd] + vleg[sd], latH) for sd in ('Left', 'Right')}   # posição lateral do tornozelo em relação ao centro da pelve
    Ssep = aLat['Left'] - aLat['Right']; S2 = np.where(Ssep > STANCE_S0, STANCE_S0 + (Ssep - STANCE_S0) * STANCE_K, Ssep); rS = np.where(Ssep > 1e-6, S2 / np.maximum(Ssep, 1e-6), 1.0)
    cenS = (aLat['Left'] + aLat['Right']) / 2
    for sd in ('Left', 'Right'): vleg[sd] = vleg[sd] + latH * (cenS + (aLat[sd] - cenS) * rS - aLat[sd])[:, None]   # apoio mais estreito: os dois pés se aproximam do centro
    for wi, (sd, *_ ) in enumerate(sides):
        vl = vleg[sd]; sg = 1.0 if sd == 'Left' else -1.0
        lo = sg * np.einsum('ti,ti->t', vl, latH); fb = np.einsum('ti,ti->t', vl, fwdH)           # lo > 0: perna aberta para fora; fb > 0: para a frente
        lo0 = sg * np.einsum('ti,ti->t', vleg0[sd], latH); fb0 = np.einsum('ti,ti->t', vleg0[sd], fwdH)
        pl = wpl[:, wi]; dr = np.where(pl > 0.5, np.maximum(hz0 - ANKLE_H, 0.05), np.maximum(-vl[:, 2], 0.05))
        al = np.arctan2(np.maximum(lo, 0), dr); al2 = np.where(al > LEG_LAT_A0, LEG_LAT_A0 + (al - LEG_LAT_A0) * LEG_LAT_K, al)
        af = np.arctan2(np.abs(fb), dr); af2 = np.where(af > LEG_FB_A0, LEG_FB_A0 + (af - LEG_FB_A0) * LEG_FB_K, af)
        lo2 = np.where(lo > 0, dr * np.tan(al2), lo); fb2 = np.sign(fb) * dr * np.tan(af2)
        chord = np.sqrt(dr ** 2 + np.maximum(lo0, 0) ** 2 + fb0 ** 2); dr_t = np.sqrt(np.maximum(chord ** 2 - np.maximum(lo2, 0) ** 2 - fb2 ** 2, 0))   # perna com o mesmo comprimento de antes
        need_hz = np.where(pl > 0.5, np.maximum(need_hz, ANKLE_H + dr_t), need_hz)
        vleg[sd] = vl + latH * (sg * (lo2 - lo))[:, None] + fwdH * (fb2 - fb)[:, None]
    # deslocamento horizontal da pelve a partir dos pés plantados (pés parados no mundo)
    rel = {sd: (off[sd] + vleg[sd])[:, :2] for sd, *_ in sides}
    dp = np.zeros((T, 2))
    for t in range(1, T):
        num = np.zeros(2); den = 0.0
        for wi, (sd, *_ ) in enumerate(sides):
            om = wpl[t, wi] * wpl[t - 1, wi]; num += om * (rel[sd][t - 1] - rel[sd][t]); den += om
        if den > 0.05: dp[t] = num / den
    p = np.cumsum(dp, axis=0); lin = np.linspace(0, 1, T)[:, None] * p[-1]; p = p - lin
    # altura da pelve: chão sob a pelve = média (ponderada) dos pontos mais baixos dos pés plantados na imagem; sem pé plantado (salto) usa o chão de referência
    yl = extra['ylow']; wsum = wpl.sum(1)
    yavg = np.where(wsum > 0.05, (wpl * yl).sum(1) / np.maximum(wsum, 1e-6), ref)
    hz = KAPPA_H * (yavg - extra['pelvis_y']) / s_px
    hz = np.where(need_hz > 0, np.maximum(hz, hz + LEG_CP * (need_hz - hz)), hz)             # abertura menor: o quadril sobe um pouco para a perna não dobrar mais
    for wi, (sd, *_ ) in enumerate(sides):        # alcance: o pé plantado precisa alcançar o chão com a perna da Jaqueline
        dxy = np.linalg.norm((vleg[sd])[:, :2], axis=1); lim = ANKLE_H + np.sqrt(np.maximum(((L1[sd] + L2[sd]) * 0.995) ** 2 - dxy ** 2, 0))
        hz = np.where(wpl[:, wi] > 0.5, np.minimum(hz, lim), hz)
    hz = gaussian_filter1d(hz, 1.0, mode='nearest')
    c = np.concatenate([p, hz[:, None]], 1)                          # centro dos quadris no mundo
    for wi, (sd, t_, s_, f_) in enumerate(sides):
        Hj = c + off[sd]; Tg = Hj + vleg[sd]
        Tg[:, 2] = wpl[:, wi] * ANKLE_H + (1 - wpl[:, wi]) * Tg[:, 2]
        Tg[:, 2] = np.maximum(Tg[:, 2], ANKLE_H)                                 # o pé nunca fica abaixo do chão
        # joelho: aponta para onde o pé aponta (rumo do pé em relação à frente da pelve, limitado e suave), misturado ao joelho do levantamento
        hd = d[f_].copy(); hd[:, 2] = 0; hn = np.linalg.norm(hd, axis=1); hd = np.where((hn > 0.15)[:, None], unit(hd), fwdH)
        ph = np.unwrap(np.arctan2(hd[:, 1], hd[:, 0]) - np.arctan2(fwdH[:, 1], fwdH[:, 0])); ph = np.arctan2(np.sin(ph), np.cos(ph))
        ph = gaussian_filter1d(np.clip(ph, -np.radians(LEG_TOE_MAX), np.radians(LEG_TOE_MAX)), 2.0, mode='nearest')
        cs, sn = np.cos(ph), np.sin(ph); head = np.stack([cs * fwdH[:, 0] - sn * fwdH[:, 1], sn * fwdH[:, 0] + cs * fwdH[:, 1], np.zeros(T)], 1)
        uu = unit(vleg[sd]); p2 = head - np.einsum('ti,ti->t', head, uu)[:, None] * uu; mag = np.linalg.norm(p2, axis=1)
        wP = (LEG_POLE_W * np.clip(mag / 0.35, 0, 1))[:, None]
        fwd = np.einsum('tij,j->ti', Dh, np.array([0, -1.0, 0]))
        p1 = unit(polev[sd] + 0.05 * np.linalg.norm(vleg[sd], axis=1, keepdims=True) * (fwd - np.einsum('ti,ti->t', fwd, uu)[:, None] * uu))
        pole = unit((1 - wP) * p1 + wP * unit(p2))
        d[t_], d[s_], T2 = two_bone(Hj, Tg, L1[sd], L2[sd], pole)
        # pé plantado: achata o pé (pitch do repouso) mantendo o rumo
        df_rest = unit(HEAD[S[sd + 'ToeBase']] - HEAD[S[sd + 'Foot']]); hor = d[f_].copy(); hor[:, 2] = 0; hor = unit(hor)
        flat = unit(hor * np.hypot(df_rest[0], df_rest[1]) + np.array([0, 0, df_rest[2]]))
        w = wpl[:, wi][:, None]; d[f_] = unit(w * flat + (1 - w) * d[f_])
        # a ponta do pé não entra no chão: sobe o pé até a ponta tocar
        ltoe = float(np.linalg.norm(HEAD[S[sd + 'ToeBase']] - HEAD[S[sd + 'Foot']])); need = (0.005 - T2[:, 2]) / ltoe
        dz = np.minimum(np.maximum(d[f_][:, 2], need), 0.95); hxy = d[f_].copy(); hxy[:, 2] = 0; hxy = unit(hxy)
        d[f_] = unit(hxy * np.sqrt(1 - dz ** 2)[:, None] + np.array([0, 0, 1.0]) * dz[:, None])
    for (sd, t_, s_, f_) in sides:
        du0 = unit(HEAD[S[sd + 'Leg']] - HEAD[S[sd + 'UpLeg']]); ds0 = unit(HEAD[S[sd + 'Foot']] - HEAD[S[sd + 'Leg']]); df0 = unit(HEAD[S[sd + 'ToeBase']] - HEAD[S[sd + 'Foot']])
        pre = rot_arc(du0, d[t_]); angs = np.radians(np.arange(-90, 91, 6.0)); score = np.zeros((T, len(angs)))
        for j, a_ in enumerate(angs):
            Du_ = mm(rot_axis(d[t_], np.full(T, a_)), pre); Ds_ = mm(rot_arc(np.einsum('tij,j->ti', Du_, ds0), d[s_]), Du_)
            Dfo = mm(rot_arc(np.einsum('tij,j->ti', Ds_, df0), d[f_]), Ds_); score[:, j] = np.einsum('tij,j->ti', Dfo, up)[:, 2]
        score = gaussian_filter1d(score, 2.0, axis=0); jb = score.argmax(1); ang = gaussian_filter1d(angs[jb], 2.5, mode='nearest')
        Du = mm(rot_axis(d[t_], ang), pre); Ds = mm(rot_arc(np.einsum('tij,j->ti', Du, ds0), d[s_]), Du); Dfo = mm(rot_arc(np.einsum('tij,j->ti', Ds, df0), d[f_]), Ds)
        driven[sd + 'UpLeg'] = Du; driven[sd + 'Leg'] = Ds; driven[sd + 'Foot'] = Dfo; driven[sd + 'ToeBase'] = Dfo
    for i, n in enumerate(SHORT):
        D[n] = driven[n] if n in driven else (D[SHORT[PAR[i]]] if PAR[i] >= 0 else Id)
    Q = np.zeros((T, len(SHORT), 4)); Q[:, :, 0] = 1
    for i, n in enumerate(SHORT):
        Dp = D[SHORT[PAR[i]]] if PAR[i] >= 0 else Id
        loc = mm(mt(RREST[i]), mt(Dp), D[n], RREST[i]); q = Rot.from_matrix(loc).as_quat()
        Q[:, i] = np.stack([q[:, 3], q[:, 0], q[:, 1], q[:, 2]], 1)
    for i in range(Q.shape[1]):
        for t in range(1, T):
            if np.dot(Q[t, i], Q[t - 1, i]) < 0: Q[t, i] = -Q[t, i]
    Q = hampel_quat(Q); Q = gaussian_filter1d(Q, 0.8, axis=0, mode='nearest'); Q /= np.linalg.norm(Q, axis=2, keepdims=True)
    # deslocamento do osso Hips (m, espaço A): centro dos quadris c + Dh (Hips - PCR) - Hips_repouso
    delta = c + np.einsum('tij,j->ti', Dh, HEAD[S['Hips']] - PCR) - HEAD[S['Hips']]
    return Q, D, yaw0, delta, dict(wpl=wpl, p=p, hz=hz, ref=ref)

def fk_points(D, delta=None):
    """posições das juntas (m) no espaço A: pos_b = pos_p + D_p (h_b - h_p)"""
    T = D['Hips'].shape[0]; P = np.zeros((T, len(SHORT), 3))
    for i, n in enumerate(SHORT):
        if PAR[i] < 0: P[:, i] = HEAD[i] + (0 if delta is None else delta)
        else:
            Dp = D[SHORT[PAR[i]]]; P[:, i] = P[:, PAR[i]] + np.einsum('tij,j->ti', Dp, HEAD[i] - HEAD[PAR[i]])
    return P

# pontos de contato com o chão: (osso, deslocamento de solado) — tornozelo 0,054; ponta do pé 0,005
SOLE = [('LeftFoot', 0.054), ('RightFoot', 0.054), ('LeftToeBase', 0.005), ('RightToeBase', 0.005)]
def ground(D):
    P = fk_points(D)
    zs = np.stack([P[:, S[n], 2] - off for n, off in SOLE], 1)
    return -zs.min(1)         # deslocamento vertical do Hips para o pé mais baixo tocar o chão (z=0)
