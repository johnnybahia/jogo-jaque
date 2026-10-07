# Beach Tênis — treino contra a parede (protótipo)

PWA 3D (Vite + TypeScript + Three.js) para **ajustar os movimentos** do jogo de beach tênis: a jogadora (Jaqueline, rig Mixamo) rebate a bola contra a parede com 12 golpes de mocap de tênis.

## Jogar
- Celular: abra o link do GitHub Pages e use "Adicionar à tela inicial" (instala e funciona **offline**).
- Controles: joystick virtual (arraste na metade esquerda) ou WASD/setas; **GOLPE** (ou Espaço) para golpe manual; **SACAR** (ou Enter).
- ⚙ abre o painel de ajustes: sincronia do contato (±frames), raio de acerto, assistência de posição, velocidade/quique da bola, escala da jogadora e posição/rotação da raquete na mão. Os valores ficam salvos no aparelho. "Copiar log" exporta o registro de golpes (gap mão×bola em cm).

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
Textura de areia: coloque `public/textures/sand.jpg` (ladrilhável); se existir, substitui a procedural.

## Pipeline de animação (`tools/`)
`segment.py → select.py → retarget.py` (BVH do Tennis-MoCap → ossos Mixamo) → `add_loco.py` (idle/corrida Mixamo, in-place) → `inplace.py` → `export_glb.py`; `make_assets.py` converte raquete (FBX) e bola (GLB). Detalhes e limitações em `docs/CONTEXTO_BEACH_TENIS.md`.

## Como o jogo sincroniza o golpe
A cada quadro, a trajetória da bola é simulada (mesma física do jogo). Quando existe um ponto de interceptação alcançável, o clipe de golpe começa de modo que seu **frame de contato** (pico de velocidade da cabeça da raquete) coincida com a chegada da bola, ajustando a velocidade do clipe (0,85×–1,7×) e deslizando a jogadora até o ponto (limite = assistência). O painel mostra o `gap` mão×bola no contato.

## Créditos e licenças
- Movimentos: **Tennis-MoCap** — Pulgarin-Giraldo et al., LNCS 10125, 2017 (CC BY-SA 3.0). Derivados (os clipes deste projeto) seguem CC BY-SA 3.0.
- Locomoção: Mixamo (Adobe). Raquete: modelo do autor. Bola: pacote "realistic tennis ball pack" — **confirme a licença do autor original** antes de distribuir.
