"""Visuais das outras atletas a partir do atlas de cor da Jaqueline (uma textura só: pele, cabelo, camiseta, saia, viseira).
Uso: python3 make_looks.py <pasta com base.png e groups.png (extract.mjs)> <pasta de saída das texturas> [prévia.png]

A recoloração é por classe de cor (o atlas é limpo: camiseta azul-petróleo H≈196° S≈0,85 V≈0,58; azul-marinho da saia/viseira/debruns H≈222° S≈0,8 V≈0,23;
branco azulado dos painéis; pele H≈19°; cabelo quase preto V≈0,09, ponta do cabelo azul-petróleo):
  camiseta (e a ponta do cabelo) -> cor `shirt`; azul-marinho (saia, viseira, debruns) -> cor `dark`; branco azulado -> branco com leve tom da camiseta;
  cabelo (só cabeça, pescoço, tronco e "outros", escuro e pouco saturado) -> rampa de loiro, se `blonde`.
O brilho original (V) é mantido: o relevo e as fibras do cabelo continuam. Saída: look_<id>.jpg 1024² (qualidade 90, sem subamostragem de cor)."""
import sys, os
import numpy as np
from PIL import Image

LOOKS = {   # cores em sRGB 0..1
    "lari": dict(shirt=(1.00, 0.42, 0.30), dark=(0.20, 0.22, 0.27), blonde=True),     # loira: camiseta coral, saia e viseira grafite
    "bia": dict(shirt=(0.90, 0.22, 0.58), dark=(0.27, 0.12, 0.38), blonde=False),     # rosa e roxo
    "duda": dict(shirt=(0.50, 0.82, 0.18), dark=(0.07, 0.27, 0.17), blonde=False),    # verde-limão e verde-floresta
}
BLONDE0, BLONDE1 = np.array([0.72, 0.54, 0.22]), np.array([0.99, 0.92, 0.66])        # raiz/fibra escura -> brilho claro do cabelo loiro
HAIR_GROUPS = (1, 2, 3, 7)                                                            # cabeça, pescoço, tronco (ponta do cabelo nas costas), outros

def sm(x, a, b):
    return np.clip((x - a) / (b - a), 0.0, 1.0)

def rgb2hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(2), a.min(2); d = mx - mn + 1e-9
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    return h, d / (mx + 1e-9), mx

def window(h, a0, a1, b0, b1):
    """1 entre a1 e b0 (graus), sobe de a0 a a1 e desce de b0 a b1"""
    return sm(h, a0, a1) * (1.0 - sm(h, b0, b1))

def make(base, groups, cfg):
    a = np.asarray(base, dtype=np.float32) / 255.0
    h, s, v = rgb2hsv(a)
    gid = np.rint(np.asarray(groups.convert("L"), dtype=np.float32) / 30.0).astype(np.int32)
    skin = window(h, 3, 8, 40, 46) * sm(s, 0.10, 0.18) * (1 - sm(s, 0.62, 0.75)) * sm(v, 0.33, 0.43)
    teal = window(h, 165, 176, 203, 209) * sm(s, 0.45, 0.65) * sm(v, 0.28, 0.40)
    navy = window(h, 203, 209, 252, 262) * sm(s, 0.45, 0.62) * sm(v, 0.11, 0.16) * (1 - sm(v, 0.62, 0.75))
    white = window(h, 180, 188, 238, 246) * sm(v, 0.55, 0.70) * (1 - sm(s, 0.22, 0.35))
    out = a.copy()
    shirt, dark = np.array(cfg["shirt"], dtype=np.float32), np.array(cfg["dark"], dtype=np.float32)
    # camiseta (e ponta do cabelo): a cor escolhida com o brilho do original (V/0,58)
    col = np.clip(shirt[None, None, :] * (v / 0.58)[..., None], 0, 1)
    out = out * (1 - teal[..., None]) + col * teal[..., None]
    # azul-marinho: saia, viseira e debruns (V/0,23)
    col = np.clip(dark[None, None, :] * (v / 0.23)[..., None], 0, 1)
    out = out * (1 - navy[..., None]) + col * navy[..., None]
    # branco azulado dos painéis: neutro com 12% do tom claro da camiseta
    tint = (1 - 0.12) * np.ones(3, dtype=np.float32) + 0.12 * (0.4 * shirt + 0.6)
    col = np.clip(v[..., None] * tint[None, None, :], 0, 1)
    out = out * (1 - 0.85 * white[..., None]) + col * 0.85 * white[..., None]
    if cfg.get("blonde"):
        # cabelo: escuro e sem pele nem azul-petróleo; os fios têm V≈0,09 (brilho de fio até S≈0,8), a viseira azul-marinho tem V≥0,15 e S≈0,7: com S alta só vale V < 0,11
        hairgrp = np.isin(gid, HAIR_GROUPS).astype(np.float32)
        dark = sm(v, 0.03, 0.05) * ((1 - sm(v, 0.10, 0.13)) + (1 - sm(s, 0.45, 0.60)) * (1 - sm(v, 0.30, 0.40)))
        hair = np.clip(dark, 0, 1) * hairgrp * (1 - skin) * (1 - teal)
        t = (sm(v, 0.04, 0.30) ** 0.5)[..., None]
        col = BLONDE0[None, None, :] * (1 - t) + BLONDE1[None, None, :] * t
        out = out * (1 - hair[..., None]) + col * hair[..., None]
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")

def main():
    src, dst = sys.argv[1], sys.argv[2]
    base = Image.open(os.path.join(src, "base.png")).convert("RGB"); groups = Image.open(os.path.join(src, "groups.png"))
    os.makedirs(dst, exist_ok=True); made = []
    for name, cfg in LOOKS.items():
        im = make(base, groups, cfg); p = os.path.join(dst, f"look_{name}.jpg"); im.save(p, quality=90, subsampling=0); made.append((name, im))
        print("ok", p, os.path.getsize(p))
    if len(sys.argv) > 3:   # prévia: original + as 3
        w = 512; s = Image.new("RGB", (w * 4, w)); s.paste(base.resize((w, w)), (0, 0))
        for i, (_, im) in enumerate(made): s.paste(im.resize((w, w)), (w * (i + 1), 0))
        s.save(sys.argv[3])

if __name__ == "__main__":
    main()
