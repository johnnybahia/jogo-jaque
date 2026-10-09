import type { Game } from "./game";
import type { ScoreView } from "./match";
import { S } from "./settings";
import { CAMS, CAM_COUNT, CAM_NAMES } from "./camera";
import { initCamEdit } from "./camedit";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const RANK_KEY = "bt.ranking.v1", PREF_KEY = "bt.matchpref.v1";
const LEVELS = ["facil", "medio", "dificil"] as const, LEVEL_TXT: Record<string, string> = { facil: "Fácil", medio: "Médio", dificil: "Difícil" };
const FMT_TXT: Record<string, string> = { rapida: "Rápida", set: "1 set", melhor3: "Melhor de 3" };

interface Rec { t: number; lvl: string; fmt: string; won: boolean; score: string; d?: boolean; f?: boolean; }
interface Rank { wins: Record<string, number>; losses: Record<string, number>; last: Rec[]; }
const emptyRank = (): Rank => ({ wins: { facil: 0, medio: 0, dificil: 0, d_facil: 0, d_medio: 0, d_dificil: 0, f_facil: 0, f_medio: 0, f_dificil: 0 }, losses: { facil: 0, medio: 0, dificil: 0, d_facil: 0, d_medio: 0, d_dificil: 0, f_facil: 0, f_medio: 0, f_dificil: 0 }, last: [] });   // d_*: duplas; f_*: frescobol

function loadRank(): Rank { try { const r = JSON.parse(localStorage.getItem(RANK_KEY) || "null"); if (r?.wins && r?.losses) return { ...emptyRank(), ...r }; } catch { /* sem storage */ } return emptyRank(); }
function saveRank(r: Rank): void { try { localStorage.setItem(RANK_KEY, JSON.stringify(r)); } catch { /* ignora */ } }
function loadPref(): { fmt: string; lvl: string; mode: string } { try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || "null"); if (p?.fmt && p?.lvl) return { mode: "single", ...p }; } catch { /* sem storage */ } return { fmt: "rapida", lvl: "facil", mode: "single" }; }

/** guarda o resultado da partida no ranking local */
function recordResult(v: ScoreView, won: boolean): void {
  const r = loadRank(), k = (v.fresco ? "f_" : v.doubles ? "d_" : "") + v.levelId; (won ? r.wins : r.losses)[k] = ((won ? r.wins : r.losses)[k] ?? 0) + 1;
  r.last.unshift({ t: Date.now(), lvl: v.levelId, fmt: v.fmtId, won, score: v.history || "—", d: v.doubles, f: v.fresco }); r.last = r.last.slice(0, 8); saveRank(r);
}

