# Jogo 3D de Beach Tênis — contexto e estado (handoff para Claude Code)

Dono: Johnny. Projeto **pessoal/experimental, não será vendido** (licenças não comerciais são aceitáveis; manter atribuições).
Objetivo: jogo 3D de beach tênis o mais realista possível, **instalável no celular (PWA)**, na linha dos jogos dele:
- `johnnybahia/ninja` (Kage): React + Vite + Three.js, PWA offline com service worker gerado no build, personagens Mixamo em GLB, pipeline Blender/bpy (`scripts/convert_characters.py`), `models.ts`, `clipRig.ts`, `moves.ts` (frames de impacto por golpe), perfis de qualidade (`QualityProfile`), controles de toque.
- `johnnybahia/ramikami`: TypeScript + Vite + Three.js, PWA, servidor Cloudflare Worker (online, opcional).
- `johnnybahia/jogo-jaque`: **só assets** (sem código): `JAQUELINE+OK PRONTA.fbx` (personagem rigada), pacotes Mixamo (locomotion, magic, melee axe, free test, samba) e `jaque-jogadora.jpg`.

Ambiente do Johnny: **Windows**, sem CUDA (GPU AMD R7 M340 2 GB), 8 GB RAM, 4 threads. Preferências: respostas concisas; antes de gerar código, descrever entendimento + plano + "Riscos e Casos Extremos" e esperar confirmação; entregar só blocos modificados/novos; código final completo e funcional.

## Personagem
- `JAQUELINE+OK PRONTA.fbx`: rig **Mixamo padrão, 65 ossos** (`mixamorig:*`, com dedos), 30 fps, malha 25 mil vértices, textura 10 MB (reduzida a 1024 px/JPEG no GLB).
- Altura nativa ~**0,98 m** (importa com escala 0,01 no Armature). No jogo escalar ~×1,75 para ~1,7 m.
- Objeto Armature vem do FBX deitado (cima local = −Y mundo): o script de retarget zera a rotação do Armature (cima local = +Z mundo; exporta Y-up no glTF).

## Fontes de movimento avaliadas (resumo)
| Fonte | Veredito |
|---|---|
| **Tennis-MoCap** (github.com/jdpulgarin/Tennis-MoCap) | **USADO.** 100 BVH, 16 jogadores (todos destros), 100 Hz, Optitrack, Y-up, cm. 6 gestos: Derecha=forehand, Reves=backhand, Servicio=saque, Remate=smash, VDerecha/VReves=voleios. Esqueleto de 17 juntas, sem dedos/raquete. Licença **CC BY-SA 3.0** (atribuir; derivados na mesma licença se distribuir). |
| Bandai Namco Motiondataset | Só locomoção/idle/luta. CC BY-NC 4.0. Sem tênis. |
| THETIS (Kinect) | Vídeo RGB de 12 golpes; esqueleto 3D vem como .avi (inutilizável). Servir como vídeo p/ mocap. |
| 3DTennisDS (tennisdb.cs.pollub.pl) | Vicon, C3D (marcadores). Forehand/backhand/voleios. Exige citar. Não usado. |
| Tennisman/Tenniswoman (Superhive, US$35/45) | Pago, .blend, mocap 30 fps, ~68/166 clipes (saques, golpes correndo, drop, smash). Opção futura p/ movimento de quadra. |
| GVHMR / WHAM | Vídeo → SMPL. Pesos não comerciais (ok). Exigem CUDA → rodar no Google Colab. Para filmar saque por baixo etc. |
| OpenHawk (github.com/maxsegan/openhawk, Apache-2.0) | Sem movimento de jogador; **física de bola reutilizável** (voo com arrasto/Magnus, spin 3D, lei de quique) em `physics/flight.py`, `bounce_reference.py`, `impact.py`. |
| from-love (jcmnavia) | Golpes por keyframes + IK analítico (sem mocap); referência de método. Licença não vista. |
| vid2player3d (NVIDIA) | Modelos indisponíveis, exige IsaacGym. Inviável. |
| Tennis-3DVision-Project, PadelTracker100, CalTennis, AthletePose3D, BONES-SEED, AMASS, Motion-X, CMU | Sem movimento de tênis utilizável/gratuito ou licença/volume inviável. |

