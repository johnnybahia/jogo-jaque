import type { Game } from "./game";
import type { ScoreView } from "./match";
import { S } from "./settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const RANK_KEY = "bt.ranking.v1", PREF_KEY = "bt.matchpref.v1";
const LEVELS = ["facil", "medio", "dificil"] as const, LEVEL_TXT: Record<string, string> = { facil: "Fácil", medio: "Médio", dificil: "Difícil" };
const FMT_TXT: Record<string, string> = { rapida: "Rápida", set: "1 set", melhor3: "Melhor de 3" };

interface Rec { t: number; lvl: string; fmt: string; won: boolean; score: string; }
interface Rank { wins: Record<string, number>; losses: Record<string, number>; last: Rec[]; }
const emptyRank = (): Rank => ({ wins: { facil: 0, medio: 0, dificil: 0 }, losses: { facil: 0, medio: 0, dificil: 0 }, last: [] });

function loadRank(): Rank { try { const r = JSON.parse(localStorage.getItem(RANK_KEY) || "null"); if (r?.wins && r?.losses) return { ...emptyRank(), ...r }; } catch { /* sem storage */ } return emptyRank(); }
function saveRank(r: Rank): void { try { localStorage.setItem(RANK_KEY, JSON.stringify(r)); } catch { /* ignora */ } }
function loadPref(): { fmt: string; lvl: string } { try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || "null"); if (p?.fmt && p?.lvl) return p; } catch { /* sem storage */ } return { fmt: "rapida", lvl: "facil" }; }

/** guarda o resultado da partida no ranking local */
function recordResult(v: ScoreView, won: boolean): void {
  const r = loadRank(); (won ? r.wins : r.losses)[v.levelId] = ((won ? r.wins : r.losses)[v.levelId] ?? 0) + 1;
  r.last.unshift({ t: Date.now(), lvl: v.levelId, fmt: v.fmtId, won, score: v.history || "—" }); r.last = r.last.slice(0, 8); saveRank(r);
}

/** capa, menu de partida, placar no topo, cartão de fim de partida e ranking local */
export function initMenu(game: Game, openGallery: () => void): void {
  const cover = $("cover"), fmtSel = $("cvFmt") as HTMLSelectElement, lvlSel = $("cvLvl") as HTMLSelectElement, rankBox = $("cvRankBox"), score = $("score"), card = $("endCard");
  const pref = loadPref(); fmtSel.value = pref.fmt; lvlSel.value = pref.lvl;
  const open = (): void => { cover.hidden = false; document.body.classList.add("menu"); document.body.classList.remove("ended"); card.hidden = true; renderRank(); };
  const close = (): void => { cover.hidden = true; document.body.classList.remove("menu"); rankBox.hidden = true; };
  const renderRank = (): void => {
    const r = loadRank(), tr = LEVELS.map((l) => `<tr><td class="l">${LEVEL_TXT[l]}</td><td>${r.wins[l] ?? 0}</td><td>${r.losses[l] ?? 0}</td></tr>`).join("");
    const last = r.last.map((x) => `<tr><td class="l">${x.won ? "🏆" : "·"} ${LEVEL_TXT[x.lvl] ?? x.lvl}</td><td>${FMT_TXT[x.fmt] ?? x.fmt}</td><td>${x.score}</td></tr>`).join("");
    rankBox.innerHTML = `<table><tr><th class="l">Nível</th><th>Vitórias</th><th>Derrotas</th></tr>${tr}</table>${last ? `<h3>Últimas partidas</h3><table>${last}</table>` : "<h3>Ainda sem partidas</h3>"}`;
  };

  $("cvMatch").onclick = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ fmt: fmtSel.value, lvl: lvlSel.value })); } catch { /* sem storage */ } close(); game.startMatch(fmtSel.value, lvlSel.value); };
  $("cvTrain").onclick = () => { close(); game.setMode("train"); if (S.autoServe) game.serve(); };
  $("cvMoves").onclick = () => { close(); game.setMode("train"); openGallery(); };
  $("cvRank").onclick = () => { renderRank(); rankBox.hidden = !rankBox.hidden; };
  $("menuBtn").onclick = () => {
    const m = game.match; if (m && m.over === null && (m.score.points[0] + m.score.points[1] + m.score.games[0] + m.score.games[1] > 0) && !confirm("Sair da partida? O placar atual será perdido.")) return;
    if (game.mode === "match") game.endMatch(); open();
  };

  // placar: nomes, saque (●), games (e sets), pontos do game; no 40–40 o ponto seguinte decide
  const staOpp = document.createElement("div"); staOpp.className = "sc-sta"; staOpp.innerHTML = "<i></i>";
  game.onScore = (v) => {
    document.body.classList.toggle("match", !!v); score.hidden = !v; if (!v) return;
    const row = (cls: string, name: string, side: 0 | 1) => `<div class="sc-row ${cls}"><span class="sc-name">${name}</span><span class="sc-srv">${v.server === side ? "●" : ""}</span>${v.multi ? `<span class="sc-s">${v.sets[side]}</span>` : ""}<span class="sc-g">${v.games[side]}</span><span class="sc-p">${v.points[side]}</span></div>`;
    score.innerHTML = `${row("you", "Jaqueline", 0)}${row("opp", "Adversária", 1)}<div class="sc-foot ${v.decisive ? "dec" : ""}">${v.decisive ? "PONTO DECISIVO" : `${FMT_TXT[v.fmtId] ?? v.fmt} · ${v.level}`}</div>`;
    score.appendChild(staOpp);
  };
  setInterval(() => { if (game.match && game.opp) (staOpp.firstElementChild as HTMLElement).style.width = `${Math.round(game.opp.stamina.value * 100)}%`; }, 250);

  game.onMatchEnd = (winner, v) => {
    recordResult(v, winner === 0);
    const won = winner === 0;
    card.innerHTML = `<h2>${won ? "Vitória! 🏆" : "Derrota"}</h2><p>${won ? "Parabéns, Jaqueline!" : "Quase! Tente de novo."}</p><p>${v.history || "—"}</p><small>${v.fmt} · ${v.level}</small><div class="btns"><button class="main" id="ecAgain">Jogar de novo</button><button id="ecMenu">Menu</button></div>`;
    card.hidden = false; document.body.classList.add("ended");   // o cartão fica embaixo: quem venceu dança a dança inteira por cima
    $("ecAgain").onclick = () => { card.hidden = true; document.body.classList.remove("ended"); game.startMatch(v.fmtId, v.levelId); };
    $("ecMenu").onclick = () => { card.hidden = true; document.body.classList.remove("ended"); game.endMatch(); open(); };
  };
  open();
}