/** capa, menu de partida, placar no topo, cartão de fim de partida e ranking local */
export function initMenu(game: Game, openGallery: () => void): void {
  const cover = $("cover"), fmtSel = $("cvFmt") as HTMLSelectElement, lvlSel = $("cvLvl") as HTMLSelectElement, modeSel = $("cvMode") as HTMLSelectElement, hint = $("cvHint"), rankBox = $("cvRankBox"), score = $("score"), card = $("endCard");
  const pref = loadPref(); fmtSel.value = pref.fmt; lvlSel.value = pref.lvl; modeSel.value = pref.mode === "duplas" ? "duplas" : "single";
  const syncMode = (): void => { hint.hidden = modeSel.value !== "duplas"; }; modeSel.onchange = syncMode; syncMode();
  const camBox = $("cvCams");
  /** as 3 câmeras na capa: a escolhida fica laranja; ✎ = posição editada por você */
  const renderCams = (): void => {
    camBox.textContent = "";
    for (let i = 0; i < CAM_COUNT; i++) {
      const b = document.createElement("button"); b.className = i === CAMS.sel ? "on" : ""; b.innerHTML = `<b>${i + 1}</b>${CAM_NAMES[i]}${CAMS.isCustom(i) ? " ✎" : ""}`;
      b.onclick = () => { CAMS.select(i); game.applyCam(); renderCams(); };
      camBox.appendChild(b);
    }
  };
  const open = (): void => { game.coverOn(true); cover.hidden = false; document.body.classList.add("menu"); document.body.classList.remove("ended"); card.hidden = true; renderRank(); renderCams(); };
  const camEdit = initCamEdit(game, () => open());
  $("cvCamEdit").onclick = () => { game.coverOn(false); cover.hidden = true; document.body.classList.remove("menu"); camEdit.open(); };
  const close = (): void => { game.coverOn(false); cover.hidden = true; document.body.classList.remove("menu"); rankBox.hidden = true; };
  const renderRank = (): void => {
    const r = loadRank(), tab = (p: string) => LEVELS.map((l) => `<tr><td class="l">${LEVEL_TXT[l]}</td><td>${r.wins[p + l] ?? 0}</td><td>${r.losses[p + l] ?? 0}</td></tr>`).join("");
    const hasD = LEVELS.some((l) => (r.wins["d_" + l] ?? 0) + (r.losses["d_" + l] ?? 0) > 0), hasF = LEVELS.some((l) => (r.wins["f_" + l] ?? 0) + (r.losses["f_" + l] ?? 0) > 0);
    const last = r.last.map((x) => `<tr><td class="l">${x.won ? "🏆" : "·"} ${x.f ? "Frescobol " : x.d ? "Duplas " : ""}${LEVEL_TXT[x.lvl] ?? x.lvl}</td><td>${FMT_TXT[x.fmt] ?? x.fmt}</td><td>${x.score}</td></tr>`).join("");
    rankBox.innerHTML = `<table><tr><th class="l">Single</th><th>Vitórias</th><th>Derrotas</th></tr>${tab("")}</table>${hasD ? `<table><tr><th class="l">Duplas</th><th>Vitórias</th><th>Derrotas</th></tr>${tab("d_")}</table>` : ""}${hasF ? `<table><tr><th class="l">Frescobol</th><th>Vitórias</th><th>Derrotas</th></tr>${tab("f_")}</table>` : ""}${last ? `<h3>Últimas partidas</h3><table>${last}</table>` : "<h3>Ainda sem partidas</h3>"}`;
  };

  $("cvMatch").onclick = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ fmt: fmtSel.value, lvl: lvlSel.value, mode: modeSel.value })); } catch { /* sem storage */ } close(); game.startMatch(fmtSel.value, lvlSel.value, modeSel.value === "duplas" ? "duplas" : "single"); };
  $("cvFresco").onclick = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ fmt: fmtSel.value, lvl: lvlSel.value, mode: modeSel.value })); } catch { /* sem storage */ } close(); game.startMatch(fmtSel.value, lvlSel.value, "frescobol"); };   // usa o formato e o nível escolhidos; o "Modo" (single/duplas) não vale aqui
  $("cvTrain").onclick = () => { close(); game.setMode("train"); if (S.autoServe) game.serve(); };
  $("cvMoves").onclick = () => { close(); game.setMode("train"); openGallery(); };
  $("cvRank").onclick = () => { renderRank(); rankBox.hidden = !rankBox.hidden; };
  $("menuBtn").onclick = () => {
    const m = game.match; if (m && m.over === null && (m.score.points[0] + m.score.points[1] + m.score.games[0] + m.score.games[1] > 0) && !confirm("Sair da partida? O placar atual será perdido.")) return;
    if (game.mode === "match") game.endMatch(); open();
  };

  // placar: nomes, saque (●), games (e sets), pontos do game; no 40–40 o ponto seguinte decide
  const staOpp = document.createElement("div"); staOpp.className = "sc-sta"; staOpp.innerHTML = "<i></i>";
  let prevSc = "";
  game.onScore = (v) => {
    document.body.classList.toggle("match", !!v); score.hidden = !v; if (!v) { prevSc = ""; return; }
    const now = [0, 1].map((i) => `${v.sets[i]}/${v.games[i]}/${v.points[i]}`), was = prevSc ? prevSc.split("|") : now; prevSc = now.join("|");
    const row = (cls: string, name: string, side: 0 | 1) => `<div class="sc-row ${cls}${now[side] !== was[side] ? " pop" : ""}"><span class="sc-name">${name}</span><span class="sc-srv${v.server === side ? " on" : ""}"></span>${v.multi ? `<span class="sc-s">${v.sets[side]}</span>` : ""}<span class="sc-g">${v.games[side]}</span><span class="sc-p">${v.points[side]}</span></div>`;
    score.innerHTML = `${row("you", v.names[0], 0)}${row("opp", v.names[1], 1)}<div class="sc-foot ${v.decisive ? "dec" : ""}">${v.decisive ? "PONTO DECISIVO" : `${v.fresco ? "Frescobol · " : v.doubles ? "Duplas · " : ""}${FMT_TXT[v.fmtId] ?? v.fmt} · ${v.level}`}</div>`;
    score.appendChild(staOpp);
  };
  setInterval(() => { if (game.match && game.opp) { const f = game.aiBodies().filter((o) => o.dir === -1); (staOpp.firstElementChild as HTMLElement).style.width = `${Math.round(100 * f.reduce((a, o) => a + o.stamina.value, 0) / Math.max(1, f.length))}%`; } }, 250);

  game.onMatchEnd = (winner, v) => {
    recordResult(v, winner === 0);
    const won = winner === 0;
    card.innerHTML = `<h2>${won ? "Vitória!" : "Derrota"}</h2><p>${won ? (v.doubles ? "Parabéns, Jaqueline e Lari!" : "Parabéns, Jaqueline!") : "Quase! Tente de novo."}</p><p>${v.history || "—"}</p><small>${v.fresco ? "Frescobol · " : v.doubles ? "Duplas · " : ""}${v.fmt} · ${v.level}</small><div class="btns"><button class="main" id="ecAgain">Jogar de novo</button><button id="ecMenu">Menu</button></div>`;
    card.hidden = false; document.body.classList.add("ended");   // o cartão fica embaixo: quem venceu dança a dança inteira por cima
    $("ecAgain").onclick = () => { card.hidden = true; document.body.classList.remove("ended"); game.startMatch(v.fmtId, v.levelId, v.fresco ? "frescobol" : v.doubles ? "duplas" : "single"); };
    $("ecMenu").onclick = () => { card.hidden = true; document.body.classList.remove("ended"); game.endMatch(); open(); };
  };
  open();
}
