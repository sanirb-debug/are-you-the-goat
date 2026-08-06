#!/usr/bin/env node
/*
 * FULL-GAME SOAK. Plays complete games the way a PLAYER does — random legal
 * choices across all three modes, half chaotic and half sensible — then asserts
 * invariants on everything the verdict screen would show.
 *
 *     node test-soak.js            # 1200 games, ~1.5s (the pre-commit gate)
 *     node test-soak.js 20000      # deeper run before a release
 *
 * WHY THIS EXISTS. The other suites are unit-shaped: they assert named
 * properties of named functions on hand-built fixtures. They were passing 615
 * checks while three real bugs were live, because none of them ever played a
 * whole game. This one found all three on its first run:
 *   - Salary Cap could serve the SAME REAL PLAYER to two slots (~1% of builds).
 *     getRosterOptions never filtered usedPickNames the way spinnablePlayers did.
 *   - encodeBuild dropped `chosenStat`, so 36% of Classic/Sandbox share links
 *     rebuilt a different player than the author saw.
 *   - decodeBuild truncated activeBadges to 2, silently dropping Classic's 3rd.
 *
 * It asserts no specific NUMBERS (that is test-tiers' job) — only that nothing
 * is impossible: no NaN, no tier above its peak band, no counting stat above the
 * seasons played, no box score outside its clamp, no build over the cap, no
 * duplicate player, and no throw anywhere in the verdict's text surfaces.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadGame() {
  const dir = __dirname;
  const src =
    fs.readFileSync(path.join(dir, "data.js"), "utf8") +
    '\n;globalThis.__DATA__ = module.exports; module.exports = {};\n' +
    fs.readFileSync(path.join(dir, "game.js"), "utf8") +
    '\n;globalThis.__GAME__ = module.exports;\n';
  const store = {};
  const ctx = {
    console,
    module: { exports: {} },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return Object.assign({}, ctx.__DATA__, ctx.__GAME__);
}

const G = loadGame();
const RUNS = Number(process.argv[2] || 1200);

let rs = 12345;
const rnd = () => (rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)];
const S = G.state;

const fails = [];
const note = (seed, mode, what, detail) => fails.push({ seed, mode, what, detail });

// deep scan for NaN / undefined / Infinity in any nested value
function scan(o, path, out) {
  if (o === null) return;                       // allDefensive/allNBA are legitimately null
  if (o === undefined) { out.push(path + "=undefined"); return; }
  if (typeof o === "number") { if (!Number.isFinite(o)) out.push(path + "=" + o); return; }
  if (typeof o === "string") { if (/undefined|NaN|null|\[object/.test(o)) out.push(path + '="' + o.slice(0, 70) + '"'); return; }
  if (Array.isArray(o)) { o.forEach((v, i) => scan(v, path + "[" + i + "]", out)); return; }
  if (typeof o === "object") { Object.keys(o).forEach(k => scan(o[k], path + "." + k, out)); }
}

function resetState(mode) {
  S.sandbox = mode === "sandbox";
  S.autoPick = mode === "classic";
  S.name = "Soak"; S.shadowTarget = G.SHADOW_ORDER[Math.floor(rnd() * G.SHADOW_ORDER.length)];
  S.height = null; S.athleticism = null; S.skills = {};
  S.budgetSpent = 0; S.pickOrder = []; S.activeBadges = [];
  S.teamRerollsUsed = 0; S.playerRerollsUsed = 0;
  S.position = null; S.positionFit = null; S.team = null; S.teamNeedMet = false;
  S.scoutTeam = null; S.editingCategory = null; S.sharedView = false;
}

function playOne(seed, mode, strat) {
  G.seedRng(seed);
  resetState(mode);
  const slots = ["height", "athleticism", ...G.SKILL_ORDER];

  for (const slot of slots) {
    const teams = G.availableTeams();
    if (!teams.length) { note(seed, mode, "availableTeams empty", slot); return null; }
    const team = pick(teams);
    S.scoutTeam = team;

    if (mode === "classic" || mode === "sandbox") {
      const players = G.spinnablePlayers(team);
      if (!players.length) { note(seed, mode, "spinnablePlayers empty", team.abbr + "/" + slot); return null; }
      const p = strat === "sensible"
        ? players.reduce((a, b) => (Object.values(b.skills).reduce((x,y)=>x+y,0) > Object.values(a.skills).reduce((x,y)=>x+y,0) ? b : a))
        : pick(players);
      const chosen = strat === "sensible" ? slot : pick(G.CATEGORIES);
      const built = G.buildStatPick(p, team, slot, chosen);
      if (slot === "height" || slot === "athleticism") G.lockPhysical(slot, built); else G.lockSkill(slot, built);
    } else {
      const opts = G.getRosterOptions(slot, team).filter(o => o.affordable);
      if (!opts.length) { note(seed, mode, "no affordable option", team.abbr + "/" + slot); return null; }
      const o = strat === "sensible" ? opts[Math.floor(rnd() * Math.min(3, opts.length))] : pick(opts);
      if (slot === "height" || slot === "athleticism") G.lockPhysical(slot, o); else G.lockSkill(slot, o);
    }
    S.pickOrder.push(slot);
  }

  // badges: pick up to the mode's cap
  const acq = G.acquiredBadges();
  const cap = mode === "sandbox" ? acq.length : mode === "classic" ? 3 : 2;
  S.activeBadges = acq.slice(0, cap).map(b => b.key);

  // position + team
  const positions = Object.keys(G.POSITIONS);
  S.position = pick(positions);
  S.positionFit = G.checkPositionFit(S.position);
  const t = pick(G.TEAMS);
  S.team = t;
  S.teamNeedMet = G.teamNeedPosition(t.abbr) === S.position;

  const career = G.simCareer(G.computeOVR(), t, G.activeBadgeMods());
  return { career, team: t };
}

const modes = ["cap", "classic", "sandbox"];
const tierCount = {};
let played = 0, budgetMax = 0; const binStats = [];

for (let i = 0; i < RUNS; i++) {
  const mode = modes[i % modes.length];
  const strat = (i % 2) ? "sensible" : "random";
  const seed = 100000 + i;
  let r;
  try { r = playOne(seed, mode, strat); }
  catch (e) { note(seed, mode, "THREW during build/sim", e.message); continue; }
  if (!r) continue;
  const { career } = r;
  played++;

  try {
    // ---- invariants on the career itself ----
    const bad = []; scan(career, "career", bad);
    if (bad.length) note(seed, mode, "non-finite / bad value in career", bad.slice(0, 4).join(", "));

    const n = career.seasons.length;
    if (n !== career.numSeasons) note(seed, mode, "numSeasons != seasons.length", n + " vs " + career.numSeasons);
    const le = (k, lim, lbl) => { if (career[k] > lim) note(seed, mode, k + " exceeds " + lbl, career[k] + " > " + lim); };
    le("allStars", n, "seasons"); le("allNBAs", n, "seasons"); le("mvps", n, "seasons");
    le("dpoys", n, "seasons"); le("rings", n, "seasons"); le("allDefensives", n, "seasons");
    if (career.roty > 1) note(seed, mode, "roty > 1", career.roty);
    if (career.finalsMVPs > career.rings) note(seed, mode, "finalsMVPs > rings", career.finalsMVPs + ">" + career.rings);

    // ---- THE band rule: tier can never exceed what the peak allows ----
    const tier = G.tierForCareer(career);
    const rank = G.TIERS.findIndex(x => x.name === tier.name);
    const ceil = G.highestTierIndexForPeak(career.peakOVR);
    if (rank > ceil) note(seed, mode, "TIER ABOVE PEAK BAND",
      tier.name + " at peak " + career.peakOVR + " (max " + G.TIERS[ceil].name + ")");
    tierCount[tier.name] = (tierCount[tier.name] || 0) + 1;

    // ---- per-season box score sanity ----
    career.seasons.forEach((s, idx) => {
      const st = s.stats;
      const chk = (k, lo, hi) => { if (st[k] < lo || st[k] > hi) note(seed, mode, "stat out of range " + k, st[k] + " yr" + (idx + 1)); };
      chk("ppg", 0, 55); chk("rpg", 0, 30); chk("apg", 0, 20); chk("spg", 0, 6);
      chk("bpg", 0, 8); chk("tpg", 0, 8); chk("fgPct", 30, 80); chk("tptPct", 0, 60);
      if (s.wins < 12 || s.wins > 73) note(seed, mode, "wins out of clamp", s.wins);
    });

    // ---- budget ----
    if (mode === "cap") {
      budgetMax = Math.max(budgetMax, S.budgetSpent);
      if (S.budgetSpent > G.BUDGET_CAP) note(seed, mode, "OVER CAP", S.budgetSpent + " > " + G.BUDGET_CAP);
    }
    // ---- no duplicate players / teams in the build ----
    // BUDGET_BIN filler ("Rotation Piece" etc.) is generic by design and may
    // legitimately repeat; only a repeated REAL player is a bug.
    const binNames = new Set(G.BUDGET_BIN.map(b => b.name));
    const names = G.usedPickNames();
    const real = names.filter(n => !binNames.has(n));
    if (new Set(real).size !== real.length) {
      const d = real.filter((n, i) => real.indexOf(n) !== i);
      note(seed, mode, "SAME REAL PLAYER TWICE IN ONE BUILD", d.join(",") + "  |  " + names.join(","));
    }
    const binUsed = names.filter(n => binNames.has(n)).length;
    if (binUsed) binStats.push(binUsed);

    // ---- OVR bounds ----
    const ovr = G.computeOVR(), disp = G.baseOVRDisplay();
    if (ovr < 25 || ovr > 99) note(seed, mode, "computeOVR out of range", ovr);
    if (disp > G.inputCeiling()) note(seed, mode, "baseOVRDisplay above input ceiling", disp + " > " + G.inputCeiling());

    // ---- every text/derived surface the verdict renders ----
    const surfaces = {
      headline: G.generateHeadline(career, tier),
      scouting: G.generateScoutingReport(career, ovr, tier),
      highlights: G.careerHighlights(career),
      comp: G.playstyleComp(career),
      badges: G.computeBadges(ovr, career),
      shadow: G.compareToShadow(career),
      pct: G.percentileForScore(career.goatScore),
      profile: G.buildProfile(),
      topAttr: G.topAttribute(),
      signature: G.signatureAttribute(),
      hof: G.isHallOfFame(career, tier),
    };
    if (surfaces.shadow) surfaces.shadowVerdict = G.generateShadowVerdict(career);
    career.seasons.forEach(s => { G.awardReasons(s); G.missedAwardReasons(s); });
    const sbad = []; scan(surfaces, "verdict", sbad);
    if (sbad.length) note(seed, mode, "bad value in a verdict surface", sbad.slice(0, 4).join(", "));
    if (!surfaces.comp || !surfaces.comp.name) note(seed, mode, "playstyleComp returned nothing", "");
    if (surfaces.comp && surfaces.comp.shades.length !== 2) note(seed, mode, "comp shades != 2", surfaces.comp.shades.length);
    if (surfaces.pct < 0 || surfaces.pct > 100) note(seed, mode, "percentile out of range", surfaces.pct);
  } catch (e) {
    note(seed, mode, "THREW during verdict surfaces", e.message + " | " + (e.stack || "").split("\n")[1]);
  }
}

console.log("strategies: half random-chaotic, half sensible");
console.log("games completed: " + played + " / " + RUNS);
console.log("tier spread:", JSON.stringify(tierCount));
console.log("builds that hit the BUDGET_BIN filler: " + binStats.length + "  (avg " + (binStats.length? (binStats.reduce((a,b)=>a+b,0)/binStats.length).toFixed(1):0) + " slots, max " + (binStats.length?Math.max(...binStats):0) + " of 8)");
console.log("max budget used (cap mode): " + budgetMax + " / " + G.BUDGET_CAP);
console.log("\nFAILURES: " + fails.length);
const byWhat = {};
fails.forEach(f => (byWhat[f.what] = byWhat[f.what] || []).push(f));
Object.keys(byWhat).sort((a, b) => byWhat[b].length - byWhat[a].length).forEach(w => {
  console.log("\n  [" + byWhat[w].length + "] " + w);
  byWhat[w].slice(0, 3).forEach(f => console.log("      seed " + f.seed + " (" + f.mode + "): " + f.detail));
});
process.exit(fails.length ? 1 : 0);
