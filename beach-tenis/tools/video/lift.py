"""Pose 2D (precisa) + comprimentos de osso fixos -> direções 3D por osso (profundidade por comprimento, sinal por Viterbi com o z do MediaPipe).
Saída: dict de direções unitárias por osso no referencial W (x direita, y cima, z para a câmera), por quadro."""
import numpy as np
from scipy.signal import savgol_filter
from scipy.ndimage import median_filter, gaussian_filter1d, maximum_filter1d

FPS = 30
# proporções antropométricas (fração da altura H): (osso: comprimento)
# juntas MediaPipe: 0 nariz, 7/8 orelhas, 11/12 ombros, 13/14 cotovelos, 15/16 punhos, 19/20 indicadores, 17/18 mindinhos, 23/24 quadris, 25/26 joelhos, 27/28 tornozelos, 29/30 calcanhares, 31/32 ponta do pé
def virt(P):
    """acrescenta juntas virtuais: 33 = centro dos quadris, 34 = centro dos ombros, 35 = centro da cabeça (entre as orelhas)"""
    pel = (P[:, 23] + P[:, 24]) / 2; sho = (P[:, 11] + P[:, 12]) / 2; head = (P[:, 7] + P[:, 8]) / 2
    return np.concatenate([P, pel[:, None], sho[:, None], head[:, None]], axis=1)
PEL, SHO, HEAD = 33, 34, 35
# osso: (pai, filho, comprimento em fração de H)
BONES = {
    'pelvisL': (PEL, 23, 0.095), 'pelvisR': (PEL, 24, 0.095),
    'spine': (PEL, SHO, 0.300),
    'shoL': (SHO, 11, 0.129), 'shoR': (SHO, 12, 0.129),
    'uarmL': (11, 13, 0.186), 'farmL': (13, 15, 0.146), 'uarmR': (12, 14, 0.186), 'farmR': (14, 16, 0.146),
    'thighL': (23, 25, 0.245), 'shinL': (25, 27, 0.246), 'thighR': (24, 26, 0.245), 'shinR': (26, 28, 0.246),
    'footL': (27, 31, 0.150), 'footR': (28, 32, 0.150),
    'neck': (SHO, HEAD, 0.125),
    'earsLR': (7, 8, 0.075),
}
BIG = ['spine', 'uarmL', 'uarmR', 'thighL', 'thighR', 'shinL', 'shinR', 'farmL', 'farmR']