**Lacuna:** não existe mocap pronto de **beach tênis** (saque por baixo, voleio de rede, deslocamento na areia). Cobrir com: golpes de tênis (feito), locomoção Mixamo (já no repo), e filmar o resto → GVHMR (Colab) → mesmo script de retarget.

## O que já foi feito (neste repositório de entrega)
Pipeline `scripts/` (Python 3.13 + `bpy` 5.2 + numpy/scipy; rodar com `python -I`):
1. `segment.py`: lê todos os BVH, calcula velocidade do punho (savgol), acha picos e corta golpes (janelas: saque 2,0 s antes/0,9 s depois; smash 1,6/0,8; fundo 1,1/0,9; voleio 0,7/0,6) → `cands.json` (911 candidatos).
2. `select.py`: filtra por jogador destro, rugosidade, deslocamento; prefere jogadores de alto desempenho; escolhe 2 por golpe, jogadores distintos → `selected.json` (12 clipes).
3. `retarget.py`: BVH → ossos Mixamo da Jaqueline.
   - Mapeamento de eixos anatômico (esq/cima/frente medidos no rig), rotação por **delta global** com correção de direção por osso (A = diferença entre direção do osso Mixamo e do BVH em T-pose), tronco distribuído em Spine/Spine1/Spine2 (slerp 1/3, 2/3, 1), dedos/pés/toe seguem mão/pé rigidamente, **dedos em empunhadura** (curl fixo), Hips com translação escalada pelo comprimento de perna (0,57), **ajuste de altura para a sola tocar o chão** (percentil 10), reamostragem 100→30 fps com slerp.
   - Cada clipe vira uma ação em trilha NLA no `retarget.blend`.
4. `export_glb.py`: GLB com malha + 65 juntas + 12 animações (NLA_TRACKS), texturas JPEG ≤1024.
5. `render_strip.py`: renderiza quadros (Cycles CPU) para conferência visual.

## Resultado: `jaqueline_tenis.glb` (4,0 MB) + `clips.json`
12 animações, 30 fps, 65 canais por clipe, Y-up, personagem olha para +Z.

| Clipe | Fonte | Frames | Duração | Frame de contato | Erro posição médio |
|---|---|---|---|---|---|
| forehand_1/2 | jgacosta_Derecha / lvargas_Derecha_7seg | 61 | 2,03 s | 33 (1,10 s) | 5,4 / 3,8 cm |
| backhand_1/2 | lvargas_Reves / jgacosta_Reves | 61 | 2,03 s | 33 | 3,8 / 5,2 cm |
| serve_1/2 | jgacosta_Servicio / lvargas_Servicio_21seg | 88 | 2,93 s | 60 (2,00 s) | 5,3 / 3,7 cm |
| smash_1/2 | lvargas_Remate / jduribe_Remate | 73 | 2,43 s | 48 (1,60 s) | 3,8 / 3,5 cm |
| fvolley_1/2 | jgacosta_VDerecha / jarua_VDerecha | 40 | 1,33 s | 21 (0,70 s) | 5,7 / 4,5 cm |
| bvolley_1/2 | jduribe_VReves / jgacosta_VReves | 40 | 1,33 s | 21 | 3,3 / 5,5 cm |

`clips.json` também traz `root_left_m` / `root_forward_m` (deslocamento da raiz no clipe, em metros da escala do personagem 0,98 m; smash_1 avança ~0,48 m).
Conferido visualmente (tiras `strip_forehand.png`, `strip_serve_smash.png`): preparação, giro, contato, finalização plausíveis; pés no chão; sem membros quebrados.

## Limitações conhecidas (honestas)
- **Frame de contato = pico de velocidade do punho**, não do cabeça da raquete: erro estimado ±3 frames. Ajustar por clipe olhando o jogo.
- Erro de posição ~4–5 cm no personagem de 0,98 m (≈8 cm numa pessoa de 1,7 m) por diferença de proporções.
- **Sem raquete/bola no mocap**: prender a raquete ao osso `mixamorig:RightHand` e ajustar orientação por golpe. Dedos têm curl fixo (não animados).
- **Pés podem deslizar** (só a altura é corrigida; sem IK de pé travado). Clipes têm movimento de raiz; o jogo decide usar o root motion ou zerar XZ.
- Só destros (todos os 16 jogadores são destros). Para canhoto: espelhar no jogo ou adicionar espelhamento no `retarget.py`.
- Golpes de tênis, não de beach tênis: raquete de beach tênis é mais curta e rígida; ritmo/velocidade diferentes. Saque por baixo **não coberto**.
- Os 12 clipes cobrem 1 golpe cada, sem emendar com idle (usar crossfade ~0,15–0,25 s). Locomoção/idle: usar os FBX Mixamo do repo (mesmo rig, mesmo `mixamorig:`).
- Qualidade do mocap varia; há ~900 candidatos em `cands.json` para trocar clipes ruins.

