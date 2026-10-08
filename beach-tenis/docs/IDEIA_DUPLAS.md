# Duplas e Single — proposta (nada implementado; aguardando decisão do autor)

Base: `GUIA_DUPLAS_BEACH_TENNIS.md` (regras da dupla, enviado pelo autor) + pesquisa de jogos parecidos. Pedido do autor: opções **Duplas** e **Single**, 2 atletas de cada lado, "de um jeito que o usuário goste".

## 1. O que as regras mudam no jogo
| Regra / tática (guia) | Consequência no jogo |
|---|---|
| **1 toque por lado**, sem passe entre parceiras; sem quique | Não existe "passar para a parceira": o jogo todo é **quem pega cada bola** |
| Cada atleta cobre 8 × 8 m; o **meio** é a zona disputada | O meio é onde a IA mais erra/hesita → é o ponto estratégico do jogo |
| Bola do meio: prioridade de quem tem o **forehand voltado para o meio** (entre destras, a da esquerda) | Regra determinística de atribuição (e "Minha!") |
| "Corda invisível": 3–4 m entre as duas, fecham o meio, nunca as duas nas laterais, uma sobe e a outra cobre atrás | Controlador de **formação** da parceira |
| Fases: saque (parceira colada na rede, 1,5–2 m), recepção (2,5–3 m), lob (troca), guerra de rede | Estados da formação + gatilho "Troca!" |
| Saque único, livre atrás da linha, **let vale**, sacador escolhe quem recebe; saques em rodízio | Placar/rotação de sacadoras; a mira do saque escolhe a recebedora |
| Rede 1,70 m (feminino/misto) | Já é a nossa |
| **Single: 16 × 4,5 m** (ITF, Regra 1; Tennis Australia) | O nosso single usa 8 m de largura (a de duplas): fora da regra e cansativo → estreitar |