def prep(img, world, vis, a, b, W=720, Hh=1280):
    """recorta o segmento [a,b), interpola buracos, suaviza e devolve pontos 2D em px (y para baixo) e z do mundo."""
    P = img[a:b, :, :2] * np.array([W, Hh]); Z = world[a:b].copy(); V = vis[a:b]
    n = b - a
    def fill(x):
        x = x.copy(); m = np.isnan(x)
        if m.any() and (~m).sum() > 3: x[m] = np.interp(np.flatnonzero(m), np.flatnonzero(~m), x[~m])
        return x
    for j in range(33):
        for c in range(2): P[:, j, c] = fill(P[:, j, c])
        for c in range(3): Z[:, j, c] = fill(Z[:, j, c])
    # suavização leve (dois passos): remove tremor sem atrasar o golpe
    win = 7 if n >= 7 else (n // 2) * 2 - 1
    P = savgol_filter(P, win, 2, axis=0); Z = savgol_filter(Z, win, 2, axis=0)
    return virt(P), virt(Z), V

def scale_track(P2, win=15):
    """px por unidade de H (s) por quadro: maior razão ℓ/L entre os ossos grandes (osso paralelo à imagem), suavizada."""
    n = len(P2); R = []
    for k in BIG:
        a, b, L = BONES[k]; l = np.linalg.norm(P2[:, b] - P2[:, a], axis=1); R.append(l / L)
    R = np.sort(np.array(R), axis=0)
    s = R[-2]                                   # 2º maior: robusto a 1 osso com erro
    s = maximum_filter1d(s, 2 * win + 1, mode='nearest')
    s = gaussian_filter1d(median_filter(s, 2 * win + 1, mode='nearest'), win / 2, mode='nearest')
    return s

def viterbi_sign(ev, mag, lam=1.0):
    """escolhe o sinal (±1) de cada quadro maximizando a concordância com o z do MediaPipe (ev), penalizando trocas quando o osso está longe do plano da imagem."""
    n = len(ev); cost = np.zeros((n, 2)); back = np.zeros((n, 2), int)   # 0: -1, 1: +1
    sg = np.array([-1.0, 1.0])
    em = -(ev[:, None] * sg[None, :])            # custo: -concordância
    cost[0] = em[0]
    for t in range(1, n):
        flip = lam * np.clip(1.0 - 0.5 * (mag[t] + mag[t - 1]) / 0.35, 0.0, 1.0) * 1.0 + 0.02   # trocar custa pouco se o osso está quase paralelo à imagem
        stay = cost[t - 1]; sw = cost[t - 1][::-1] + flip
        for s_ in range(2):
            if stay[s_] <= sw[s_]: cost[t, s_] = stay[s_] + em[t, s_]; back[t, s_] = s_
            else: cost[t, s_] = sw[s_] + em[t, s_]; back[t, s_] = 1 - s_
    out = np.zeros(n, int); out[-1] = int(np.argmin(cost[-1]))
    for t in range(n - 1, 0, -1): out[t - 1] = back[t, out[t]]
    return sg[out]

def lift(P2, Zw, H=1.0):
    """retorna dict osso -> (n,3) direção unitária no referencial W (x direita, y cima, z para a câmera) e a escala s."""
    n = len(P2); s = scale_track(P2)
    dirs = {}; zmag = {}; dmp = {}
    for k, (a, b, L) in BONES.items():
        d2 = (P2[:, b] - P2[:, a])                    # px (x direita, y baixo)
        l = np.linalg.norm(d2, axis=1); Lp = s * L
        dz = np.sqrt(np.maximum(0.0, Lp ** 2 - l ** 2)) / s     # em H
        ev = (Zw[:, b, 2] - Zw[:, a, 2]) / 0.3       # z do mundo: + = afasta da câmera
        sign = viterbi_sign(ev, dz / L)              # sinal (+ afasta da câmera)
        v = np.stack([d2[:, 0] / s, -d2[:, 1] / s, -sign * dz], axis=1)     # W: x dir, y cima, z para a câmera = -afasta
        nv = np.linalg.norm(v, axis=1, keepdims=True); dirs[k] = v / np.maximum(nv, 1e-6); zmag[k] = dz / L
        w = Zw[:, b] - Zw[:, a]; w = np.stack([w[:, 0], -w[:, 1], -w[:, 2]], 1)     # MediaPipe (x dir, y baixo, z afasta) -> W
        dmp[k] = w / np.maximum(np.linalg.norm(w, axis=1, keepdims=True), 1e-6)
    ylow = np.stack([np.max(P2[:, [27, 29, 31], 1], axis=1), np.max(P2[:, [28, 30, 32], 1], axis=1)], 1)   # ponto mais baixo (px, y para baixo) de cada pé
    extra = {'ylow': ylow, 'pelvis_y': P2[:, PEL, 1], 'pelvis_x': P2[:, PEL, 0], 'ankle2d': np.stack([P2[:, 27], P2[:, 28]], 1)}
    return dirs, s, dmp, extra


ALPHA = {'pelvisL': .6, 'pelvisR': .6, 'spine': .7, 'shoL': .6, 'shoR': .6, 'uarmL': .6, 'farmL': .6, 'uarmR': .6, 'farmR': .6,
         'thighL': .4, 'shinL': .4, 'thighR': .4, 'shinR': .4, 'footL': .6, 'footR': .6, 'neck': .6, 'earsLR': .6}
def blend(dirs, dmp, alpha=ALPHA):
    out = {}
    for k, v in dirs.items():
        a = alpha.get(k, .6); w = a * v + (1 - a) * dmp[k]; out[k] = w / np.maximum(np.linalg.norm(w, axis=1, keepdims=True), 1e-6)
    return out
