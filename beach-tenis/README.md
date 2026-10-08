# Beach Tênis — treino contra a parede (protótipo)

PWA 3D (Vite + TypeScript + Three.js) para **ajustar os movimentos** do jogo de beach tênis: a jogadora (Jaqueline, rig Mixamo) rebate a bola contra a parede com 12 golpes de mocap de tênis.

## Jogar
- Celular: abra o link do GitHub Pages. Na 1ª visita o jogo baixa tudo para funcionar **offline** (progresso no canto da tela e em ⚙; "✓ Pronto offline" ao terminar). O botão **⬇ Instalar app** (canto superior esquerdo) aparece quando o navegador permite instalar; no iPhone: Compartilhar → Adicionar à Tela de Início.
- Controles: joystick virtual (arraste na metade esquerda) ou WASD/setas; **GOLPE** (ou Espaço) no tempo certo; **SACAR** (ou Enter).
- **Single e Duplas:** na capa, **Modo** Single (1 × 1) ou Duplas (2 × 2): você controla a Jaqueline, a parceira **Lari** (loira, camiseta coral) é IA no nível difícil e as adversárias **Bia** (rosa) e **Duda** (verde) jogam no nível escolhido. Nas duplas só um toque por lado: a bola é de quem a IA que bateu escolheu como alvo (se é da Lari, ela chama e você não tem aviso); a parceira segura a formação (fecha o meio, uma sobe e a outra cobre atrás); as quatro sacam em rodízio. Quem vence dança (nas duplas, as duas, uma dança cada).
- **Hora do dia, céu e mar:** a praia tem céu com sol e nuvens, mar com espuma na beira (à direita da câmera padrão), serras ao longe e luz por hora. Na partida a hora **avança com o placar**: começa de **manhã**, passa pela **tarde** e o último ponto (e a dança de quem vence) acontece no **pôr do sol**. Em ⚙ → *Hora do dia* dá para fixar Manhã, Tarde ou Pôr do sol. Em ⚙ → *Qualidade gráfica*: **Auto** (padrão: começa pelo que o aparelho aguenta e desce um degrau se o FPS cair; avisa quando muda), Alta, Média ou Baixa (a Baixa tira as nuvens e acalma as ondas).
- **Interface de transmissão:** placar com faixas de cor por dupla, bola que marca quem saca, números em destaque e pulso quando o ponto muda; rali em pílula (aparece quando há rali), fôlego em 10 segmentos (amarelo e vermelho quando cansa), botões de vidro com ícones. O resultado da batida (Perfeito! lima, Bom!, Cedo!/Tarde! laranja) aparece como texto sem caixa, com o nome do golpe embaixo, no canto de baixo ao lado dos botões — nada no meio da tela; só o aviso de ponto (laranja ou azul, ACE!/SMASH!) fica numa faixa pequena logo abaixo do placar. No celular em pé o placar fica no centro do topo e rali/fôlego descem para baixo dele. Na partida o canto mostra só o nome do último golpe; o erro em ms e a distância em cm aparecem no treino.
- **Capa viva:** a quadra ao entardecer aparece atrás do menu, com a câmera girando devagar; os controles ficam num painel de vidro (em celular deitado: título à esquerda, painel à direita).
- **Luz de cinema (Média e Alta):** sombras do sol (longas no entardecer), contorno de luz nas atletas; na **Alta** ainda brilho (bloom) no sol, na água e na bola e cor de cinema (sombras frias, luzes quentes, vinheta). A Baixa deixa tudo isso de fora para rodar leve.
- **Efeitos:** rastro e brilho na bola, anel + faíscas no contato (lima no tempo perfeito), risco no ar da raquete, areia que sobe onde a bola cai, confete quando a sua dupla pontua e uma chuva grande no fim da partida; destaques na tela: **ACE!**, **SMASH!** e **RALI DE n!**.
- **Quadra de praia de verdade:** linhas em fita azul com estacas, rede de pano que balança quando a bola bate nela, postes acolchoados, areia rastelada na quadra e molhada perto do mar, palmeiras ao vento e guarda-sóis na beira d'água (somem na qualidade Baixa).
- **3 câmeras salvas (Atrás, Alta, Perto):** na capa, escolha uma (a escolhida vale na partida e no treino) ou toque em **📷 Ajustar**: a quadra da partida aparece, você gira/aproxima (arrastar, pinça, ＋/－ ou os controles Giro, Altura e Distância) e **Salva** a posição na câmera escolhida; **↺ Padrão** volta à de fábrica; 👁 recolhe o painel para ver a tela inteira. As posições ficam no aparelho. Em jogo, **📷** (ou a tecla C) troca de câmera e ⟲ volta à posição da escolhida; girar e dar zoom no jogo é temporário.
- **Câmera 360° e zoom:** arraste o dedo (ou o mouse) fora do joystick para girar em volta da Jaqueline; pinça (ou roda do mouse, ou ＋/－) para aproximar/afastar; ⟲ recentraliza. Teclado: Q/E giram, +/− zoom, R recentraliza. O joystick anda relativo à câmera.
- **Golpes do vídeo:** o botão **🎬 Golpes** (ou ⚙ → "Golpes do vídeo") abre a galeria: a Jaqueline repete o golpe de frente, com anterior/próximo, pausa, câmera lenta (½×/¼×) e linha do tempo; arraste para girar e use ＋/－ para o zoom. No treino, **todos** os golpes do vídeo entram em jogo conforme a bola (altura, lado, urgência) — inclusive no modo automático — e o nome do golpe aparece na tela. **Quem vence a partida dança** (samba ou gangnam, sorteada, inteira, com a câmera em volta de quem dança). O golpe é o **certo para a bola**: forehand com a bola do lado da raquete, backhand do lado oposto, smash/gancho/verônica nas bolas altas (gancho se passou atrás da cabeça), arco e bandeja nas baixas; vale para a jogadora, a adversária e o treino (`src/fit.ts`).
- **Saque:** começa com o saque da jogadora (ela lança a bola e saca com o movimento do vídeo); depois a bola vai para a parede.
- **Fôlego (stamina):** a barra "Fôlego" (canto superior esquerdo) gasta com a corrida e com cada golpe (golpes por cima gastam mais) e recupera entre os pontos; com pouco fôlego a Jaqueline corre mais devagar (até 55%) e o treino manda bolas mais perto. Liga/desliga em ⚙.
- **Rede:** o risco azul da parede está em 1,70 m (altura da rede de beach tênis); a bola precisa bater na parede acima dele.
- **Partida contra a adversária** (capa → ▶ Partida): quadra de 16 × 8 m com rede de 1,70 m, a Jaqueline de um lado e uma adversária (IA) do outro, bola viva, placar de beach tênis (15/30/40, ponto decisivo no 40–40, saque único, sets de 6 games com tie-break; formatos Rápida 4 games, 1 set, melhor de 3) e três níveis (Fácil, Médio, Difícil). O ponto sai por rede, bola fora, bola na areia (quicou) ou erro da outra. Quando a bola vai cair fora, o aviso mostra "Fora! Deixa passar". Resultados ficam no ranking local (🏆).
- **Depois do ponto:** ela reage (suspira se erra logo; comemora em recorde) e volta andando à posição de saque antes de sacar de novo.
- **Bola viva (sem quique):** no beach tênis a bola é rebatida no ar. O primeiro toque na areia encerra o ponto.
- **Rebater:** o jogo mostra *onde* ficar (anel no chão) e *quando* apertar GOLPE (anel que fecha; verde = agora). Fora do ponto ou do tempo o golpe falha ("Longe!", "Cedo!", "Tarde!"). Detalhes abaixo.
- ⚙ abre o painel de ajustes: modo fácil (o jogo aperta na hora), raio de posição, janela de tempo, sincronia do contato (±frames), raio de acerto da bola, velocidade da bola, escala da jogadora e posição/rotação da raquete na mão. Os valores ficam salvos no aparelho. "Copiar log" exporta o registro de golpes (gap mão×bola em cm).

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
A cada quadro o jogo simula a trajetória da bola (mesma física, passo de 1/120 s) e escolhe a **próxima rebatida confortável**: **no ar** (a bola é viva, como no beach tênis de verdade: não pode quicar), na altura do golpe, num ponto que dê para alcançar correndo. Ela vira um aviso:
- **Onde:** anel no chão (o ponto onde a jogadora deve estar). Vermelho = ainda longe; só vale quando ela está dentro do **raio de posição** (Ajustes).
- **Quando:** um anel que encolhe até fechar no do chão e em volta do botão GOLPE; **verde = apertar agora**. A bola ganha um brilho da mesma cor. Amarelo = quase, laranja = passou.
- **Resultado:** se o aperto cai dentro do raio, a jogadora desliza até o ponto e o clipe de golpe é acelerado/retardado (0,62×–1,9×) para o contato cair na bola. O erro de tempo só define a qualidade: ±70 ms **Perfeito** (bola mais rápida e precisa), ±160 ms **Bom**, além disso **Cedo!/Tarde!** (bola fraca); fora da faixa de velocidade do clipe o golpe passa em branco. Longe do ponto: **Longe!**.
- **Bola viva:** a bola não pode quicar. Se tocar a areia, o ponto acaba ("Quicou na areia"). A parede devolve a bola em arco até o ponto de contato de um golpe sorteado (os 13 do vídeo, cada um na sua altura), a uma corrida que a jogadora aguenta (menor quando ela está sem fôlego); ela fica presa no fim do golpe por ~0,4 s.
- **Modo fácil** (Ajustes): o jogo aperta na hora certa; só é preciso correr até o anel.
O painel mostra o `gap` mão×bola no contato.

## Créditos e licenças
- Movimentos: **Tennis-MoCap** — Pulgarin-Giraldo et al., LNCS 10125, 2017 (CC BY-SA 3.0). Derivados (os clipes deste projeto) seguem CC BY-SA 3.0.
- Fontes: **Baloo 2** e **Nunito** (SIL Open Font License 1.1; subconjunto latino, auto-hospedadas em `src/fonts/` com as licenças). Ícones da interface: estilo **Feather** (MIT), desenhados em SVG inline.
- Locomoção: Mixamo (Adobe). Raquete: modelo do autor. Bola: pacote "realistic tennis ball pack" — **confirme a licença do autor original** antes de distribuir.