## Mão, pulso e raquete (correção em runtime)
- **Desvio do retarget:** nos 12 golpes a mão vem com um desvio fixo de ~110–125° no eixo X da mão (diferença de eixo BVH × osso Mixamo): mão dobrada >100° em quase todo quadro, torção medida até 400° e a pele do pulso "virava laço". `wrist.ts` estima o desvio de cada mão a partir dos próprios clipes (rotação média), tira ele (`q · offset⁻¹`) e filtra/limita torção (±110°) e flexão (80°). Se o GLB for reexportado com o retarget corrigido (desvio < 25°) a correção não faz nada.
- **Ossos de torção:** `WristTwist` cria 2 ossos no antebraço (BTTwist*1/2) e reparte o peso do antebraço por posição; eles giram 40% e 80% da torção da mão. Sem eles a pele pinça já em ~90°.
- **Pegada:** `rig.ts` mede F (dedos), A (lado do polegar) e N (palma) nos ossos da mão; a raquete atravessa a palma na diagonal (cabo→cabeça = A girado 55° para F, face = N), e os dedos da mão direita são fechados em volta do cabo. `rk*` nos Ajustes agora é ajuste fino sobre isso (configurações v2; os valores v1 de raquete são descartados, o resto migra).
- **Posição de espera:** `ready.ts` troca o braço direito dos clipes de parada/corrida (pose de conjuração do pacote Magic: mão na altura da cabeça) por uma pose fixa de espera (braço pendente, cotovelo dobrado, raquete à frente com a cabeça para cima).
- **Contato dos golpes por cima:** saque/smash usam o ponto mais alto entre os quadros rápidos (o pico de velocidade da cabeça vem na descida).

## Locomoção (pernas)
- **Problema:** um ciclo fixo de 0,75 s e 3,6 m/s para todas as direções: os pés patinavam (ré 56% mais rápida que os pés; esquerda/frente ~20%+; em velocidades baixas quase 100%).
- **`loco.ts`:** mede, ao carregar, a velocidade natural de cada clipe (média da velocidade do pé apoiado em relação ao corpo) e o instante do toque de cada pé; toca no ritmo velocidade ÷ distância por ciclo (mínimos quadrados quando mistura direções), com fase comum alinhada nos dois toques; andar↔correr por velocidade; velocidade máxima por direção (frente 3,4 / lado 3,0 / ré 2,6 m/s, perto da velocidade natural dos clipes).
- **Clipes:** parada e corridas continuam no `jaqueline.glb`; as caminhadas (frente/ré/esquerda/direita, pacote Magic) vêm de `loco2.glb` + `loco2.json`, gerados por `tools/add_clips.py` (FBX Mixamo → ações no esqueleto da Jaqueline, in-place, velocidade natural em m/s).
- **Cuidado:** FBX Mixamo "com malha" (os que trazem a personagem, 8 MB) têm os eixos do Hips diferentes dos pacotes sem malha; copiar a ação para o esqueleto dá quadril girado ~90° e sem altura. `Standing Walk Back.fbx` enviado em `beach-tenis/` é a mesma animação do pacote Magic (37 quadros); `Run Look Back` é corrida em curva; `Injured`/`Crouch Torch` são mancando/agachado.
- **Medido (patinação = velocidade do pé apoiado ÷ velocidade do corpo; piso de ~15–20% do próprio osso do tornozelo):** frente 1,0 m/s 89→36%, 2,0 m/s 72→18%; ré 1,0 94→14%, 2,0 80→21%; esquerda 1,0 102→41%, 2,0 91→19%; direita 1,0 86→47%, 2,0 62→22%. Diagonais para trás (ré+lado) seguem altas (~80–100%: misturar dois clipes de passo não casa os apoios).

