# Golpes do vídeo → clipes da Jaqueline (`public/models/video_clips.glb`)

Pipeline que transforma um vídeo de golpes (câmera fixa em cada tomada) em animações do esqueleto Mixamo da Jaqueline.
Gerou os 26 clipes `v_*` (14 golpes, 1–2 repetições cada) do vídeo `movimentos.mp4` (não está no repositório).

## Etapas (rodar dentro desta pasta, com o vídeo ao lado)
1. `pip install mediapipe numpy scipy` (+ `ffmpeg`; no Linux `libegl1 libgles2`). Baixar o modelo `pose_landmarker_heavy.task` (Google MediaPipe).
2. `python extract_pose.py movimentos.mp4 pose_landmarker_heavy.task pose.npz` — landmarks 2D e 3D por quadro (1799/1800 detectados).
3. `seg.py` guarda os cortes de câmera do vídeo (1 tomada = 1 golpe, rótulos na tela) e `swings.py` acha as repetições (picos de velocidade do punho da raquete, mão direita).
4. `lift.py` — profundidade por comprimento de osso: o 2D é preciso; cada osso tem comprimento fixo (proporção antropométrica), então |Δz| = √(L² − ℓ²); o sinal vem do z do MediaPipe com Viterbi (trocas baratas só quando o osso está quase paralelo à imagem). Mistura 40–70% com as direções do MediaPipe.
5. `solve.py` — direções 3D por osso → rotações do esqueleto da Jaqueline (pelve/coluna/cabeça por quadros de referência; braços com torção do cotovelo **contínua** (suavizada, sem saltos de 180°); pernas com **pés plantados** (parados na imagem), altura e deslocamento da pelve vindos dos pés, IK de 2 ossos, joelho alinhado ao pé, pé nunca abaixo do chão e pé achatado). **Abertura das pernas limitada** (ângulo quadril→tornozelo comprimido acima de 20° lateral / 30° frente-trás; o quadril sobe um pouco para a perna não dobrar mais) para a saia não abrir demais, e **filtro de picos** (Hampel) nas rotações. Punho neutro (a face da raquete é assistida no contato pelo jogo).
6. `plan_all.py` + `build_clips.py` — escolhe 2 repetições por golpe, apara (começa na última pausa do punho antes do golpe) e grava `clips.npz`/`clips_meta.json`.
7. `bake_clips.py` (Blender/bpy) — ações no esqueleto + export GLB (NLA) → `public/models/video_clips.glb`; `video_clips.json` leva o instante de contato (pico do punho).

`rest.json` (pose de repouso dos ossos) sai de `dumprest.py` (Blender) e já está aqui.

## Limites conhecidos
- Pose monocular: profundidade por inferência (braços/pernas indo para a câmera podem errar o quanto avançam); pés plantados mantêm o chão, mas passos rápidos ficam suavizados.
- Sem pulso/mãos: a raquete segue o antebraço; no contato o jogo gira a face para a parede (`faceAssist`).
- No lugar: sem deslocamento horizontal líquido (o jogo move a jogadora).
- Golpes de uma pessoa destra; o vídeo foi gravado com o instrutor virado para a câmera (a rotação inicial da pelve é normalizada para "de frente").