## 2. Jogos parecidos (relatos de wiki/review; não achei postmortem técnico — a inferência é minha)
- **Wii Sports Tennis**: o jogo cuida do deslocamento; há modo em que cada humano controla **os dois** do seu lado, e modo com parceira CPU. [StrategyWiki](https://strategywiki.org/wiki/Wii_Sports/Tennis)
- **Twin Tennis (Voodoo, celular)**: dupla em que você controla **os dois do seu lado**; 4,7★ com ~15 mil avaliações na loja. [App Store](https://apps.apple.com/app/id6446653673)
- **Beach Spikers (Sega, vôlei de praia 2×2)**: no arcade o controle vai para **quem está melhor posicionado** (GameSpot achou eficaz); no World Tour a parceira IA **evolui** (reação, força, saque, bloqueio); marcador na areia mostra onde a bola cai (como o nosso anel). [GameSpot](https://www.gamespot.com/reviews/beach-spikers-review/1900-2877546/) · [Giant Bomb](https://giantbomb.com/wiki/Games/Beach_Spikers)
- **Virtua Tennis**: parceira IA; as primeiras edições tinham comando para mandá-la à rede/ao fundo; review reclama que ela decide mal a troca de lado e que não há como sinalizar. [PlanetDC](https://planetdc.segaretro.org/games/reviews/virtuatennis/index.html) · [GamesRadar](https://gamesradar.com/virtua-tennis-2009-review/2)
- **AO Tennis (anti-exemplo)**: duplas apontadas como injogáveis, com uma parceira parada. [FutureFive](https://futurefive.com.au/story/ao-tennis-video-game-still-needs-fix-doubles-and-net-play-plus-other-things)
- **Mario Tennis Aces**: no modo de balanço o personagem se move sozinho até a bola; duplas contra CPU ou cooperativo. [Mario Wiki](https://www.mariowiki.com/Mario%20Tennis%20Aces)
- **Beach Tennis Pro (iOS)**: o único jogo de beach tênis que achei; não menciona duplas → espaço para diferenciar. [App Store](https://apps.apple.com/app/id534534097)

Padrões: (1) o jogo cuida do deslocamento e o jogador cuida do tempo; (2) quem controla a dupla inteira não depende da IA da parceira; (3) falhas clássicas: **parceira parada, parceira que rouba/hesita, parceira longe da rede, nenhum jeito de sinalizar**.

## 3. Controle (decisão 1)
- **A — Uma jogadora, parceira IA** (Virtua/Mario): mais "de verdade", mas você só pega ~metade das bolas e depende da IA da parceira.
- **B — Você controla a dupla, troca automática** (Wii Sports, Twin Tennis, Beach Spikers): a cada bola o jogo escolhe a atleta melhor posicionada e passa o controle a ela (anel e câmera vão junto); a outra segura a formação. Todo toque é seu; um polegar + GOLPE. **Recomendo B como padrão**, A como opção depois (A = B sem a troca automática).

## 4. Quem pega a bola (atribuição) — reaproveita o que já existe
Quando a bola sai da adversária: custo de cada atleta = corrida exigida (`evalSample`/`need`) + encaixe do golpe (`fitCost`, já feito: lado e altura da bola em relação ao corpo) + prioridade do meio (forehand voltado para o meio) + fôlego. Menor custo pega; **decisão fixada para essa bola** (sem trocar no ar, para não "piscar" o controle), a menos que a escolhida fique inalcançável. A outra não persegue a bola: segura a formação. Balão "Minha!" na que vai pegar; "Sua!/Deixa!" quando cede.

## 5. Formação da parceira (a parte que decide se a IA parece inteligente)
Alvo da que não pegou a bola: ~3,5 m ao lado da que pega, fechando o meio; profundidade por fase (saque: colada na rede; recepção: 2,5–3 m; quando a outra sobe, esta recua 1–2 m); lob por cima de quem está na rede → "Troca!" (cruzam). Velocidade limitada, nunca parada, nunca as duas nas laterais.

## 6. O que deixa divertido
- **"No buraco"**: mirar no meio entre as duas adversárias gera dúvida (nos níveis fáceis elas hesitam/colidem; nos difíceis aplicam a regra do forehand). Isso dá sentido à **seta de mira** (pendente) e à barra de força.
- Chamadas "Minha!/Sua!/Troca!/Fora!" em balões; comemoração de raquetes depois do ponto.
- Parceira com "entrosamento" que cresce partida a partida (ideia do Beach Spikers) e ranking de duplas.

## 7. Mudanças técnicas nesta base
`Opponent` → `Athlete` (corpo controlado por IA: já tem rig, estamina, golpe, reação, dança); `Match` passa de 1 adversária para `times[2][2]`; planejadores (`makePlan`/`aiShot`) recebem a atleta; `Score` ganha rodízio de sacadoras; `scene.buildMatchCourt` com largura de single (4,5 m) e de duplas (8 m); +3 clones do rig (`cloneInstance`); capa com **Modo: Single | Duplas**; placar com nomes das duplas; câmera "Alta" já serve; bots do teste jogam 4 em quadra.

## 8. Fases (cada uma sobe sozinha)
0. Seletor Single | Duplas na capa; **single com 4,5 m**.
1. 4 em quadra: parceira em formação + atribuição + troca automática + 2 adversárias IA; níveis recalibrados com bots.
2. Regras de duplas: 1 saque, let vale, rodízio de sacadoras/recebedora, placar de dupla.
3. Balões, "no buraco", comemoração, cores/personagens, entrosamento.

## 9. Riscos e casos extremos
- **IA da parceira** é onde jogos como este falham (parada, rouba, hesita). Mitigação: regra determinística + testes automáticos "ninguém fica parado, ninguém rouba, nenhuma bola cai entre as duas".
- **Equilíbrio**: duas adversárias cobrem muito mais quadra; os números do single não valem → recalibrar com bots (já temos a ferramenta).
- **Desempenho**: 4 personagens animados em celular modesto; medir cedo (atualizar IA a 30 Hz, sombra simples, pixel ratio).
- **Visual**: 4 clones idênticas; diferenciar por cor de camiseta/viseira por dupla (checar se a malha tem material separado) ou receber outros personagens.
- **Controle que "pula"** entre atletas confunde: anel e câmera acompanham suave e a decisão é fixada por bola.
- **Misto** (homem saca por baixo, rede 1,70) exigiria clipe novo; fora do escopo agora.

## 10. Decisões pendentes
1. Controle padrão: **B** (recomendado) ou **A**?
2. Estreitar o single para 4,5 m (oficial)?
3. Parceira/adversárias: mesma Jaqueline com cores por dupla, ou você manda outros personagens do Mixamo?
4. Ordem das fases está boa?