## Golpes do vídeo do autor (pose 3D por vídeo → Jaqueline)
- **Origem:** `movimentos.mp4` (60 s, 14 tomadas de câmera fixa: forehand/backhand dinâmico e estático, anômalo, smash, gancho, rainbow/ventaglio, bandeja forehand/backhand, verônica, espeto, arco inferior/leque, saque). Pose por MediaPipe (heavy) quadro a quadro; 1799/1800 quadros detectados, sem troca esquerda/direita.
- **Método (`tools/video/`):** o 2D é preciso e a profundidade do monocular não; por isso cada osso tem comprimento fixo e |Δz| = √(L² − ℓ²) (sinal do z do MediaPipe + Viterbi), misturado com as direções do MediaPipe; direções → rotações Mixamo (quadros de referência na pelve/tronco/cabeça, torção do braço pelo plano do cotovelo); pernas com pés plantados (parados na imagem), altura da pelve e deslocamento a partir dos pés, IK de 2 ossos e pé achatado; punho neutro (sem torção/laço); apara do clipe na pausa do punho. Verificado lado a lado com o vídeo (frente, lado e costas).
- **Resultado:** 26 clipes `v_*` em `public/models/video_clips.glb` (1,6 MB) + `video_clips.json` (instante de contato). `rig.ts` os carrega, mede o contato da raquete (±0,12 s do pico do punho) e `strokes.ts` descreve cada golpe (rótulo PT, tipo, tempo de preparo, se é por cima).
- **No jogo (treino):** os 13 golpes do vídeo (todos menos o saque, que abre o rali) entram conforme a bola. `game.ts`: `candidates` = todos os clipes; a altura do contato de cada clipe (`contactLocal.y`, ±0,2 m) decide quais servem; `launch` sorteia o próximo golpe (`pickIntent`, pesos e sem repetir os 2 últimos), procura na parede (sempre acima da rede de 1,70 m) uma trajetória rebatível com ele (1 previsão por trajetória, orçamento de 12 ms por passada) e, se não houver, cai para outro golpe/qualquer golpe; `computeCue` dá bônus ao golpe sorteado. O nome aparece junto do GOLPE e no aviso. Medido com bots: 13/13 golpes em 200 s, 98–100% de acertos; busca da bola: média 1–6 ms, p95 ≤15 ms (CPU 4× mais lenta: p95 13 ms). Volêios de mocap só como reserva.
- **Saque animado:** `serveStart/serveStep`: clipe `v_saque_1` (contato corrigido para o ponto mais alto, 1,30 s); a bola sai da mão esquerda aos 0,42 s e sobe em arco até a raquete; no contato `doContact` lança a bola para a parede e o estado passa de `serve` para `rally`.
- **Fôlego:** `stamina.ts` (`Stamina`): gasta 2% por metro andado/corrido e 1,2% por golpe (3% por cima, 2% saque), recupera 8%/s entre pontos (+25% ao perder o ponto) e quase nada durante o rali; velocidade máxima = 55–100% (curva suave abaixo de 45% de fôlego); os limites de corrida do lançamento/marcador (`NEED_*`) acompanham o multiplicador para o treino continuar jogável. Barra no HUD (`#sta`), aviso "Sem fôlego!" abaixo de 12%, opção `S.stamina`. Pensado para a partida: a adversária terá a sua e bola colocada longe cansa.
- **Vida do personagem** (`posefx.ts`, `PoseFX`): camada de pose depois do mixer, vale para qualquer clipe: a cabeça acompanha a bola (guinada em torno do eixo vertical + inclinação lateral, sem torcer o pescoço; limite de 70° em relação ao peito), respiração do tronco (lenta com fôlego, rápida e funda cansada) e curva do tronco quando cansada, inclinação do tronco nas arrancadas/frenagens. Nos golpes o tronco fica exatamente como no clipe (o contato depende dele); desligada na galeria. Medido com bots: não muda os acertos. **Reações de fim de ponto** (`react`): suspiro (rali < 3: cabeça balança, ombros caem) e comemoração (recorde ≥ 6 ou rali ≥ 20: pulinhos, punho esquerdo para cima, braço esticado por `straighten`); o braço da raquete não mexe. Depois do ponto ela **volta andando a 2 m/s à posição de saque** (`HOME`, centro atrás da linha de fundo) e só então saca (saque automático); a corrida e o fôlego valem na volta.
- **Rede na parede:** `NET_H = 1,7 m` (`scene.ts`): risco desenhado em 1,70 m e bola que bate abaixo dele = "Na rede"; os alvos de lançamento ficam entre 1,9 e 2,7 m (parede tem 3 m). Velocidade de bola baixa demais para passar da rede sobe sozinha até conseguir.
- **Galeria:** botão 🎬 Golpes → `viewStroke/viewStep/viewPause/viewSpeed/viewSeek/viewClose` interrompem o rali, põem a câmera de frente e repetem o clipe; ao sair a câmera volta.
- **Limites:** profundidade inferida (avanço de braço/perna em direção à câmera é aproximado); sem mãos/pulso (face da raquete assistida no contato); passos rápidos suavizados; clipes no lugar.
- **Referência de jogo:** `docs/GUIA_ATAQUES_E_DEFESAS.md` (bola viva, 8 ataques e defesas) e `docs/OBJETIVO_PARTIDA.md`.

