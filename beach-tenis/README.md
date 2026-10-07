# Beach Tênis — treino contra a parede (protótipo)

PWA 3D (Vite + TypeScript + Three.js) para **ajustar os movimentos** do jogo de beach tênis: a jogadora (Jaqueline, rig Mixamo) rebate a bola contra a parede com 12 golpes de mocap de tênis.

## Jogar
- Celular: abra o link do GitHub Pages. Na 1ª visita o jogo baixa tudo para funcionar **offline** (progresso no canto da tela e em ⚙; "✓ Pronto offline" ao terminar). O botão **⬇ Instalar app** (canto superior esquerdo) aparece quando o navegador permite instalar; no iPhone: Compartilhar → Adicionar à Tela de Início.
- Controles: joystick virtual (arraste na metade esquerda) ou WASD/setas; **GOLPE** (ou Espaço) no tempo certo; **SACAR** (ou Enter).
- **Câmera 360° e zoom:** arraste o dedo (ou o mouse) fora do joystick para girar em volta da Jaqueline; pinça (ou roda do mouse, ou ＋/－) para aproximar/afastar; ⟲ recentraliza. Teclado: Q/E giram, +/− zoom, R recentraliza. O joystick anda relativo à câmera.
- **Golpes do vídeo:** o botão **🎬 Golpes** (ou ⚙ → "Golpes do vídeo") abre a galeria: a Jaqueline repete o golpe de frente, com anterior/próximo, pausa, câmera lenta (½×/¼×) e linha do tempo; arraste para girar e use ＋/－ para o zoom. No treino, **todos** os golpes do vídeo entram em jogo conforme a bola (altura, lado, urgência) — inclusive no modo automático — e o nome do golpe aparece na tela.
- **Saque:** começa com o saque da jogadora (ela lança a bola e saca com o movimento do vídeo); depois a bola vai para a parede.
- **Fôlego (stamina):** a barra "Fôlego" (canto superior esquerdo) gasta com a corrida e com cada golpe (golpes por cima gastam mais) e recupera entre os pontos; com pouco fôlego a Jaqueline corre mais devagar (até 55%) e o treino manda bolas mais perto. Liga/desliga em ⚙.
- **Rede:** o risco azul da parede está em 1,70 m (altura da rede de beach tênis); a bola precisa bater na parede acima dele.
- **Rebater:** o jogo mostra *onde* ficar (anel no chão) e *quando* apertar GOLPE (anel que fecha; verde = agora). Fora do ponto ou do tempo o golpe falha ("Longe!", "Cedo!", "Tarde!"). Detalhes abaixo.
- ⚙ abre o painel de ajustes: modo fácil (o jogo aperta na hora), raio de posição, janela de tempo, sincronia do contato (±frames), raio de acerto da bola, velocidade/quique da bola, escala da jogadora e posição/rotação da raquete na mão. Os valores ficam salvos no aparelho. "Copiar log" exporta o registro de golpes (gap mão×bola em cm).

## Publicar (uma vez)
1. GitHub → **Settings → Pages → Source: GitHub Actions**.
2. Rode a ação **"Beach Tênis - publicar"** (aba Actions → Run workflow) ou faça push em `main`.
3. Endereço: `https://<usuario>.github.io/<repositorio>/`.

## Atualização automática
- Push em `main` (alterando `beach-tenis/**`) → build + publicação.
- Push em branch `claude/**` → build; se passar, **merge automático em `main`** e publicação.
- No celular, ao abrir (ou voltar ao app) ele baixa a nova versão em segundo plano e mostra **"Nova versão disponível — Atualizar"**. A troca só acontece quando você toca o botão (nunca no meio do rali).
- Mudanças em `.github/workflows/` precisam ir direto em `main` (o merge automático não tem permissão para alterá-los).

## Desenvolvimento
```
cd beach-tenis
npm ci
npm run dev        # http://localhost:5173
npm run build      # gera dist/ + sw.js + version.json
```
Areia: texturas PBR em `public/textures/` (Poly Haven "aerial_beach_01", CC0); se faltarem, usa a procedural.

## Pipeline de animação (`tools/`)
`segment.py → select.py → retarget.py` (BVH do Tennis-MoCap → ossos Mixamo) → `add_loco.py` (idle/corrida Mixamo, in-place) → `inplace.py` → `export_glb.py`; `make_assets.py` converte raquete (FBX) e bola (GLB). Golpes do vídeo do autor: `tools/video/` (pose 3D por vídeo → clipes da Jaqueline; ver o README da pasta). Detalhes e limitações em `docs/CONTEXTO_BEACH_TENIS.md`.

## Como funciona o rebater (tempo + posição)
A cada quadro o jogo simula a trajetória da bola (mesma física, passo de 1/120 s) e escolhe a **próxima rebatida confortável**: depois do 1º quique, na altura do golpe, num ponto que dê para alcançar correndo. Ela vira um aviso:
- **Onde:** anel no chão (o ponto onde a jogadora deve estar). Vermelho = ainda longe; só vale quando ela está dentro do **raio de posição** (Ajustes).
- **Quando:** um anel que encolhe até fechar no do chão e em volta do botão GOLPE; **verde = apertar agora**. A bola ganha um brilho da mesma cor. Amarelo = quase, laranja = passou.
- **Resultado:** se o aperto cai dentro do raio, a jogadora desliza até o ponto e o clipe de golpe é acelerado/retardado (0,62×–1,9×) para o contato cair na bola. O erro de tempo só define a qualidade: ±70 ms **Perfeito** (bola mais rápida e precisa), ±160 ms **Bom**, além disso **Cedo!/Tarde!** (bola fraca); fora da faixa de velocidade do clipe o golpe passa em branco. Longe do ponto: **Longe!**.
- A devolução da parede é escolhida (altura, lado, velocidade) para ser sempre rebatível a partir de onde a jogadora acabou de bater; ela fica presa no fim do golpe por ~0,4 s.
- **Modo fácil** (Ajustes): o jogo aperta na hora certa; só é preciso correr até o anel.
O painel mostra o `gap` mão×bola no contato.

## Créditos e licenças
- Movimentos: **Tennis-MoCap** — Pulgarin-Giraldo et al., LNCS 10125, 2017 (CC BY-SA 3.0). Derivados (os clipes deste projeto) seguem CC BY-SA 3.0.
- Locomoção: Mixamo (Adobe). Raquete: modelo do autor. Bola: pacote "realistic tennis ball pack" — **confirme a licença do autor original** antes de distribuir.
