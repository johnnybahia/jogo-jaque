# Objetivo: partida contra adversária com um botão por golpe

Anotado a pedido do autor (a partir do vídeo `movimentos.mp4`, 14 golpes reais de beach tênis).

## Ideia (palavras do autor, organizadas)
- Manter o que já funciona: **anel de posição no chão** (onde ficar) e **sinal verde** (hora certa de bater).
- **Um botão para cada golpe do vídeo**: forehand, backhand (dinâmico/estático), bandeja (forehand/backhand), smash, gancho, rainbow/ventaglio, verônica, espeto, arco inferior/leque, anômalo, saque.
- Há uma **jogadora adversária** que rebate de volta. A cada bola que chega, o jogo **indica qual golpe deve ser feito** (qual botão apertar), **onde ficar** e **quando bater** (verde).
- **Força**: uma barra; quanto mais forte o aperto, mais forte a jogada.
- **Ponto**: sai quando um dos lados não faz o golpe correto de retorno, ou bate forte demais e a bola **sai da quadra**.
- Uma **seta** mostra a direção da bola na quadra adversária.

## Como vai funcionar (proposta, a confirmar)
1. **Quadra de partida:** rede a 1,70 m, linhas, limites, bola viva (sem quique), placar (modo "Treino na parede" continua).
2. **Adversária:** 2ª instância da Jaqueline com IA (anda até a bola, escolhe o golpe, mira, erra com probabilidade por nível).
3. **Golpe pedido:** a situação da bola (altura, velocidade, lado, profundidade) define o golpe correto (tabela situação → golpe); o botão pedido pisca; golpe errado = jogada errada.
4. **Força e mira:** segurar o botão enche a barra (celular não mede pressão); o direcional mira; a seta/trajetória na quadra adversária mostra onde a bola cai com a força atual e fica vermelha se sair; soltar no verde.
5. **Ponto:** rede, fora, bola na areia (quicou), golpe errado/atrasado/longe do ponto, ou a adversária falhando.
6. **Animações:** vêm do vídeo (pose 3D → esqueleto da Jaqueline), com porta de aprovação da qualidade antes de integrar.

## Estado (atualizado)
- **Pronto:** golpes do vídeo na Jaqueline (base de trabalho: não precisam ficar idênticos ao vídeo, decisão do autor); câmera 360° + zoom; fôlego; bola viva; **partida contra a adversária** (quadra, rede 1,70 m, IA com 3 níveis, placar oficial, saque alternado, "Deixa passar!"); capa com logo e ranking local.
- **Falta:** um botão por golpe + "golpe pedido" (hoje um botão GOLPE e o jogo escolhe o golpe pela bola); barra de força (segurar = mais forte, demais = fora) e seta de direção; ranking em servidor; ajuste fino de dificuldade com a esposa jogando.

## Estado (histórico)
- Vídeo segmentado em 14 golpes (cortes de câmera: 4,53 / 8,87 / 13,63 / 17,97 / 22,07 / 26,47 / 31,33 / 35,37 / 39,37 / 43,63 / 48,30 / 52,03 / 55,63 s) e pose 3D extraída (MediaPipe, 1799/1800 quadros; mão da raquete = direita).
- Falta: retarget para a Jaqueline, quadra/adversária, botões, força, seta, regras.

## Pedidos adicionais do autor (anotados)
- Nome do jogo: **Jaque Beach Tennis — Play Match**; a jogadora se chama **Jaqueline**. É um presente para a esposa: qualidade e carinho acima de tudo.
- **Capa inicial** (título + logo), **ranking de vitórias** (local primeiro; servidor no web app depois).
- **Câmera 360°** (girar quando quiser) e **zoom** para escolher a distância de jogo.
- **Placar de beach tênis** (regras oficiais: 15/30/40, ponto decisivo no 40-40, saque único, set de 6 games com tie-break).
- Força/mira/seta/botões: seguir a convenção dos jogos de tênis (segurar para carregar, soltar no verde; segurar demais manda para fora).
- Ordem pedida: **1) movimentos do vídeo na Jaqueline**, depois câmera/zoom, partida, capa/logo/ranking.
- **Referência obrigatória:** `docs/GUIA_ATAQUES_E_DEFESAS.md` (guia tático enviado pelo autor): bola viva (sem quique na areia; **já vale no treino na parede**: o 1º toque na areia encerra o ponto), 8 ataques e a defesa recomendada para cada um. O jogo e os movimentos seguem esse guia.
- **Stamina dos jogadores** (pedido do autor): quanto mais um jogador é obrigado a correr na própria quadra, mais stamina gasta; quando acaba, ele fica **mais lento**, o que ajuda o outro lado a fazer pontos (estratégia: colocar a bola longe para cansar a adversária). Vale para a Jaqueline e para a adversária (IA). Proposta: barra de stamina no HUD; gasto proporcional à distância corrida (mais ao arrancar/correr em velocidade máxima); recuperação lenta parado e parcial entre pontos/games; com a barra vazia a velocidade máxima cai (~60%) e o tempo de reação/alcance diminui; níveis da IA mudam o consumo. Entra junto com a partida (tarefas #37/#38).
- **Variedade de golpes** (pedido do autor): no jogo o personagem deve usar os golpes do vídeo conforme a situação da bola (altura, lado, urgência), inclusive no modo automático — não só forehand/backhand.
- **Atualizações contínuas:** cada melhoria é enviada ao git assim que fica pronta (o autor tem tempo limitado de sessão e acompanha pelo jogo publicado).