## Rebater no tempo e na posição certa (`game.ts`, `cuemark.ts`)
- **Problema:** o golpe automático "sincronizado" começava sozinho e a bola era empurrada para a raquete; não havia o que o jogador fazer, e o contato falhava (gap grande) sem explicação.
- **Aviso (`Cue`):** a cada quadro, `predict()` (passo 1/120 s, igual ao da física real) gera as amostras da bola; `evalSample()` avalia cada golpe candidato: ponto onde ficar = ponto da bola − deslocamento de contato do clipe (`contactLocal`), tempo de preparo `PREP` por tipo (fundo 0,55 / voleio 0,4 / smash 0,7 s), erro de altura `dy` (≤ 0,2 m) e velocidade de corrida exigida (`need` = (distância − raio de posição) ÷ (tempo − preso no golpe − preparo − 0,1 s)). Custo = conforto (corrida, tipo de golpe, profundidade, `dy`). O marcador **persiste** (histerese) enquanto o mesmo golpe/chegada ainda for alcançável e, se nada for, mostra o mais próximo em vermelho.
- **Aperto (`manualSwing`):** `err = tempo até a bola − preparo` (>0 cedo). O clipe é escalado por `s = (contato − início) ÷ tempo até a bola` ∈ [0,62; 1,9] e o contato cai exatamente na chegada da bola; a jogadora desliza ao ponto se estiver dentro do raio (`assist` 0,55 m; ×1,6 no modo fácil). Qualidade: |err|/janela ≤ 0,07 s Perfeito, ≤ 0,16 s Bom; senão golpe fraco.
- **Bola viva, sem quique (regra do beach tênis; pedido do autor):** o 1º toque da bola na areia encerra o ponto ("Quicou na areia"; "Bola curta" se cai antes da parede). `predict(…, live=true)` para a trajetória nesse toque e `evalSample()` só aceita amostras no ar (`bounces = 0`); a areia só quica a bola depois do ponto (a bola ainda rola, `eSand = 0,5`). A bola sempre passa acima da rede (1,70 m) na parede.
- **Devolução planejada (`launch` → `planReturn`):** a parede não reflete a bola (com 11 m de distância e a bola caindo, a reflexão física nunca chega no ar). 1ª perna: raquete → parede (alturas 1,9–2,7 m, velocidades e lados sorteados, sem tocar a areia). 2ª perna: sorteia o golpe do vídeo (`pickIntent`, 13 golpes, sem repetir os 2 últimos), onde a jogadora ficará (a corrida que ela aguenta: `need` ≤ 1,7 m/s × fôlego, 2,3 e 2,7 nos níveis seguintes; ~1,2 m por golpe) e o ponto de contato desse clipe (`contactLocal`, altura própria de cada golpe). `solveShot()` calcula, com arrasto, a velocidade com que a bola sai da parede (`Ball.ret`) para passar por esse ponto em Tr = 0,8–1,15 s (golpes por cima 1,0–1,4 s; mais tempo quando a jogadora está longe da parede), apogeu ≤ 4,3 m. O plano é conferido pelo mesmo `evalSample()` do aviso. Ritmo medido: ~1,6–1,9 s entre os golpes, nenhuma bola sem plano em 1.500 posições da quadra, ~1 ms por bola. Impacto na parede com anel/clarão (`wallfx.ts`). Poeira de areia (`dust.ts`) a cada passada de corrida (> 1,6 m/s, gancho `Footprints.onPlant`) e na freada do golpe.
- **Bugs que enganavam os testes:** (1) um golpe ainda desvanecendo quando outro começava ficava com o peso congelado na mistura e deslocava a raquete até 30 cm do contato (golpes "certos" erravam) — agora os golpes antigos saem em 0,2 s; (2) o tempo de corrida tinha piso de 0,25 s (devoluções impossíveis pareciam alcançáveis); (3) a escolha mantida do aviso derivava 0,1 s por quadro.
- **Medido com bots (SwiftShader, Chromium):** bot que aperta no tempo exato e anda até o anel, com ±120 ms de erro e 15 cm de folga de posição: 16/16 saques chegam a 27–35 ralis (limite do teste: 60 s), 122/122 contatos acertam; ±200 ms: 129/134; ±400 ms ou sempre 250 ms atrasado: quase nunca acerta (esperado); só correndo ou só apertando sem se mover: 0–1 rali.
- **Riscos:** (a) **latência de toque** em celular real (~50–100 ms) soma ao erro humano: janelas largas (`timing` nos Ajustes) e modo fácil existem por isso; (b) o brilho/aviso depende de ver o anel: em tela pequena com o polegar em cima do botão, o anel do chão é o aviso principal; (c) quedas de quadro mudam o `dt` (limitado a 50 ms) e deslocam o contato: mantém-se o passo fixo 1/120 na bola.

