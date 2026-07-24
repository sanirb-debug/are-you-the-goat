#!/usr/bin/env node
/*
 * sim-difficulty.js — difficulty probes for the two tracked modes.
 *
 *     node sim-difficulty.js [runs]        (default 100)
 *
 * SALARY CAP EDITION models a greedy-optimal player: for each of the 8 slots in
 * the fixed order, a random team is scouted and they take the best AFFORDABLE
 * option from it, against the shared $100M cap.
 *
 * CLASSIC models a lucky/skilled player: each round spins a team (no repeats)
 * and a player from it (no repeats), then takes the BEST of that player's
 * still-open stats — the strongest play available under the free-for-all rules.
 *
 * Both then take a fitting position and the strongest team that needs it, and
 * simulate. The output is a tier distribution. What we want to see is a real
 * SPREAD, not everything piling up at Legend/GOAT — Classic has no cost lever,
 * so its only real risk is spinning a genuinely bad player.
 *
 * Same vm harness as test-tiers.js: data.js + game.js concatenated into one
 * script so game.js can see data.js's top-level consts.
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
const RUNS = parseInt(process.argv[2] || "100", 10);

// Local PRNG for the BUILD choices, kept separate from the game's own rng so
// seeding the career sim doesn't perturb which players a build spins.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resetBuild() {
  const S = G.state;
  S.height = null; S.athleticism = null; S.skills = {};
  S.budgetSpent = 0; S.activeBadges = []; S.pickOrder = [];
  S.scoutTeam = null; S.sandbox = false; S.autoPick = false;
  S.positionFit = null; S.teamNeedMet = false; S.team = null; S.position = null;
}

const lockInto = (cat, pick) =>
  (cat === "height" || cat === "athleticism") ? G.lockPhysical(cat, pick) : G.lockSkill(cat, pick);

// Greedy-optimal Salary Cap build: best affordable option per slot, in order.
function buildSalaryCap(rand) {
  resetBuild();
  for (const cat of G.CATEGORIES) {
    const team = G.TEAMS[Math.floor(rand() * G.TEAMS.length)];
    G.state.scoutTeam = team;
    const affordable = G.getRosterOptions(cat).filter(o => o.affordable);
    const best = affordable.reduce((a, b) => (b.rating > a.rating ? b : a));
    lockInto(cat, best);
  }
}

// Lucky/skilled Classic build: spin team + player (no repeats), take the best
// of that player's still-open stats into its own slot.
function buildClassic(rand) {
  resetBuild();
  G.state.autoPick = true;
  const usedTeams = new Set(), usedNames = new Set();
  const open = new Set(G.CATEGORIES);
  for (let round = 0; round < 8; round++) {
    const avail = G.TEAMS.filter(t => !usedTeams.has(t.abbr));
    const team = avail[Math.floor(rand() * avail.length)];
    const pool = (G.TEAM_ROSTERS[team.abbr] || []).filter(p => !usedNames.has(p.name));
    const player = pool[Math.floor(rand() * pool.length)];
    let bestCat = null, bestRating = -Infinity;
    for (const cat of open) {
      const r = G.categoryRating(player, cat);
      if (r > bestRating) { bestRating = r; bestCat = cat; }
    }
    lockInto(bestCat, G.buildStatPick(player, team, bestCat, bestCat));
    usedTeams.add(team.abbr); usedNames.add(player.name);
    open.delete(bestCat);
  }
}

// Shared finish: a fitting position, the strongest team that needs it, and the
// best badges the build can activate (3 in Classic, 2 in Salary Cap).
function finishAndSim(seed, badgeCap) {
  const S = G.state;
  const positions = Object.keys(G.POSITIONS);
  S.position = positions.find(p => { S.position = p; return G.checkPositionFit(p); }) || positions[0];
  S.positionFit = G.checkPositionFit(S.position);

  const byStrength = [...G.TEAMS].sort((a, b) => b.scr - a.scr);
  const team = byStrength.find(t => G.TEAM_NEEDS[t.abbr] === S.position) || byStrength[0];
  S.team = team;
  S.teamNeedMet = G.TEAM_NEEDS[team.abbr] === S.position;

  S.activeBadges = G.acquiredBadges().slice(0, badgeCap).map(b => b.key);

  G.seedRng(seed);
  const career = G.simCareer(G.computeOVR(), team, G.activeBadgeMods());
  return { tier: G.tierForCareer(career).name, ovr: G.computeOVR(), score: career.goatScore };
}

function run(label, builder, badgeCap) {
  const rand = mulberry32(20260723);
  const tiers = {}, ovrs = [], scores = [];
  for (let i = 0; i < RUNS; i++) {
    builder(rand);
    const r = finishAndSim(9001 + i, badgeCap);
    tiers[r.tier] = (tiers[r.tier] || 0) + 1;
    ovrs.push(r.ovr); scores.push(r.score);
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`\n=== ${label} — ${RUNS} builds ===`);
  console.log(`  avg peak-build OVR ${avg(ovrs).toFixed(1)}   avg GOAT Score ${Math.round(avg(scores))}`);
  for (const t of G.TIERS.map(t => t.name)) {
    const n = tiers[t] || 0;
    const pct = (n / RUNS) * 100;
    const bar = "#".repeat(Math.round(pct / 2));
    console.log(`  ${t.padEnd(12)} ${String(n).padStart(4)}  ${pct.toFixed(1).padStart(5)}%  ${bar}`);
  }
}

run("SALARY CAP EDITION (greedy-optimal)", buildSalaryCap, 2);
run("CLASSIC (lucky/skilled: best open stat each spin)", buildClassic, 3);
console.log("");
