#!/usr/bin/env node
/*
 * PERMANENT REGRESSION TESTS — PLAYSTYLE COMP SELECTION.
 *
 *     node test-comps.js
 *
 * RE-RUN THIS AFTER ANY CHANGE TOUCHING:
 *   - comp logic      (compDistance / compCaliber / archetypePenalty / topComps /
 *                      playstyleComp / accompDistance / sigEmphasis / skillShape)
 *   - tier logic      (tierForCareer / TIERS / TIER_OVR_FLOORS) — the comp gate
 *                      keys off the build's tier RANK, so a tier change silently
 *                      moves every comp gate with it
 *   - the comp dataset (COMP_ROWS in data.js — adding a player changes what is
 *                      reachable, and REMOVING one can leave an archetype with no
 *                      same-level match, which is how this bug kept coming back)
 * It is a pre-commit gate (hooks/pre-commit) for exactly those files.
 *
 * WHY THIS FILE EXISTS. The same failure was reported FOUR times, each time with
 * a different star's name on it, and each "fix" held only until the next tier was
 * tried:
 *     1. Amar'e Stoudemire   for a Bench Piece athletic-finisher build
 *     2. Alonzo Mourning     for a finishing-driven build
 *     3. Karl-Anthony Towns  for a Bench Piece rebounding centre
 *     4. Yao Ming            for a Starter    rebounding centre
 *
 * THE ROOT CAUSE WAS ONE THING, NOT FOUR. compCaliber() collapsed the pool into
 * effectively two values — 25 comps at caliber 1, ONE at caliber 2, and 24 at
 * caliber 3 — and that caliber-3 bucket held Carmelo Anthony (10x All-Star),
 * Paul George (9x), Wilkins (9x), Lillard (8x), Yao (8x), Mutombo (8x),
 * McGrady (7x), Mourning (7x) and Amar'e (6x) next to genuine 3x All-Stars. All
 * four reported offenders sat in it. With a one-tier grace, any build at Starter
 * could therefore reach ANY star short of Superstar, and no amount of tuning the
 * penalty weight could fix a bucket that could not express the difference.
 *
 * Two further structural faults fed it, both fixed alongside:
 *   - archetypePenalty compared raw ratings, so it measured LEVEL as much as
 *     shape and actively favoured the higher-rated player. It now compares each
 *     profile's deviation from its own mean, which is level-invariant.
 *   - Every comp at 88+ height was an All-Star or better, so a seven-foot build
 *     below All-Star tier had no comp that was both its size and its level.
 *
 * IF A CASE HERE FAILS, FIX THE LOGIC. Do not relax the assertion to match the
 * code — that is how the tier-floor bug survived five sessions.
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

let passed = 0;
const failures = [];
function check(name, actual, expected, detail) {
  const ok = typeof expected === "function" ? expected(actual) : actual === expected;
  if (ok) { passed++; console.log(`  PASS  ${name}  →  ${actual}`); }
  else {
    failures.push(name);
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${typeof expected === "function" ? expected.toString() : expected}, got ${actual}`);
    if (detail) console.log(`        ${detail}`);
  }
}

const comp = n => G.COMP_PLAYERS.find(x => x.name === n);
const caliberOf = n => G.compCaliber(G.accompOf(comp(n)));
const sigOf = n => G.signatureOfDims(comp(n).dims).attr;

// Build a profile and run REAL careers until one lands in the wanted tier, so
// every case exercises the whole path: sim -> tier -> comp, not a hand-made
// career object that could drift from what the sim actually produces.
function runCase({ pos, h, a, sk, team = "IND", tier, seeds = 400 }) {
  const S = G.state;
  S.sandbox = false; S.autoPick = true; S.activeBadges = [];
  S.position = pos; S.positionFit = true;
  S.height = { rating: h, label: "x" }; S.athleticism = { rating: a, label: "y" };
  S.skills = {}; Object.keys(sk).forEach(k => (S.skills[k] = { rating: sk[k] }));
  const t = G.TEAMS_BY_ABBR[team];
  S.team = t; S.teamNeedMet = false;
  const ovr = G.computeOVR();
  const out = [];
  for (let s = 1; s <= seeds; s++) {
    G.seedRng(s);
    const career = G.simCareer(ovr, t, {});
    if (G.tierForCareer(career).name !== tier) continue;
    const p = G.playstyleComp(career);
    out.push({ career, primary: p.name, shades: p.shades, rank: G.tierRank(career) });
  }
  return { ovr, base: G.baseOVRDisplay(), runs: out, profile: G.buildProfile() };
}

// Shared archetypes, defined once so the four reported failures and the positive
// case are demonstrably the SAME builds at different quality levels.
const REBOUNDING_BIG = { pos: "C", h: 96, a: 78, sk: { Shooting: 58, Finishing: 88, Playmaking: 48, Handles: 44, Defense: 50, Rebounding: 96 } };
const REBOUNDING_BIG_WEAK = { pos: "C", h: 96, a: 70, sk: { Shooting: 44, Finishing: 70, Playmaking: 44, Handles: 40, Defense: 45, Rebounding: 95 } };
// Three strengths of the SAME finishing-first archetype, because a single build
// only reaches one or two tiers — asserting a tier a build cannot produce tests
// nothing. Verified reachable: weak -> Draft Bust, mid -> Bench Piece,
// strong -> Starter.
const FINISHER_WEAK = { pos: "SF", h: 60, a: 88, sk: { Shooting: 34, Finishing: 74, Playmaking: 36, Handles: 42, Defense: 40, Rebounding: 44 }, team: "WAS" };
const FINISHER_MID = { pos: "SF", h: 60, a: 95, sk: { Shooting: 42, Finishing: 92, Playmaking: 46, Handles: 55, Defense: 56, Rebounding: 58 } };
const FINISHER_STRONG = { pos: "SF", h: 60, a: 96, sk: { Shooting: 52, Finishing: 96, Playmaking: 56, Handles: 66, Defense: 66, Rebounding: 68 } };
const STAR_SCORING_GUARD = { pos: "SG", h: 52, a: 88, sk: { Shooting: 92, Finishing: 93, Playmaking: 76, Handles: 92, Defense: 74, Rebounding: 56 }, team: "OKC" };

console.log("\n=== THE CALIBRE SCALE MUST BE ABLE TO EXPRESS THE DIFFERENCE ===");
// The bucket collapse was the root cause; assert the scale stays spread out.
{
  const hist = {};
  G.COMP_PLAYERS.forEach(r => { const c = G.compCaliber(G.accompOf(r)); hist[c] = (hist[c] || 0) + 1; });
  check("every calibre band 1-6 is populated",
    [1, 2, 3, 4, 5, 6].every(b => (hist[b] || 0) > 0), true, JSON.stringify(hist));
  check("no single band holds more than half the pool",
    Math.max(...Object.values(hist)) <= G.COMP_PLAYERS.length / 2, true, JSON.stringify(hist));
  // A perennial All-Star must outrank a 3-4x All-Star. This single assertion is
  // what all four reports reduce to.
  check("an 8x All-Star outranks a 3x All-Star", caliberOf("Yao Ming") > caliberOf("Rudy Gobert"), true,
    `Yao ${caliberOf("Yao Ming")} vs Gobert ${caliberOf("Rudy Gobert")}`);
  check("a 10x All-Star is at least Superstar calibre", caliberOf("Carmelo Anthony"), v => v >= 4);
  check("a zero-accolade journeyman is calibre 1", caliberOf("Reggie Evans"), 1);
  check("the top of the scale is untouched",
    ["Michael Jordan", "Magic Johnson", "Kareem Abdul-Jabbar"].every(n => caliberOf(n) === 6), true);
}

console.log("\n=== ARCHETYPE IS MEASURED ON SHAPE, NOT ON LEVEL ===");
// The old term compared raw ratings and so favoured the better player. Same
// shape at different levels must read as the SAME archetype.
{
  const strong = { Shooting: 58, Finishing: 88, Playmaking: 48, Handles: 44, Defense: 50, Rebounding: 96, height: 96, athleticism: 78 };
  const weak = {};
  Object.keys(strong).forEach(k => (weak[k] = strong[k] - 20));
  const evans = comp("Reggie Evans"), towns = comp("Karl-Anthony Towns");
  check("a rebounding shape is nearer a rebounding-first journeyman than a shooting-first star",
    G.archetypePenalty(strong, evans) < G.archetypePenalty(strong, towns), true,
    `Evans ${G.archetypePenalty(strong, evans).toFixed(1)} vs Towns ${G.archetypePenalty(strong, towns).toFixed(1)}`);
  check("dropping every rating by 20 does not change the archetype verdict",
    G.archetypePenalty(weak, evans) < G.archetypePenalty(weak, towns), true);
  check("archetype penalty is identical for a uniformly-shifted profile (level-invariant)",
    Math.abs(G.archetypePenalty(strong, evans) - G.archetypePenalty(weak, evans)) < 0.001, true);
}

console.log("\n=== REPORT 3: BENCH PIECE REBOUNDING CENTRE (was Karl-Anthony Towns) ===");
{
  const r = runCase(Object.assign({}, REBOUNDING_BIG_WEAK, { tier: "Bench Piece" }));
  check("produced Bench Piece careers to test", r.runs.length, v => v > 0);
  const bad = r.runs.filter(x => caliberOf(x.primary) > x.rank + 1);
  check("primary never exceeds the tier band", bad.length, 0,
    bad.length ? `${bad[0].primary} (calibre ${caliberOf(bad[0].primary)}) for rank ${bad[0].rank}` : "");
  const badShade = r.runs.filter(x => x.shades.some(s => caliberOf(s) > x.rank + 1));
  check("shades never exceed the tier band either", badShade.length, 0);
  check("primary is rebounding-first, not a scoring big",
    r.runs.every(x => sigOf(x.primary) === "Rebounding"), true,
    [...new Set(r.runs.map(x => `${x.primary}(${sigOf(x.primary)})`))].join(", "));
  check("Towns is never the primary here", r.runs.every(x => x.primary !== "Karl-Anthony Towns"), true);
}

console.log("\n=== REPORT 4: STARTER REBOUNDING CENTRE (was Yao Ming) ===");
{
  const r = runCase(Object.assign({}, REBOUNDING_BIG, { tier: "Starter" }));
  check("produced Starter careers to test", r.runs.length, v => v > 0);
  const bad = r.runs.filter(x => caliberOf(x.primary) > x.rank + 1);
  check("primary never exceeds the tier band", bad.length, 0,
    bad.length ? `${bad[0].primary} (calibre ${caliberOf(bad[0].primary)}) for rank ${bad[0].rank}` : "");
  check("primary is rebounding-first, not a post scorer",
    r.runs.every(x => sigOf(x.primary) === "Rebounding"), true,
    [...new Set(r.runs.map(x => `${x.primary}(${sigOf(x.primary)})`))].join(", "));
  check("Yao is never the primary here", r.runs.every(x => x.primary !== "Yao Ming"), true);
  check("no 6+ time All-Star is the primary here",
    r.runs.every(x => G.accompOf(comp(x.primary)).allStar < 6), true,
    [...new Set(r.runs.map(x => x.primary))].join(", "));
}

console.log("\n=== REPORTS 1 & 2: FINISHING-DRIVEN BUILD (was Amar'e / Alonzo Mourning) ===");
{
  [["Draft Bust", FINISHER_WEAK], ["Bench Piece", FINISHER_MID], ["Starter", FINISHER_STRONG]].forEach(([tier, build]) => {
    const r = runCase(Object.assign({}, build, { tier }));
    check(`${tier}: produced careers to test`, r.runs.length, v => v > 0);
    if (!r.runs.length) return;
    const bad = r.runs.filter(x => caliberOf(x.primary) > x.rank + 1);
    check(`${tier}: primary never exceeds the tier band`, bad.length, 0,
      bad.length ? `${bad[0].primary} calibre ${caliberOf(bad[0].primary)}` : "");
    check(`${tier}: primary is not a defence-first anchor`,
      r.runs.every(x => sigOf(x.primary) !== "Defense"), true,
      [...new Set(r.runs.map(x => `${x.primary}(${sigOf(x.primary)})`))].join(", "));
    check(`${tier}: Mourning and Amar'e are never the primary`,
      r.runs.every(x => x.primary !== "Alonzo Mourning" && x.primary !== "Amar'e Stoudemire"), true);
  });
}

console.log("\n=== REPORT 5: BALANCED STARTER, NO STANDOUT SKILL (was Karl-Anthony Towns) ===");
//
// THIS SUITE PASSED 37/37 WHILE THIS BUG WAS LIVE. Every case above uses a build
// with a DISTINCTIVE signature — rebounding-first, finishing-first — and
// archetypePenalty only charged a signature mismatch when the BUILD was
// distinctive. A balanced build (the game's own narrative calls these "built on
// balance rather than one standout skill") therefore paid nothing for matching a
// specialist. The cases did not match real conditions; that is why they passed.
//
// Two fixes, both asserted below: the mismatch now fires in BOTH directions
// (balanced vs specialist is an archetype clash either way), and Towns' comp row
// was corrected. His Shooting 86 TIED his Rebounding 86, so signatureOfDims read
// margin 0 and called the man whose own reasoning text says "elite shooting"
// balanced — which let him escape every signature penalty. 67 of 103 comps had no
// distinctive signature for this reason.
const BALANCED_BIG = { pos: "C", h: 88, a: 74,
  sk: { Shooting: 72, Finishing: 78, Playmaking: 66, Handles: 64, Defense: 74, Rebounding: 80 } };
{
  const r = runCase(Object.assign({}, BALANCED_BIG, { tier: "Starter" }));
  check("produced balanced Starter careers to test", r.runs.length, v => v > 0);
  check("the build really is balanced (no distinctive signature)",
    G.signatureOfDims(r.profile).distinctive, false);
  const bad = r.runs.filter(x => caliberOf(x.primary) > x.rank + 1);
  check("balanced Starter: primary never exceeds the tier band", bad.length, 0);
  check("balanced Starter: primary is NOT an All-Star-calibre specialist",
    r.runs.every(x => !(caliberOf(x.primary) >= 3 && G.signatureOfDims(comp(x.primary).dims).distinctive)), true,
    [...new Set(r.runs.map(x => x.primary + "(cal" + caliberOf(x.primary) +
      (G.signatureOfDims(comp(x.primary).dims).distinctive ? ",specialist" : ",balanced") + ")"))].join(", "));
  check("balanced Starter: Towns is never the primary", r.runs.every(x => x.primary !== "Karl-Anthony Towns"), true);
}
// Towns and Gobert are described in their own reasoning text as specialists; the
// dims must agree, or they slip the archetype gate for every build.
check("Towns' profile reads as the shooting specialist his text describes",
  G.signatureOfDims(comp("Karl-Anthony Towns").dims).attr, "Shooting");
check("Towns is flagged distinctive, not balanced",
  G.signatureOfDims(comp("Karl-Anthony Towns").dims).distinctive, true);
check("Gobert reads as the defensive specialist his text describes",
  G.signatureOfDims(comp("Rudy Gobert").dims).distinctive, true);
// The mismatch must fire in BOTH directions — this is the branch that was missing.
{
  const balanced = { height: 88, athleticism: 74, Shooting: 72, Finishing: 78, Playmaking: 66, Handles: 64, Defense: 74, Rebounding: 80 };
  const specialist = comp("Karl-Anthony Towns"), rounded = comp("JaVale McGee");
  check("a balanced build is penalised for matching a specialist",
    G.archetypePenalty(balanced, specialist) > G.archetypePenalty(balanced, rounded), true,
    "specialist " + G.archetypePenalty(balanced, specialist).toFixed(1) + " vs balanced " + G.archetypePenalty(balanced, rounded).toFixed(1));
}

console.log("\n=== POSITIVE CASE: A REAL STAR MUST STILL GET A STAR ===");
// The gate is one-directional, so tightening it must not strand elite builds on
// journeymen. This is the assertion that stops an over-correction.
{
  const r = runCase(Object.assign({}, STAR_SCORING_GUARD, { tier: "Superstar" }));
  check("produced Superstar careers to test", r.runs.length, v => v > 0);
  check("a Superstar scoring guard comps to a star-calibre player",
    r.runs.every(x => caliberOf(x.primary) >= 4), true,
    [...new Set(r.runs.map(x => `${x.primary}(cal ${caliberOf(x.primary)})`))].join(", "));
  check("and that star is a scorer, not a defence- or rebounding-first player",
    r.runs.every(x => ["Finishing", "Shooting", "Handles", "Playmaking"].includes(sigOf(x.primary))), true,
    [...new Set(r.runs.map(x => `${x.primary}(${sigOf(x.primary)})`))].join(", "));
  check("an elite build is never stranded on a zero-accolade journeyman",
    r.runs.every(x => caliberOf(x.primary) > 1), true);
}

console.log("\n=== THE POOL MUST BE ABLE TO ANSWER AT EVERY SIZE AND LEVEL ===");
// The gap that let this recur: no low-calibre comp was tall enough for a
// seven-foot build, so the honest nearest neighbour was always a star.
{
  const tallLow = G.COMP_PLAYERS.filter(r => r.dims.height >= 88 && G.compCaliber(G.accompOf(r)) <= 2);
  check("there is at least one 7-foot comp at calibre <= 2", tallLow.length, v => v >= 3,
    tallLow.map(r => r.name).join(", "));
  const lowSigs = new Set(G.COMP_PLAYERS.filter(r => G.compCaliber(G.accompOf(r)) <= 2)
    .map(r => G.signatureOfDims(r.dims)).filter(s => s.distinctive).map(s => s.attr));
  check("low-calibre comps cover at least 4 distinct signature skills", lowSigs.size, v => v >= 4,
    [...lowSigs].join(", "));
}

console.log("\n" + "=".repeat(52));
if (failures.length) {
  console.log(`FAILED  ${failures.length} of ${passed + failures.length}`);
  failures.forEach(f => console.log(`   - ${f}`));
  process.exit(1);
}
console.log(`PASSED  all ${passed} checks`);