## Próximos passos sugeridos (ordem)
1. **Cena base**: quadra 16×8 m (areia), rede a ~1,70 m (confirmar medidas oficiais), câmera, 1 jogadora (esta GLB) + locomoção/idle do pacote Mixamo (converter com o mesmo script `bpy`, copiando o padrão do `convert_characters.py` do Kage).
2. **Física da bola** com passo fixo (voo com arrasto; **bola viva**: sem quique durante o rali, a areia só quica a bola depois do ponto).
3. **Sincronia golpe↔bola**: disparar o clipe de modo que `contact_frame/30` coincida com a chegada da bola ao raio da raquete; escolher forehand/backhand/voleio/smash pela posição relativa e altura; janela de tolerância.
4. **Raquete** presa a `mixamorig:RightHand` (modelo próprio ou CC0), bola, sombras, poeira de areia, perfis de qualidade para celular.
5. **IA do bot** (posicionamento, escolha de golpe, erro) e 2×2.
6. PWA offline (reaproveitar `scripts/sw.template.js` + plugin `kage-offline` do Kage); orçamento: GLB ≤ 5 MB por jogador, meshopt via `scripts/optimize_models.mjs`.
7. Só depois: online (padrão do Rami-kami, Cloudflare).
8. Gravar saque por baixo/voleio de rede de beach tênis em vídeo → GVHMR no Colab → `retarget.py`.

## Riscos
- Desempenho no celular (8 GB RAM do PC dele; teste em aparelho real, principalmente iPhone/Safari). Limitar malha (~15 mil triângulos), 1 textura 1024.
- Realismo vs. teto do Three.js no navegador móvel.
- Latência/ordem de eventos se um dia for online com física de bola.
- Licença CC BY-SA 3.0 dos dados de movimento: manter atribuição aos autores (Pulgarin-Giraldo et al., Universidad Autónoma de Occidente / U. Nacional de Colombia / U. de Caldas).

## Como reproduzir
```
pip install bpy numpy scipy pillow          # Python 3.11+ (bpy 5.x exige a versão do wheel; no Windows usar a do Kage: bpy==5.0.1 / py3.11)
git clone https://github.com/jdpulgarin/Tennis-MoCap.git
python -I scripts/segment.py  Tennis-MoCap/data  scripts/cands.json
python -I scripts/select.py   scripts/cands.json scripts/selected.json
python -I scripts/retarget.py -- "JAQUELINE+OK PRONTA.fbx" Tennis-MoCap/data scripts/selected.json out
python -I scripts/export_glb.py -- out/retarget.blend jaqueline_tenis.glb
```
Obs.: `segment.py` lê `labels.csv` na pasta pai de `data/`.
