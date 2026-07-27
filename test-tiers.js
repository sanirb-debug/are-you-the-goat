#!/usr/bin/env node
/*
 * PERMANENT REGRESSION TESTS — tier assignment, alternate floor paths, award rates.
 *
 *     node test-tiers.js
 *
 * THIS SUITE IS A PRE-COMMIT GATE (hooks/pre-commit) for any change to data.js,
 * game.js, ui.js or this file. Run it manually too whenever you touch:
 * tierForCareer / meetsTierFloors / meetsAwardFloor / clampTierToPeak /
 * TIER_OVR_FLOORS / TIER_AWARD_FLOORS / TIER_ALT_PATHS / scaleOVR / goatScore
 * weights / the MVP, All-NBA, DPOY or All-Star thresholds. It is NOT only for
 * sessions that are deliberately working on tiers — the regressions below were
 * all caused by unrelated award/OVR changes.
 *
 * THE ONE RULE: the published peak-OVR band is ABSOLUTE and is the ceiling on
 * every tier assignment.
 *   Draft Bust <60 | Bench 60 | Starter 70 | All-Star 80 | Superstar 85
 *   Legend 90 | GOAT 98
 * Award floors, alternate paths, longevity/volume totals and MVP-season OVR can
 * only ever make a tier HARDER to reach, never lift a career above its band. An
 * alt path may stand in for a tier's MVP requirement and nothing else.
 *
 * WHY THIS FILE EXISTS — read this before "fixing" a failure here. The tier-floor
 * bug was reported 5-6 times, and this suite was the cause of the recurrence, not
 * the cure: four cases used to assert that peaks of 73/74/75/76 must reach LEGEND
 * (floor 90), i.e. they mandated the very bypass being reported as a bug. Every
 * session that enforced the band broke those four, and the next session made them
 * pass again by reinstating the bypass. They were inverted on 2026-07-26. If a case
 * here fails, fix the LOGIC — do not relax the assertion to match the code.
 * If a tier looks wrong again: add the failing scenario here FIRST, watch it fail,
 * then fix the logic.
 *
 * The browser build has no module system (plain <script> tags sharing globals),
 * so this concatenates data.js + game.js and evaluates them in one vm context,
 * exactly like the browser does.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadGame() {
  const dir = __dirname;
  // Both files end with `if (typeof module !== "undefined") { module.exports = ... }`.
  // Concatenating them into ONE script keeps game.js's references to data.js's
  // top-level consts resolvable (top-level const is a lexical binding, not a
  // property of the context, so it can only be reached from the same script).
  // We let each export block run and snapshot it before the next overwrites it.
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
  // expose the backing map so progress tests can seed raw localStorage values
  return Object.assign({}, ctx.__DATA__, ctx.__GAME__, { __store: store });
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

// A blank-but-valid career object. Individual tests override only what matters,
// which keeps each case readable and makes the intent of the scenario obvious.
function career(o) {
  return Object.assign({
    goatScore: 0, peakOVR: 0, bestMVPOVR: 0, numSeasons: 18, careerWins: 800,
    rings: 0, mvps: 0, finalsMVPs: 0, allNBAs: 0, allStars: 0,
    dpoys: 0, roty: 0, allDefensives: 0, seasons: [],
    totals: { pts: 0, ast: 0, reb: 0, stl: 0, blk: 0, threes: 0 },
    avgFgPct: 50, avgTptPct: 35,
    bestSeason: { year: 1, peakScore: 0, ppg: 0, apg: 0, rpg: 0, spg: 0, bpg: 0, tpg: 0, fgPct: 50, tptPct: 35 },
  }, o);
}
const tierOf = c => G.tierForCareer(c).name;
const rank = name => G.TIERS.findIndex(t => t.name === name);
const atLeast = floor => actual => rank(actual) >= rank(floor);
const atMost = ceil => actual => rank(actual) <= rank(ceil);

console.log("\n=== TIER FLOORS: alternate qualifying paths ===");

// ############################################################################
// THESE FOUR CASES WERE INVERTED ON 2026-07-26, AND THAT INVERSION IS THE FIX.
//
// They previously asserted atLeast("Legend") for peak OVRs of 73/74/75/76 while
// Legend's floor is 90 — i.e. they REQUIRED the alt paths to bypass the published
// peak-OVR band. That is precisely the bug reported 5-6 separate times ("a Peak
// OVR 83 build reached Legend"). The mechanism of the recurrence was this file:
// any session that enforced the band broke these four assertions, and the next
// session made them pass again by restoring the bypass.
//
// The band is now authoritative and absolute:
//   Draft Bust <60 | Bench 60 | Starter 70 | All-Star 80 | Superstar 85
//   Legend 90 | GOAT 98
// An alt path may still stand in for a tier's MVP requirement — it may NEVER
// substitute for peak OVR. Do not "restore" these to atLeast(...) without an
// explicit product decision to abandon the band.
// ############################################################################
check("20x All-NBA / 20x All-Star, peak OVR 73 -> capped by the band",
  tierOf(career({ allNBAs: 20, allStars: 20, numSeasons: 20, peakOVR: 73, goatScore: 430 })),
  atMost("Starter"),
  "peak 73 is inside the Starter band (70-80); no award record may lift it");

check("20x All-NBA / 20x All-Star + 5 MVP + 5 rings, peak OVR 75",
  tierOf(career({ allNBAs: 20, allStars: 20, numSeasons: 20, peakOVR: 75,
                  mvps: 5, rings: 5, finalsMVPs: 3, goatScore: 700 })),
  atMost("Starter"),
  "even a full GOAT resume cannot exceed the peak-OVR band");

check("43k career points, 20 seasons, 1000 wins, peak OVR 74",
  tierOf(career({ totals: { pts: 43000, ast: 8000, reb: 9000, stl: 1500, blk: 900, threes: 1800 },
                  numSeasons: 20, careerWins: 1000, peakOVR: 74,
                  allStars: 15, allNBAs: 13, goatScore: 480 })),
  atMost("Starter"),
  "the volume/longevity path must not bypass the band either");

check("2 DPOY / 0 MVP, peak OVR 76",
  tierOf(career({ dpoys: 2, allStars: 14, allNBAs: 12, peakOVR: 76, rings: 2, goatScore: 400 })),
  atMost("Starter"),
  "the DPOY path must not bypass the band either");

// The alt paths retain their ONE legitimate job: waiving a tier's MVP floor for a
// career that clears the OVR band but never won MVP.
check("Legend-band peak (92) + 2 DPOY + 0 MVP still reaches Legend",
  tierOf(career({ peakOVR: 92, dpoys: 2, allStars: 14, allNBAs: 12, mvps: 0,
                  rings: 2, numSeasons: 18, goatScore: 700 })),
  "Legend",
  "alt path may substitute for the MVP requirement when the band is satisfied");

console.log("\n=== REPORTED 2026-07-26: Peak OVR 83 must cap at All-Star ===");

// The exact reported scenario, one case per alt path that used to grant Legend.
// 83 sits in the All-Star band (80-85), so All-Star is the ceiling regardless of
// how decorated the career is.
const peak83 = extra => career(Object.assign({
  peakOVR: 83, goatScore: 700, numSeasons: 18, careerWins: 900,
  allStars: 14, allNBAs: 12,
  totals: { pts: 20000, ast: 4000, reb: 6000, stl: 1000, blk: 500, threes: 900 },
}, extra));

check("peak 83 + 15x All-NBA (allNBAs alt path)",
  tierOf(peak83({ allNBAs: 15 })), "All-Star",
  "REPORTED BUG: this returned Legend");
check("peak 83 + 2 DPOY (dpoys alt path)",
  tierOf(peak83({ dpoys: 2 })), "All-Star",
  "REPORTED BUG: this returned Legend");
check("peak 83 + 33k pts / 18 seasons / 900 wins (volume alt path)",
  tierOf(peak83({ totals: { pts: 33000, ast: 5000, reb: 7000, stl: 1200, blk: 600, threes: 1000 } })),
  "All-Star", "REPORTED BUG: this returned Legend");
check("peak 83 + full GOAT resume (5 MVP, 5 rings, 20x All-NBA)",
  tierOf(peak83({ mvps: 5, rings: 5, finalsMVPs: 3, allNBAs: 20, allStars: 20 })),
  "All-Star", "no resume may exceed the band");
check("peak 83 via bestMVPOVR only (effectivePeak still 83)",
  tierOf(peak83({ peakOVR: 70, bestMVPOVR: 83, mvps: 3 })), "All-Star",
  "the MVP-season OVR route must respect the band too");
check("peak 84 (top of the All-Star band) still All-Star",
  tierOf(peak83({ peakOVR: 84, allNBAs: 20 })), "All-Star");
check("peak 85 (bottom of the Superstar band) may reach Superstar",
  tierOf(peak83({ peakOVR: 85, allNBAs: 20 })), "Superstar");

// Exhaustive: for EVERY integer peak 25..99, a maximally-decorated career must
// never exceed the band that peak allows. This is the invariant, not a sample.
console.log("\n=== BAND INVARIANT SWEEP: peak 25..99, maxed resume ===");
const FLOORS = G.TIER_OVR_FLOORS;
const allowedFor = peak => {
  let best = G.TIERS[0].name;
  for (const t of G.TIERS) { const f = FLOORS[t.name]; if (!f || peak >= f) best = t.name; }
  return best;
};
let sweepBad = [];
for (let peak = 25; peak <= 99; peak++) {
  const maxed = career({
    peakOVR: peak, bestMVPOVR: peak, goatScore: 100000,
    allStars: 25, allNBAs: 25, mvps: 10, rings: 10, finalsMVPs: 8,
    dpoys: 5, allDefensives: 15, numSeasons: 20, careerWins: 1300,
    totals: { pts: 50000, ast: 12000, reb: 15000, stl: 3000, blk: 2000, threes: 3000 },
  });
  const got = tierOf(maxed), cap = allowedFor(peak);
  if (rank(got) > rank(cap)) sweepBad.push(`peak ${peak}: got ${got}, band allows at most ${cap}`);
}
check("no peak 25-99 can exceed its band with a maxed resume",
  sweepBad.length === 0 ? "clean" : sweepBad.slice(0, 5).join(" | "), "clean",
  "75 peaks x maxed resume; any hit here is a band violation");

console.log("\n=== TIER FLOORS: guards that must NOT loosen ===");

// The alternate paths must not become a blanket bypass. A thin resume stays low
// no matter how the floors are relaxed above.
check("empty career (zero of everything)",
  tierOf(career({})), atMost("Starter"));

check("weak build: 3x All-Star, no All-NBA, peak OVR 71",
  tierOf(career({ allStars: 3, allNBAs: 0, peakOVR: 71, goatScore: 200 })),
  atMost("Starter"),
  "3 All-Stars is under the All-Star tier's 6-selection floor");

check("volume path needs ALL of points+seasons+wins (28k pts, short career)",
  tierOf(career({ totals: { pts: 28000, ast: 0, reb: 0, stl: 0, blk: 0, threes: 0 },
                  numSeasons: 12, careerWins: 500, peakOVR: 70,
                  allStars: 7, allNBAs: 2, goatScore: 300 })),
  atMost("All-Star"));

// Historical regressions that have each shipped broken at least once.
// raw 73 -> scaled 86 (fixture predates the 25-99 rescale; scenario unchanged)
check("7x All-Star / 2x All-NBA (was capped at Starter)",
  tierOf(career({ allStars: 7, allNBAs: 2, peakOVR: 86, goatScore: 370 })),
  "All-Star");

// raw 78 -> scaled 93
check("15x All-Star / 8x All-NBA (was capped at All-Star)",
  tierOf(career({ allStars: 15, allNBAs: 8, peakOVR: 93, goatScore: 430 })),
  atLeast("Superstar"));

check("tierForCareer(undefined) fails safe, never promotes",
  tierOf(undefined), atMost("Starter"));

// Caught by the greedy-optimal sim, not by the cases above: All-NBA is cheap to
// accumulate (any OVR 71+ season qualifies), so an All-NBA-count alternate path
// must NOT waive GOAT's 4-MVP floor. When it did, the ordinary budget-optimal
// build was promoted Superstar -> GOAT in ~18% of runs.
check("18x All-NBA + 18x All-Star + 4 hardware but only 1 MVP is NOT GOAT",
  tierOf(career({ allNBAs: 18, allStars: 18, numSeasons: 19, mvps: 1,
                  rings: 3, finalsMVPs: 2, peakOVR: 81, goatScore: 600 })),
  atMost("Legend"),
  "GOAT must still require real MVP hardware");

console.log("\n=== PEAK-OVR BANDS ON THE 25-99 SCALE ===");

// Peak OVR is stored on a rescaled 25-99 display scale (scaleOVR in game.js), so
// the tier floors read as the published ladder: Bust <60, Bench 60, Starter 70,
// All-Star 80, Superstar 85, Legend 90, GOAT 98. These cases pin each floor.
check("GOAT floor is reachable at scaled peak 98+",
  tierOf(career({ peakOVR: 98, allNBAs: 18, allStars: 19, numSeasons: 20, mvps: 5,
                  rings: 4, finalsMVPs: 3, goatScore: 900 })),
  "GOAT",
  "a maxed resume at peak 98 must reach GOAT, not stall below it");

check("just under the GOAT floor (peak 97) does not reach GOAT",
  tierOf(career({ peakOVR: 97, allNBAs: 18, allStars: 19, numSeasons: 20, mvps: 5,
                  rings: 4, finalsMVPs: 3, goatScore: 900 })),
  atMost("Legend"));

check("Superstar is reachable and not skipped (peak 87)",
  tierOf(career({ peakOVR: 87, allStars: 13, allNBAs: 9, numSeasons: 16, goatScore: 520 })),
  "Superstar",
  "Superstar must not be harder to reach than Legend");

check("All-Star floor at scaled peak 80",
  tierOf(career({ peakOVR: 82, allStars: 7, allNBAs: 2, numSeasons: 15, goatScore: 430 })),
  "All-Star");

check("Draft Bust is reachable for a genuinely bad career",
  tierOf(career({ peakOVR: 48, allStars: 0, allNBAs: 0, numSeasons: 5,
                  careerWins: 120, goatScore: 210 })),
  "Draft Bust",
  "Draft Bust and Bench Piece were unreachable before the bucket rebalance");

check("Bench Piece is reachable between the Bust and Starter buckets",
  tierOf(career({ peakOVR: 64, allStars: 0, allNBAs: 0, numSeasons: 9,
                  careerWins: 300, goatScore: 330 })),
  "Bench Piece");

console.log("\n=== PER-MODE PROGRESS (Salary Cap vs Classic) ===");

// Lifetime stats and achievements are tracked per mode. The definitions are
// shared; only the unlock STATE and the accumulators are split.
const store = G.__store;                       // the harness localStorage backing map
const PK = "aytg_progress";
const reset = () => { delete store[PK]; delete store["aytg_best_score"]; };
const run = o => Object.assign({
  mode: "cap", goatScore: 300, tierIdx: 3, tierName: "All-Star", isHOF: false,
  rings: 0, mvps: 0, dpoys: 0, rotys: 0, dethroned: null,
  activatedBadgeKeys: [], fullStack: false, budgetExact: false, unanimous: false,
}, o);

// 1. MIGRATION — flat v1 data is Salary Cap history; Classic starts at zero.
reset();
store[PK] = JSON.stringify({ version: 1, careersPlayed: 7, bestScore: 480,
  bestTierIdx: 4, totalRings: 3, totalMVPs: 2, totalDPOYs: 1, totalROTYs: 1,
  activatedBadges: ["X|Shooting"], dethronedTargets: ["Stephen Curry"],
  unlocked: { hof_first: true } });
check("v1 history migrates into Salary Cap Edition",
  G.loadProgress("cap").careersPlayed, 7,
  "the pre-split history was generated by the capped mode");
check("migrated Salary Cap keeps its unlocks", G.loadProgress("cap").unlocked.hof_first, true);
check("migrated Salary Cap keeps its totals", G.loadProgress("cap").totalRings, 3);
check("Classic starts empty after migration", G.loadProgress("classic").careersPlayed, 0);
check("Classic has no unlocks after migration",
  Object.keys(G.loadProgress("classic").unlocked).length, 0);

// 2. ISOLATION — recording in one mode must not touch the other.
G.recordCareerRun(run({ mode: "classic", rings: 5 }));
check("Classic run increments Classic", G.loadProgress("classic").careersPlayed, 1);
check("Classic run leaves Salary Cap untouched", G.loadProgress("cap").careersPlayed, 7);
check("Classic rings do not leak into Salary Cap", G.loadProgress("cap").totalRings, 3);
G.recordCareerRun(run({ mode: "cap" }));
check("Salary Cap run increments Salary Cap", G.loadProgress("cap").careersPlayed, 8);
check("Salary Cap run leaves Classic untouched", G.loadProgress("classic").careersPlayed, 1);

// 3. ACHIEVEMENT STATE is per mode; the DEFINITIONS stay one shared list.
reset();
G.recordCareerRun(run({ mode: "cap", tierName: "GOAT", tierIdx: 6, isHOF: true }));
check("achievement unlocked in Salary Cap", !!G.loadProgress("cap").unlocked.tier_goat, true);
check("same achievement still LOCKED in Classic",
  !!G.loadProgress("classic").unlocked.tier_goat, false,
  "unlock state must not be shared across modes");
check("achievement definitions are a single shared list",
  Array.isArray(G.ACHIEVEMENTS) && G.ACHIEVEMENTS.length > 0, true);

// 4. Per-mode personal best.
reset();
G.recordCareerRun(run({ mode: "cap", goatScore: 700 }));
check("best score records in its own mode", G.loadProgress("cap").bestScore, 700);
check("best score does not leak to the other mode", G.loadProgress("classic").bestScore, 0);

console.log("\n=== MVP RATE SCALES WITH DOMINANCE ===");

// Build a dominant player and run real careers. A historically great season
// should convert to MVP most years, not lose a flat 65% coin flip every time.
function simN(skill, def, runs) {
  // Strongest team by the LIVE axis (effectiveScr), not the retired TEAMS[].scr.
  const T = G.TEAMS.reduce((a, t) => (G.effectiveScr(t.abbr) > G.effectiveScr(a.abbr) ? t : a));
  G.state.shadowTarget = "Michael Jordan";
  G.state.name = "T"; G.state.position = "SF"; G.state.positionFit = true;
  G.state.team = T; G.state.teamNeedMet = true;
  G.state.height = { rating: 74, label: "H", name: "H", cost: 0, team: T };
  G.state.athleticism = { rating: 76, label: "F", name: "F", cost: 0, team: T };
  G.state.skills = {};
  for (const s of G.SKILL_ORDER) G.state.skills[s] = { rating: skill, name: s, cost: 0, era: "-", team: T };
  if (def != null) G.state.skills.Defense = { rating: def, name: "D", cost: 0, era: "-", team: T };
  G.state.activeBadges = [];
  const ovr = G.computeOVR();
  let mvpSum = 0, anSum = 0, seasonSum = 0, rotySum = 0, maxSeasons = 0, minSeasons = 99, tiers = {};
  let asSum = 0, ppgSum = 0, ppgN = 0;
  for (let i = 0; i < runs; i++) {
    G.seedRng(4242 + i);
    const c = G.simCareer(ovr, T, G.activeBadgeMods());
    mvpSum += c.mvps; anSum += c.allNBAs;
    asSum += c.allStars;
    c.seasons.forEach(s => { ppgSum += s.stats.ppg; ppgN++; });
    seasonSum += c.numSeasons; rotySum += c.roty;
    maxSeasons = Math.max(maxSeasons, c.numSeasons);
    minSeasons = Math.min(minSeasons, c.numSeasons);
    const t = G.tierForCareer(c).name; tiers[t] = (tiers[t] || 0) + 1;
  }
  return { ovr, mvps: mvpSum / runs, allNBAs: anSum / runs, tiers,
           seasons: seasonSum / runs, minSeasons, maxSeasons, rotyRate: rotySum / runs,
           allStars: asSum / runs, ppg: ppgSum / Math.max(1, ppgN) };
}

const dominant = simN(99, 99, 400);
console.log(`  (all-99 build: OVR ${dominant.ovr}, mean All-NBA ${dominant.allNBAs.toFixed(1)}, tiers ${JSON.stringify(dominant.tiers)})`);
check("all-99 dominant build wins MVP most seasons",
  Number(dominant.mvps.toFixed(1)), v => v >= 9,
  "a historically dominant career should clear ~9+ MVPs, not a flat ~35% roll");

const average = simN(70, 70, 400);
console.log(`  (all-70 build: OVR ${average.ovr}, mean All-NBA ${average.allNBAs.toFixed(1)})`);
check("average build stays near zero MVPs",
  Number(average.mvps.toFixed(2)), v => v <= 1.0,
  "scaling the MVP roll must not hand MVPs to ordinary builds");

console.log("\n=== CAREER LENGTH SCALES WITH QUALITY ===");

// A genuinely bad player gets cut; he does not log 15+ seasons. Career length
// must fall out of build quality rather than being a flat randInt(15,20).
const bust = simN(30, 30, 400);
console.log(`  (bust build: OVR ${bust.ovr}, seasons ${bust.seasons.toFixed(1)} [${bust.minSeasons}-${bust.maxSeasons}], ROTY rate ${(100 * bust.rotyRate).toFixed(0)}%)`);
check("Draft-Bust-quality build has a short career",
  Number(bust.seasons.toFixed(1)), v => v < 10,
  "a bust should be out of the league in single digits, not last 15+ years");
check("Draft-Bust career never runs the full 15-20",
  bust.maxSeasons, v => v <= 12);

const mid = simN(62, 62, 400);
console.log(`  (mid build: OVR ${mid.ovr}, seasons ${mid.seasons.toFixed(1)} [${mid.minSeasons}-${mid.maxSeasons}])`);
check("mediocre build lands mid-length, between bust and great",
  Number(mid.seasons.toFixed(1)), v => v > bust.seasons && v < 16);

const great = simN(95, 95, 400);
console.log(`  (great build: OVR ${great.ovr}, seasons ${great.seasons.toFixed(1)} [${great.minSeasons}-${great.maxSeasons}], ROTY rate ${(100 * great.rotyRate).toFixed(0)}%)`);
check("strong build still gets the full-length career",
  Number(great.seasons.toFixed(1)), v => v >= 15,
  "great players must still go the distance (15-20)");
check("strong build career length stays within 15-20",
  `${great.minSeasons}-${great.maxSeasons}`, v => great.minSeasons >= 15 && great.maxSeasons <= 20);

console.log("\n=== ROTY NEEDS A STANDOUT ROOKIE SEASON ===");

// ROTY keys on the rookie's actual box score (rotyRoll), not raw OVR. A debut with
// real standout production in some category wins it often; a debut that is merely
// respectable everywhere — the `mid` build is ~10 PPG / 7.6 RPG / 5.4 APG — should
// NOT, which is the whole point of the retune. It used to convert ~86% of the time.
check("standout rookie season wins ROTY most years",
  Number(great.rotyRate.toFixed(2)), v => v >= 0.7,
  "a genuinely standout rookie year should convert ~70-90% of the time");
check("unremarkable rookie season rarely wins ROTY",
  Number(mid.rotyRate.toFixed(2)), v => v <= 0.25,
  "single-digit-PPG debuts with no standout category are not ROTY winners");
check("bust-level rookie season rarely wins ROTY",
  Number(bust.rotyRate.toFixed(2)), v => v <= 0.15,
  "a genuinely bad debut should be near-zero, not a coin flip");

// ---------------------------------------------------------------------------
console.log("\n=== ALL-STAR TRACKS STAR PRODUCTION, NOT RAW OVR ===");

// All-Star was a bare `ovr >= 70` gate, so a build that was good everywhere and
// great nowhere made it EVERY season (overall OVR bakes in Defense 0.18 +
// Rebounding 0.14). It now runs off the season box score — the same reason All-NBA
// had to move — so a low-volume all-rounder collects few nods while a real scorer
// still makes it nearly every year.
console.log(`  (mid build: ${mid.ppg.toFixed(1)} PPG, All-Star ${mid.allStars.toFixed(1)} of ${mid.seasons.toFixed(1)} seasons)`);
console.log(`  (great build: ${great.ppg.toFixed(1)} PPG, All-Star ${great.allStars.toFixed(1)} of ${great.seasons.toFixed(1)} seasons)`);
check("low-volume all-rounder does NOT make All-Star most seasons",
  Number((mid.allStars / mid.seasons).toFixed(2)), v => v <= 0.25,
  "good-at-everything/great-at-nothing is a role player, not a perennial All-Star");
check("genuine star scorer still makes All-Star nearly every season",
  Number((great.allStars / great.seasons).toFixed(2)), v => v >= 0.8,
  "the fix must not overcorrect — real stars keep their nods");

// ---------------------------------------------------------------------------
console.log("\n=== BACK NAVIGATION (step back one screen) ===");
// Back steps to the previous screen without resetting the build. The screen it
// lands on must be re-pickable, which for an attribute pick means the old pick
// is refunded and cleared — otherwise lockSkill/lockPhysical would charge the
// new pick ON TOP of the old one.

const S = G.state;
const resetState = () => {
  S.height = null; S.athleticism = null; S.skills = {};
  S.budgetSpent = 0; S.activeBadges = []; S.scoutTeam = null;
  S.sandbox = false; S.autoPick = false;
};
const opt = (name, cost, rating) => ({ name, era: "modern", label: null, rating, cost, team: G.TEAMS[0] });

resetState();
G.lockPhysical("height", opt("Tall Guy", 12, 80));
G.lockSkill("shooting", opt("Shooter", 20, 85));
check("budget accumulates over two picks", S.budgetSpent, 32);

const removed = G.unlockPick("shooting");
check("unlockPick returns the pick it removed", removed && removed.name, "Shooter");
check("unlockPick refunds that pick's cost only", S.budgetSpent, 12);
check("unlockPick clears the skill slot", G.currentPick("shooting"), undefined);
check("unlockPick leaves other picks alone", G.currentPick("height").name, "Tall Guy");

// The whole point: re-picking after a back must not stack on the old cost.
G.lockSkill("shooting", opt("Cheaper Shooter", 5, 70));
check("re-pick after back charges only the new cost", S.budgetSpent, 17,
  "12 (height) + 5 (new shooting), NOT 12 + 20 + 5");

// Physical slots use state[key], not state.skills — same contract.
G.unlockPick("height");
check("unlockPick refunds a physical pick", S.budgetSpent, 5);
check("unlockPick clears the physical slot", G.currentPick("height"), null);

// Backing out of a slot that was never filled must be a no-op, not a negative
// refund (reachable if Back is pressed twice quickly).
const before = S.budgetSpent;
check("unlockPick on an empty slot is a no-op", G.unlockPick("finishing"), null);
check("no-op unlock does not move the budget", S.budgetSpent, before);

// Backing past a trait pick drops that trait's activation with it.
resetState();
const traitKey = Object.keys(G.TRAIT_BADGES)[0];
const [tName, tCat] = traitKey.split("|");
G.lockSkill(tCat, opt(tName, 10, 88));
S.activeBadges = [traitKey, "Someone Else|Handles"];
check("the trait pick really carries a badge", G.acquiredBadges().length, 1);
G.unlockPick(tCat);
check("unlockPick drops the removed pick's badge activation",
  S.activeBadges.join(","), "Someone Else|Handles",
  "an activation pointing at a pick that no longer exists is dead state");
resetState();

// --- which step Back lands on ---
const idx = name => G.STEPS.indexOf(name);
resetState();
check("Back is hidden on the first screen of a run", G.backTargetStep(idx("shadow")), -1,
  "shadow is the first in-flow screen; its 'previous' is Home, which is the Home button's job");
check("Back is hidden once the career is simulating", G.backTargetStep(idx("simulating")), -1);
check("Back is hidden on the verdict", G.backTargetStep(idx("verdict")), -1);
check("Back from Name returns to shadow-target select",
  G.STEPS[G.backTargetStep(idx("name"))], "shadow");
check("Back from the first attribute returns to Name",
  G.STEPS[G.backTargetStep(idx("height"))], "name");
check("Back from Position skips the auto-skipped badge screen",
  G.STEPS[G.backTargetStep(idx("position"))], G.SKILL_ORDER[G.SKILL_ORDER.length - 1],
  "chooseBadges self-advances with <2 traits, so landing on it would bounce straight forward again");
check("Back from Confirm returns to Career Team",
  G.STEPS[G.backTargetStep(idx("confirm"))], "careerTeam");

// With enough traits to force a real choice, the badge screen IS a real screen
// and Back must land on it rather than skipping past.
resetState();
// One badge per category — badges sharing a category would occupy one slot
// and acquire just one trait.
const traitKeys = [];
const seenCats = new Set();
for (const k of Object.keys(G.TRAIT_BADGES)) {
  const cat = k.split("|")[1];
  if (seenCats.has(cat)) continue;
  seenCats.add(cat);
  traitKeys.push(k);
  if (traitKeys.length === 3) break;
}
traitKeys.forEach(k => {
  const [name, cat] = k.split("|");
  G.lockSkill(cat, opt(name, 0, 80));
});
check("test setup really acquired 3 traits", G.acquiredBadges().length, 3);
check("Back from Position stops at the badge screen when a choice is pending",
  G.STEPS[G.backTargetStep(idx("position"))], "chooseBadges",
  `${traitKeys.length} traits acquired vs a cap of 2 means the screen actually renders`);
resetState();

// ---------------------------------------------------------------------------
console.log("\n=== NO-BUDGET MODE: full roster list + no repeats ===");
// The team-spin no-budget mode now shows the same full roster list as Salary
// Cap, minus the cost column, and forbids reusing a player across the 8 picks.
// usedPickNames drives that exclusion; the list is getRosterOptions filtered by
// it. (Salary Cap and Sandbox never filter — repeats are allowed there.)

const S2 = G.state;
const resetNB = () => {
  S2.height = null; S2.athleticism = null; S2.skills = {};
  S2.budgetSpent = 0; S2.sandbox = false; S2.autoPick = true;
  S2.scoutTeam = G.TEAMS[0];
};
const opt2 = (name, cost) => ({ name, era: "modern", label: null, rating: 80, cost, team: G.TEAMS[0] });

resetNB();
check("usedPickNames is empty on a fresh build", G.usedPickNames().length, 0);

G.lockSkill("Shooting", opt2("Ray Allen", 0));
G.lockPhysical("height", opt2("Yao Ming", 0));
check("usedPickNames lists every locked player", G.usedPickNames().sort().join(","), "Ray Allen,Yao Ming");
check("usedPickNames can exclude the category being re-picked",
  G.usedPickNames("Shooting").join(","), "Yao Ming",
  "the slot you're picking must not exclude its own prior occupant from its own list");

// The list a category shows = the scouted team's roster minus used names.
// Fresh build so the only used name is the one guaranteed to be on this team
// (the earlier picks used fabricated names that could coincide with a roster).
resetNB();
const team = G.TEAMS.find(t => (G.TEAM_ROSTERS[t.abbr] || []).length > 0);
S2.scoutTeam = team;
const full = G.getRosterOptions("Finishing", team);
const someoneOnTeam = full[0].name;
G.lockSkill("Playmaking", opt2(someoneOnTeam, 0)); // now used in another category
const used = new Set(G.usedPickNames("Finishing"));
const filtered = full.filter(o => !used.has(o.name));
check("a player used elsewhere drops out of a later list",
  filtered.some(o => o.name === someoneOnTeam), false);
check("filtering removes exactly the used player, nothing else",
  full.length - filtered.length, 1);

// No-budget picks carry cost 0, so budgetSpent never moves in this mode.
resetNB();
G.lockSkill("Shooting", opt2("Free Pick", 0));
G.lockPhysical("athleticism", opt2("Another", 0));
check("no-budget picks leave budgetSpent at zero", S2.budgetSpent, 0);

// Even the smallest roster can't be fully exhausted by 7 prior picks, so a
// filtered list is always non-empty — the mode can never dead-end on a spin.
const minRoster = Math.min(...Object.values(G.TEAM_ROSTERS).map(r => r.length));
check("smallest roster outnumbers the max prior picks", minRoster > 7, true,
  `smallest roster is ${minRoster}; at most 7 players are locked before the last pick`);

S2.autoPick = false; S2.scoutTeam = null; // leave global state clean for later sections

// ---------------------------------------------------------------------------
console.log("\n=== NO-BUDGET MODE: no-repeat teams (the wheel) ===");
// The team wheel draws from availableTeams — all 30 minus teams already locked
// in other picks — so it visibly shrinks 30 -> 23 across the 8 picks and never
// lands on a team twice. Derived from the picks, so Back frees a team for free.

const S3 = G.state;
const resetTeams = () => {
  S3.height = null; S3.athleticism = null; S3.skills = {};
  S3.budgetSpent = 0; S3.sandbox = false; S3.autoPick = true; S3.scoutTeam = null;
};
const onTeam = (name, abbr) => ({ name, era: "modern", label: null, rating: 80, cost: 0,
  team: G.TEAMS.find(t => t.abbr === abbr) });

resetTeams();
check("wheel starts with all 30 teams", G.availableTeams().length, 30);
check("no teams used on a fresh build", G.usedTeamAbbrs().length, 0);

// Lock 7 picks, each from a DISTINCT team, and watch the pool shrink.
const abbrs = G.TEAMS.slice(0, 7).map(t => t.abbr);
G.lockPhysical("height", onTeam("A", abbrs[0]));
G.lockPhysical("athleticism", onTeam("B", abbrs[1]));
G.lockSkill("Shooting", onTeam("C", abbrs[2]));
G.lockSkill("Finishing", onTeam("D", abbrs[3]));
G.lockSkill("Playmaking", onTeam("E", abbrs[4]));
G.lockSkill("Handles", onTeam("F", abbrs[5]));
G.lockSkill("Defense", onTeam("G", abbrs[6]));
check("7 distinct teams are now used", G.usedTeamAbbrs().length, 7);
check("wheel for pick 8 is down to 23 teams", G.availableTeams("Rebounding").length, 23);
check("a used team is not on the wheel",
  G.availableTeams("Rebounding").some(t => t.abbr === abbrs[0]), false);

// exceptCategory: the slot being re-picked must keep its own team on the wheel,
// or Back-then-respin could never re-land the team it just left.
check("the re-picked category's own team stays available",
  G.availableTeams("Shooting").some(t => t.abbr === abbrs[2]), true);
check("but it is still excluded for a DIFFERENT category",
  G.availableTeams("Rebounding").some(t => t.abbr === abbrs[2]), false);

// Back frees a team: unlockPick removes the pick, so its team returns to the pool.
G.unlockPick("Defense");
check("unlocking a pick frees its team back onto the wheel",
  G.availableTeams("Rebounding").some(t => t.abbr === abbrs[6]), true);
check("used-team count drops after unlock", G.usedTeamAbbrs().length, 6);

// A team appearing in no pick is always available; picks with no .team (shouldn't
// happen in this mode, but be defensive) don't poison the set.
resetTeams();
check("availableTeams ignores picks that carry no team", (() => {
  S3.skills["Shooting"] = { name: "X", rating: 80, cost: 0 }; // no .team
  const ok = G.availableTeams().length === 30;
  S3.skills = {};
  return ok;
})(), true);

resetTeams();
S3.autoPick = false; // leave global state clean for later sections

// ---------------------------------------------------------------------------
console.log("\n=== NO-BUDGET MODE: player spinner free stat choice ===");
// After the team wheel, the mode spins ONE player and lets you take ANY of that
// player's 8 ratings into the current slot — off-category included. buildStatPick
// builds the locked pick; physicalBandLabel keeps a physical slot's descriptor in
// step with the number that fills it; spinnablePlayers enforces no player repeats.

const S4 = G.state;
const resetSpin = () => {
  S4.height = null; S4.athleticism = null; S4.skills = {};
  S4.budgetSpent = 0; S4.sandbox = false; S4.autoPick = true; S4.scoutTeam = null;
};
resetSpin();

// A real player with a known spread of ratings to reason about.
const team0 = G.TEAMS[0];
const P = G.TEAM_ROSTERS[team0.abbr].reduce((a, b) => (b.skills.Playmaking > a.skills.Playmaking ? b : a));

// physicalBandLabel: nearest band, and it agrees with the source data at exact ratings.
check("physicalBandLabel snaps height 90 to a 7-foot band", G.physicalBandLabel("height", 90), "7'1\"");
check("physicalBandLabel snaps athleticism 95 to Elite", G.physicalBandLabel("athleticism", 95), "Elite");
check("physicalBandLabel picks the NEAREST band for an in-between rating",
  ["6'0\"","6'1\""].includes(G.physicalBandLabel("height", 34)), true,
  "34 sits between the 32->6'0\" and 36->6'1\" bands");

// buildStatPick — the free, off-category choice. Take the player's PLAYMAKING
// rating but drop it into the HEIGHT slot.
const hp = G.buildStatPick(P, team0, "height", "Playmaking");
check("off-category pick takes the CHOSEN stat's rating", hp.rating, P.skills.Playmaking);
check("off-category pick records which stat was chosen", hp.chosenStat, "Playmaking");
check("a physical slot synthesises a band from the chosen rating",
  hp.label, G.physicalBandLabel("height", P.skills.Playmaking));
check("no-budget spinner pick costs nothing", hp.cost, 0);
check("the pick carries the scouted team", hp.team.abbr, team0.abbr);

// Filling a SKILL slot carries no band label, exactly like a normal skill pick.
const sp = G.buildStatPick(P, team0, "Shooting", "Defense");
check("skill slot pick has no band label", sp.label, null);
check("skill slot still takes the chosen (Defense) rating", sp.rating, P.skills.Defense);

// On-category is just the normal case of the same call.
const onCat = G.buildStatPick(P, team0, "athleticism", "athleticism");
check("on-category pick takes the matching rating", onCat.rating, P.athleticism.rating);

// spinnablePlayers — no player repeats across picks.
resetSpin();
check("a fresh team offers its whole roster", G.spinnablePlayers(team0).length,
  G.TEAM_ROSTERS[team0.abbr].length);
// Lock one of team0's players into a slot, then that name is off the spinner.
const someone = G.TEAM_ROSTERS[team0.abbr][0].name;
G.lockSkill("Shooting", { name: someone, era: "x", rating: 80, cost: 0, team: team0 });
check("a used player drops out of later spins",
  G.spinnablePlayers(team0, "Finishing").some(p => p.name === someone), false);
check("excluding the current slot keeps its own player spinnable",
  G.spinnablePlayers(team0, "Shooting").some(p => p.name === someone), true);

resetSpin();
S4.autoPick = false; // leave global state clean for later sections

// ---------------------------------------------------------------------------
console.log("\n=== NO-BUDGET MODE: free-for-all fill order ===");
// The 8 attribute picks become an order-free loop: any spin can fill any OPEN
// slot. state.pickOrder records the fill order so Back re-opens the slot that
// was actually filled last, not the round's step category. Already-filled slots
// drive the card's disable rule via currentPick(cat).

const S5 = G.state;
const resetFF = () => {
  S5.height = null; S5.athleticism = null; S5.skills = {};
  S5.budgetSpent = 0; S5.sandbox = false; S5.autoPick = true; S5.scoutTeam = null;
  S5.pickOrder = [];
};
const team0FF = G.TEAMS[0];
const pk = (cat) => {
  const p = G.TEAM_ROSTERS[team0FF.abbr].find(x => !G.usedPickNames().includes(x.name));
  const pick = G.buildStatPick(p, team0FF, cat, cat);
  if (cat === "height" || cat === "athleticism") G.lockPhysical(cat, pick); else G.lockSkill(cat, pick);
  S5.pickOrder.push(cat);
  return pick;
};

resetFF();
// Fill slots OUT of the fixed step order: Playmaking, then Height, then Defense.
pk("Playmaking"); pk("height"); pk("Defense");
check("pickOrder records fills in the order they happened",
  S5.pickOrder.join(","), "Playmaking,height,Defense");
check("filled slots are detectable regardless of order (Playmaking)", !!G.currentPick("Playmaking"), true);
check("filled slots are detectable regardless of order (height)", !!G.currentPick("height"), true);
check("an untouched slot reads open", !!G.currentPick("Shooting"), false);

// Back = pop the LAST-filled slot and free it (NOT the step's category).
const last = S5.pickOrder.pop();
G.unlockPick(last);
check("Back frees the last-filled slot", last, "Defense");
check("the freed slot is open again", !!G.currentPick("Defense"), false);
check("earlier out-of-order fills are untouched by Back", !!G.currentPick("Playmaking"), true);
check("pickOrder shrinks by one on Back", S5.pickOrder.join(","), "Playmaking,height");

// A physical slot filled on-category takes that player's real band + rating.
resetFF();
const someHt = G.TEAM_ROSTERS[team0FF.abbr][0];
const hpick = G.buildStatPick(someHt, team0FF, "height", "height");
check("on-category height fill takes the player's height rating", hpick.rating, someHt.height.rating);
check("on-category height fill's band matches the player's height",
  hpick.label, G.physicalBandLabel("height", someHt.height.rating));

resetFF();
S5.autoPick = false; S5.pickOrder = []; // leave global state clean for later sections

// ---------------------------------------------------------------------------
console.log("\n=== NO-BUDGET MODE: no-repeat holds on every round ===");
// REGRESSION: the free-for-all loop reuses the 8 attribute STEPS entries as
// round counters, so a round's step category has NOTHING to do with which slot
// gets filled. Passing it as availableTeams/spinnablePlayers' exceptCategory
// therefore re-admitted whatever team+player was locked in the slot that step
// happens to name, letting a team repeat and a player fill TWO slots (reachable
// because 95 players sit on more than one team's roster). The Classic paths must
// except nothing — Back clears a slot via unlockPick before re-rendering, so
// there is never a slot needing to be excused from its own filter.

const S6 = G.state;
S6.height = null; S6.athleticism = null; S6.skills = {};
S6.budgetSpent = 0; S6.pickOrder = []; S6.sandbox = false; S6.autoPick = true;

const bosT = G.TEAMS.find(t => t.abbr === "BOS");
const russell = G.TEAM_ROSTERS["BOS"].find(p => p.name === "Bill Russell");
G.lockSkill("Playmaking", G.buildStatPick(russell, bosT, "Playmaking", "Playmaking"));
S6.pickOrder.push("Playmaking");

check("a locked team is off the wheel on EVERY round, including its own step's",
  G.availableTeams().some(t => t.abbr === "BOS"), false);
check("a locked player is unspinnable on EVERY round, including its own step's",
  G.spinnablePlayers(bosT).some(p => p.name === "Bill Russell"), false);
// The old buggy call shape, pinned so it can't quietly come back as the default.
check("excepting the filled slot WOULD re-admit it (why Classic must not)",
  G.availableTeams("Playmaking").some(t => t.abbr === "BOS"), true,
  "exceptCategory is only correct for the sequential modes, where step == slot");

S6.height = null; S6.athleticism = null; S6.skills = {};
S6.pickOrder = []; S6.autoPick = false; // leave global state clean

// ############################################################################
console.log("\n=== STARTING FIVES -> SUPPORTING CAST RATING ===");
//
// The career-team screen shows a concrete starting five instead of an opaque SCR.
// effectiveScr() is the ONLY bridge between the two, so these cases pin the
// arithmetic the player can verify by eye off the five rows.
//
// THE MIGRATION IS COMPLETE — all 30 teams have a five and the placeholder path
// is gone. These used to assert that un-migrated teams kept their hand-authored
// TEAMS[].scr; that set is now empty, so those cases were REPLACED (not deleted)
// with the completeness invariant below. Do not reintroduce a "some teams have no
// five" branch without also restoring a real check that it behaves.
// ############################################################################

const MIGRATED = G.TEAMS.map(t => t.abbr);   // all 30, by construction

MIGRATED.forEach(abbr => {
  check(`${abbr} has a starting five`, G.hasStartingFive(abbr), true);
  const five = G.teamFive(abbr);
  check(`${abbr} five has exactly 5 rows`, five.length, 5);
  check(`${abbr} five covers PG..C exactly once`,
    five.map(p => p.pos).join(","), Object.keys(G.POSITIONS).join(","));
  // Plain mean, rounded — the transparent definition, recomputed here independently.
  const mean = Math.round(five.reduce((a, p) => a + p.rating, 0) / 5);
  check(`${abbr} team rating is the plain rounded mean of the five`,
    G.teamRatingFromFive(abbr), mean);
  check(`${abbr} weakest slot is its lowest-rated starter`,
    G.weakestSlot(abbr),
    five.reduce((lo, p) => (p.rating < lo.rating ? p : lo)).pos);
  check(`${abbr} effectiveScr is inside the 25-90 SCR scale`,
    G.effectiveScr(abbr), v => v >= 25 && v <= 90);
  check(`${abbr} need position comes from the visible lineup, not history`,
    G.teamNeedPosition(abbr), G.weakestSlot(abbr));
});

// THE COMPLETENESS INVARIANT. game.js throws at load if this is violated, so a
// failure here means the module did not even load — but assert it explicitly so
// the reason is named rather than surfacing as a mystery stack trace.
check("all 30 teams have a starting five (no placeholder path remains)",
  G.TEAMS.filter(t => G.hasStartingFive(t.abbr)).length, 30);
check("TEAM_NEEDS is gone from the public surface", G.TEAM_NEEDS, undefined);
// The removed fallback must not creep back as a silent default: every team's SCR
// has to be derivable from its five, and must NOT coincidentally equal the legacy
// hand-authored value everywhere (which would mean the five is being ignored).
check("every team's SCR is the mapped value, not its legacy scr",
  G.TEAMS.every(t => G.effectiveScr(t.abbr) ===
    Math.max(25, Math.min(90, Math.round(G.SCR_BASE + (G.teamRatingFromFive(t.abbr) - G.FIVE_ANCHOR) * G.SCR_SLOPE)))), true);
check("the mapping actually moved most teams off their legacy scr",
  G.TEAMS.filter(t => G.effectiveScr(t.abbr) !== t.scr).length, n => n >= 20);
// No duplicate players across fives — the same starter on two teams would be a
// copy/paste slip in the data, and this catches it the moment a division lands.
{
  const all = MIGRATED.flatMap(a => G.teamFive(a).map(p => p.name));
  const dupes = all.filter((n, i) => all.indexOf(n) !== i);
  check("no player appears in two teams' starting fives", dupes.join(",") || "none", "none");
  check("every rating is a sane integer on the 0-99 scale",
    MIGRATED.every(a => G.teamFive(a).every(p =>
      Number.isInteger(p.rating) && p.rating >= 40 && p.rating <= 99)), true);
}

// projectedRatingWith must move ONE slot. This is the number the screen promises.
const lalFive = G.teamFive("LAL");
const lalBase = G.teamRatingFromFive("LAL");
check("projectedRatingWith swaps only the target slot",
  G.projectedRatingWith("LAL", "PF", 99),
  Math.round(lalFive.reduce((a, p) => a + (p.pos === "PF" ? 99 : p.rating), 0) / 5));
check("swapping a starter for his own rating is a no-op",
  G.projectedRatingWith("LAL", "PF", G.starterAt("LAL", "PF").rating), lalBase);
check("a worse player at the slot LOWERS the projection",
  G.projectedRatingWith("LAL", "PG", 40), v => v < lalBase);
// WAS used to be the standing example of a team with no five. It has one now, so
// these assert the real behaviour instead of the removed null path.
check("projectedRatingWith works for every team, including the weakest",
  G.projectedRatingWith("WAS", "PG", 99),
  Math.round(G.teamFive("WAS").reduce((a, p) => a + (p.pos === "PG" ? 99 : p.rating), 0) / 5));
check("starterAt returns the named starter at that slot",
  G.starterAt("SAC", "C").name, "Domantas Sabonis");
check("starterAt returns null only for a position that does not exist",
  G.starterAt("WAS", "XX"), null);

// The mapping itself: monotone, centred, and anchored to league-wide constants
// (not fitted to the Pacific five) so later divisions need no recalibration.
check("an average five maps to the league-mean SCR",
  Math.round(G.SCR_BASE + (G.FIVE_ANCHOR - G.FIVE_ANCHOR) * G.SCR_SLOPE), G.SCR_BASE);
const scrOrder = MIGRATED.map(a => [G.teamRatingFromFive(a), G.effectiveScr(a)])
  .sort((x, y) => x[0] - y[0]);
check("effectiveScr is monotone in team rating across the migrated teams",
  scrOrder.every((p, i) => i === 0 || p[1] >= scrOrder[i - 1][1]), true);

// simCareer must read SCR through effectiveScr. Pin it behaviourally: a migrated
// team whose five maps ABOVE its old hand-authored scr has to win more games.
check("LAL's five maps above its legacy scr (so the swap below is observable)",
  G.effectiveScr("LAL") > G.TEAMS_BY_ABBR["LAL"].scr, true);
{
  const winsWith = scr => { G.seedRng(4242); return G.simSeason(80, scr, 0).wins; };
  check("simSeason still pays 0.35 wins per SCR point",
    winsWith(80) - winsWith(60), Math.round(20 * 0.35));
}

// ############################################################################
console.log("\n=== COMP MATCH: TIER AND ARCHETYPE APPROPRIATENESS ===");
//
// REPORTED: a Bench Piece build (rebounding-first 7-foot centre, base OVR 68)
// matched Karl-Anthony Towns as its PRIMARY comp while its two "Shades of"
// picks were correctly bench-level, which read as the primary being scored by a
// different path. It is not — playstyleComp takes [0] and slice(1) of the SAME
// topComps list. Two real defects produced it, both pinned below:
//   1. compCaliber() priced a selection at 0.4 with a hardware-first score, so a
//      ringless 4x All-Star scored 2.2 and came out caliber 2. The caliber gate
//      then saw nothing to gate.
//   2. The gate was additive at weight 14 against attribute distances of 80-110.
// Fixed with selection floors in compCaliber, a hard admissibility partition in
// topComps, an archetype term, and six low-accolade specialist comps (the
// caliber<=2 pool was uniformly flat, so no same-level comp shared an elite trait).
// ############################################################################

function compBuild({ pos, h, a, sk }) {
  const S = G.state;
  S.sandbox = false; S.autoPick = true; S.activeBadges = [];
  S.position = pos; S.positionFit = true;
  S.height = { rating: h, label: "x" }; S.athleticism = { rating: a, label: "y" };
  S.skills = {}; Object.keys(sk).forEach(k => (S.skills[k] = { rating: sk[k] }));
  return G.computeOVR();
}
const compByName = n => G.COMP_PLAYERS.find(x => x.name === n);
const caliberOfName = n => G.compCaliber(G.accompOf(compByName(n)));

// --- the reported case, plus three other tier/archetype combinations ---
const COMP_CASES = [
  { label: "rebounding 7ft C", team: "IND", pos: "C", h: 96, a: 70,
    sk: { Shooting: 44, Finishing: 70, Playmaking: 44, Handles: 40, Defense: 45, Rebounding: 95 },
    sig: "Rebounding" },
  { label: "defensive 7ft C", team: "IND", pos: "C", h: 94, a: 66,
    sk: { Shooting: 40, Finishing: 60, Playmaking: 40, Handles: 38, Defense: 92, Rebounding: 78 },
    sig: "Defense" },
  { label: "shooting SG", team: "IND", pos: "SG", h: 48, a: 60,
    sk: { Shooting: 93, Finishing: 58, Playmaking: 50, Handles: 62, Defense: 44, Rebounding: 38 },
    sig: "Shooting" },
  { label: "passing PG", team: "IND", pos: "PG", h: 30, a: 62,
    sk: { Shooting: 50, Finishing: 56, Playmaking: 94, Handles: 80, Defense: 48, Rebounding: 36 },
    sig: "Playmaking" },
];

COMP_CASES.forEach(c => {
  const ovr = compBuild(c);
  const team = G.TEAMS_BY_ABBR[c.team];
  G.state.team = team; G.state.teamNeedMet = false;
  let tierBad = 0, archBad = 0, runs = 0, sample = null;
  for (let s = 1; s <= 60; s++) {
    G.seedRng(s);
    const career = G.simCareer(ovr, team, {});
    const rank = G.tierRank(career);
    const all = [G.playstyleComp(career).name, ...G.playstyleComp(career).shades];
    runs++;
    // EVERY returned comp — primary and shades alike — must clear the same gate.
    all.forEach(n => { if (caliberOfName(n) - rank - 1 > 0) tierBad++; });
    // Archetype: the primary must not be DEFINED by a skill this build lacks.
    const primary = compByName(all[0]);
    const psig = G.signatureOfDims(primary.dims);
    if (psig.distinctive && primary.dims[psig.attr] - G.buildProfile()[psig.attr] > 30) archBad++;
    if (!sample) sample = { tier: G.tierForCareer(career).name, primary: all[0], shades: all.slice(1) };
  }
  check(`${c.label}: no comp (primary OR shades) exceeds the build's tier band`, tierBad, 0);
  check(`${c.label}: primary is never defined by a skill the build lacks`, archBad, 0);
  check(`${c.label}: primary is a real ${c.sig}-first player`,
    G.signatureOfDims(compByName(sample.primary).dims).attr, c.sig,
    `${sample.tier} -> ${sample.primary} (shades ${sample.shades.join(", ")})`);
});

// The specific regression: Towns must be unreachable for a low-tier build, and
// must STILL be reachable for the build he genuinely fits (an All-Star shooting
// big). The fix gates him to the right level rather than removing him.
check("Towns is caliber 3, not the caliber 2 that let him through",
  caliberOfName("Karl-Anthony Towns"), 3);
check("selection floors did not disturb the top of the caliber scale",
  ["Michael Jordan", "Magic Johnson", "Kareem Abdul-Jabbar"].every(n => caliberOfName(n) === 6), true);
check("a zero-accolade journeyman is still caliber 1", caliberOfName("Jason Smith"), 1);
{
  const ovr = compBuild({ pos: "PF", h: 82, a: 70,
    sk: { Shooting: 93, Finishing: 88, Playmaking: 62, Handles: 64, Defense: 60, Rebounding: 86 } });
  const team = G.TEAMS_BY_ABBR["OKC"];
  G.state.team = team; G.state.teamNeedMet = true;
  G.seedRng(7);
  const career = G.simCareer(ovr, team, {});
  check("an All-Star elite-shooting big still comps to Towns (gated, not removed)",
    G.playstyleComp(career).name, "Karl-Anthony Towns",
    `tier ${G.tierForCareer(career).name}`);
}
// The added specialists must be low-caliber AND carry a genuinely elite trait —
// that combination is what the pool was missing.
["Reggie Evans", "Bismack Biyombo", "Tony Allen", "JJ Redick", "Andre Miller", "Chuck Hayes"]
  .forEach(n => {
    check(`${n} is an admissible low-tier comp`, caliberOfName(n), v => v <= 2);
    check(`${n} has a distinctive signature skill`,
      G.signatureOfDims(compByName(n).dims).distinctive, true);
  });

G.state.height = null; G.state.athleticism = null; G.state.skills = {}; G.state.autoPick = false;

// ############################################################################
console.log("\n=== ALL-STAR THRESHOLD: SOLID STARTERS MUST NOT CLEAR ===");
//
// REPORTED TWICE. First: a build averaging under 10 PPG made All-Star in 11 of 14
// seasons. Second (this suite's reason for existing): 14.8 PPG / 9.1 RPG / 3 APG /
// 0.8 SPG / 0.3 BPG cleared it. Both came through the SAME door, which is why the
// second read as a recurrence rather than a new bug.
//
// The first fix moved eligibility off raw OVR onto a scoring-weighted box-score
// case, and that held — the scoring path gives both lines ~0%. What it left open
// was the DEFENSIVE SIGNATURE: All-Defensive is decided in simSeason from the
// build's CONSTANT Defense rating, never the box score, and the All-Star check
// then paid a flat 0.45 for a 1st-team nod. So any build with Defense 93+ drew a
// 45% All-Star roll every season regardless of production.
//
// These cases are deterministic — they assert allStarCase().odds, not a roll — so
// they cannot flake and cannot be "fixed" by reseeding.
// ############################################################################
{
  const line = o => Object.assign({ ppg: 0, apg: 0, rpg: 0, spg: 0, bpg: 0, tpg: 0, fgPct: 50, tptPct: 33 }, o);
  const odds = (stats, wins, allD) => G.allStarCase(stats, wins, allD).odds;

  // --- the exact reported season, through every door it could take ---
  const REPORTED = line({ ppg: 14.8, rpg: 9.1, apg: 3, spg: 0.8, bpg: 0.3 });
  check("14.8/9.1/3 on a 45-win team is not an All-Star", odds(REPORTED, 45, null), v => v <= 0.02);
  check("14.8/9.1/3 on a 55-win team is not an All-Star", odds(REPORTED, 55, null), v => v <= 0.02);
  check("14.8/9.1/3 + All-Defensive 2nd is still not an All-Star",
    odds(REPORTED, 50, "2nd"), v => v <= 0.05);
  check("14.8/9.1/3 + All-Defensive 1st is still not an All-Star — THE LEAK",
    odds(REPORTED, 50, "1st"), v => v <= 0.05,
    "a 1st-team All-D nod off the constant Defense rating used to pay a flat 45%");

  // --- the earlier report, kept so the first bug cannot come back either ---
  const EARLIER = line({ ppg: 9.5, rpg: 8.7, apg: 7, spg: 1.1, bpg: 0.6 });
  check("sub-10 PPG all-rounder is not an All-Star", odds(EARLIER, 50, null), v => v <= 0.02);
  check("sub-10 PPG all-rounder + All-Defensive 1st is not an All-Star",
    odds(EARLIER, 50, "1st"), v => v <= 0.05);

  // --- a solid starter is a solid starter ---
  check("16 PPG / 7 RPG solid starter is not an All-Star",
    odds(line({ ppg: 16, rpg: 7, apg: 3 }), 48, null), v => v <= 0.05);

  // --- DO NOT OVERCORRECT: genuine stars must still clear comfortably ---
  check("a 25 PPG scorer is comfortably an All-Star",
    odds(line({ ppg: 25, rpg: 6, apg: 4 }), 50, null), v => v >= 0.75);
  check("a 20 PPG / 5 APG season is a coin-flip All-Star or better",
    odds(line({ ppg: 20, rpg: 6, apg: 5 }), 50, null), v => v >= 0.40);
  check("18 PPG with REAL elite defence (2.4 BPG / 1.7 SPG) clears on the signature",
    odds(line({ ppg: 18, rpg: 11, apg: 2, spg: 1.7, bpg: 2.4 }), 50, "1st"), v => v >= 0.30);
  check("a 14 RPG dominant rebounder clears without scoring",
    odds(line({ ppg: 9, rpg: 14, apg: 1.5, spg: 0.8, bpg: 1.4 }), 45, null), v => v >= 0.25);
  check("an 11 APG lead playmaker clears without scoring",
    odds(line({ ppg: 11, rpg: 4, apg: 11, spg: 1.4 }), 45, null), v => v >= 0.45);

  // --- the mechanism itself: production, not the nod, drives the defence case ---
  check("defensive production is 0 for a 0.3 BPG / 0.8 SPG season",
    G.allStarDefProduction(REPORTED), 0);
  check("defensive production is substantial for a 2.4 BPG / 1.7 SPG season",
    G.allStarDefProduction(line({ ppg: 18, rpg: 11, spg: 1.7, bpg: 2.4 })), v => v >= 0.6);
  check("two seasons with the same All-D nod but different production score differently",
    odds(line({ ppg: 14, rpg: 11, spg: 1.8, bpg: 2.6 }), 50, "1st") >
    odds(line({ ppg: 14, rpg: 11, spg: 0.6, bpg: 0.2 }), 50, "1st"), true);
  check("the scoring floor is the live constant", G.ALLSTAR_Q_FLOOR, v => v >= 16);
}

// ############################################################################
console.log("\n=== CROSS-SYSTEM: AWARD COUNTS MUST AGREE WITH THE PEAK-OVR BAND ===");
//
// REPORTED: a build with Peak OVR 76 — correctly capped at Starter by the
// published band — collected 10 All-Star selections. The tier ladder and the
// awards were reading different axes and never had to agree.
//
// This was NOT the All-Star threshold being loose again. Those seasons averaged
// 19.5 PPG / 7.8 RPG / 6.8 APG, which genuinely is All-Star-calibre, and the box
// score is on-curve for the OVR. The awards simply never learned that the tier
// ladder had already called this player a Starter. allStarBandFactor now damps
// selection for any season below TIER_OVR_FLOORS["All-Star"], anchored on the
// SAME constants the tier system uses so the two cannot drift apart again.
//
// NOTE the axis: this asserts on PEAK-OVR BAND, not on tier NAME. A career can be
// tiered Starter while peaking at 80+ (the band is a ceiling, not a guarantee) —
// conditioning on the tier name would fold those in and test the wrong thing.
// ############################################################################
function careersFor({ pos, h, a, sk, team = "IND", seeds = 400 }) {
  const S = G.state;
  S.sandbox = false; S.autoPick = true; S.activeBadges = [];
  S.position = pos; S.positionFit = true;
  S.height = { rating: h, label: "x" }; S.athleticism = { rating: a, label: "y" };
  S.skills = {}; Object.keys(sk).forEach(k => (S.skills[k] = { rating: sk[k] }));
  const t = G.TEAMS_BY_ABBR[team]; S.team = t; S.teamNeedMet = true;
  const ovr = G.computeOVR(); const out = [];
  for (let s = 1; s <= seeds; s++) { G.seedRng(s); out.push(G.simCareer(ovr, t, {})); }
  return out;
}
{
  const BALANCED_WING = { pos: "SF", h: 62, a: 78, sk: { Shooting: 76, Finishing: 78, Playmaking: 70, Handles: 74, Defense: 72, Rebounding: 66 } };
  const BALANCED_BIG = { pos: "C", h: 88, a: 74, sk: { Shooting: 72, Finishing: 78, Playmaking: 66, Handles: 64, Defense: 74, Rebounding: 80 } };
  const ELITE = { pos: "SG", h: 52, a: 88, team: "OKC", sk: { Shooting: 92, Finishing: 93, Playmaking: 76, Handles: 92, Defense: 74, Rebounding: 56 } };
  const inBand = (cs, lo, hi) => cs.filter(c => c.peakOVR >= lo && c.peakOVR < hi);

  const wing = careersFor(BALANCED_WING), big = careersFor(BALANCED_BIG), elite = careersFor(ELITE);
  const starterBand = inBand(wing, 0, 80).concat(inBand(big, 0, 80));
  check("produced Starter-band (peak < 80) careers to test", starterBand.length, v => v > 0);
  check("a Starter-band career NEVER earns 10 All-Stars — the reported case",
    Math.max(...starterBand.map(c => c.allStars)), v => v < 10);
  check("a Starter-band career earns at most 3 All-Stars",
    Math.max(...starterBand.map(c => c.allStars)), v => v <= 3);
  check("most Starter-band careers earn 0-1 All-Stars",
    starterBand.filter(c => c.allStars <= 1).length / starterBand.length, v => v >= 0.5);

  // An All-Star-band build must not post MVP-calibre hardware.
  const asBand = inBand(wing, 80, 85).concat(inBand(big, 80, 85));
  check("produced All-Star-band (peak 80-84) careers to test", asBand.length, v => v > 0);
  check("an All-Star-band career never wins an MVP", Math.max(...asBand.map(c => c.mvps)), 0);
  // allNBAs counts every tier, not just 1st team — an All-Star-band player making
  // All-NBA 3rd most years is correct, so this bounds the total rather than
  // pretending selections should be rare.
  check("an All-Star-band career does not post a Superstar All-NBA haul",
    Math.max(...asBand.map(c => c.allNBAs)), v => v <= 16);

  // DO NOT OVERCORRECT — a genuine star must still collect selections.
  const eliteBand = elite.filter(c => c.peakOVR >= 85);
  check("produced Superstar-band careers to test", eliteBand.length, v => v > 0);
  // Median, not min: selection is graded by band depth now, so a career peaking
  // right AT the Superstar floor legitimately collects far fewer than one peaking
  // at 95. The min across 400 careers is not the statistic that says "a star still
  // gets picked".
  const asCounts = eliteBand.map(c => c.allStars).sort((a, b) => a - b);
  check("a Superstar-band career still earns All-Stars at a star's rate (median)",
    asCounts[asCounts.length >> 1], v => v >= 8);

  // The mechanism, pinned to the tier system's own constants.
  // The factor no longer snaps to 1 at the band floor — it RAMPS across the band,
  // which is the reconciliation. Pin both ends of that ramp.
  check("the band factor opens at the All-Star floor, it does not saturate",
    G.allStarBandFactor(G.TIER_OVR_FLOORS["All-Star"]), v => v > 0.15 && v < 0.35);
  check("the band factor reaches full for a Legend-band season",
    G.allStarBandFactor(G.TIER_OVR_FLOORS["Legend"] + 2), v => v > 0.999);
  check("All-NBA opens lower than All-Star at the same OVR (15 slots vs ~24)",
    G.allNbaBandFactor(G.TIER_OVR_FLOORS["All-Star"]) < G.allStarBandFactor(G.TIER_OVR_FLOORS["All-Star"]), true);
  check("MVP is zero below the Superstar band",
    G.mvpBandFactor(G.TIER_OVR_FLOORS["Superstar"] - 1), 0);
  check("the band factor damps hard below it",
    G.allStarBandFactor(G.TIER_OVR_FLOORS["All-Star"] - 1), v => v <= 0.06);
  check("the band factor is anchored on TIER_OVR_FLOORS, not a private constant",
    G.allStarBandFactor(G.TIER_OVR_FLOORS["Starter"]), 0);
}

// ############################################################################
console.log("\n=== CALIBRATION: ONE OVR SCALE ACROSS STATS, AWARDS AND TIERS ===");
//
// Three systems used to disagree about what an OVR means. A Peak-83 build produced
// a 27.8/11.2/9.3 peak season, 14x All-NBA and 10x All-Star, yet tiered All-Star —
// the tier ladder was right and the other two were inflating. Measured before the
// reconciliation, OVR 85 already produced that all-time line, and All-Star/All-NBA
// saturated at every season from 85 up.
//
// This section is the tripwire. For each OVR it asserts the peak STAT LINE, the
// career AWARD COUNTS and the resulting TIER all land in the same band. If any one
// system is retuned in isolation later, the disagreement fails here immediately
// instead of arriving as another bug report under a new symptom.
// ############################################################################
function calibrationRow(targetOvr, seeds = 200) {
  const S = G.state;
  const set = sk => {
    S.sandbox = false; S.autoPick = true; S.activeBadges = [];
    S.position = "SF"; S.positionFit = true;
    S.height = { rating: 60, label: "x" }; S.athleticism = { rating: 75, label: "y" };
    S.skills = {}; G.SKILL_ORDER.forEach(k => (S.skills[k] = { rating: sk }));
    const t = G.TEAMS_BY_ABBR["OKC"]; S.team = t; S.teamNeedMet = true; return t;
  };
  let bestSk = 40, bestD = Infinity;
  for (let sk = 40; sk <= 99; sk++) { set(sk); const d = Math.abs(G.computeOVR() - targetOvr); if (d < bestD) { bestD = d; bestSk = sk; } }
  const team = set(bestSk); const ovr = G.computeOVR();
  const ppg = [], allStars = [], allNBAs = [], mvps = [], tiers = {};
  for (let s = 1; s <= seeds; s++) {
    G.seedRng(s); const c = G.simCareer(ovr, team, {});
    ppg.push(c.bestSeason.ppg); allStars.push(c.allStars); allNBAs.push(c.allNBAs); mvps.push(c.mvps);
    const n = G.tierForCareer(c).name; tiers[n] = (tiers[n] || 0) + 1;
  }
  const med = a => { a = a.slice().sort((x, y) => x - y); return a[a.length >> 1]; };
  return { ovr, ppg: med(ppg), allStars: med(allStars), allNBAs: med(allNBAs), mvps: med(mvps),
           tier: Object.entries(tiers).sort((a, b) => b[1] - a[1])[0][0] };
}
{
  // [ovr, peak PPG window, All-Star window, All-NBA window, MVP window, tier]
  const BANDS = [
    [75, [14, 20], [0, 1], [0, 1], [0, 0], "Starter"],
    [80, [20, 24], [2, 5], [0, 3], [0, 0], "All-Star"],
    [85, [25, 28], [6, 12], [4, 9], [0, 2], "Superstar"],
    [90, [28, 32], [12, 17], [9, 16], [3, 8], "Legend"],
  ];
  BANDS.forEach(([ovr, pw, aw, nw, mw, tier]) => {
    const r = calibrationRow(ovr);
    check(`OVR ${ovr}: peak PPG in ${pw[0]}-${pw[1]}`, r.ppg, v => v >= pw[0] && v <= pw[1]);
    check(`OVR ${ovr}: All-Star count in ${aw[0]}-${aw[1]}`, r.allStars, v => v >= aw[0] && v <= aw[1]);
    check(`OVR ${ovr}: All-NBA count in ${nw[0]}-${nw[1]}`, r.allNBAs, v => v >= nw[0] && v <= nw[1]);
    check(`OVR ${ovr}: MVP count in ${mw[0]}-${mw[1]}`, r.mvps, v => v >= mw[0] && v <= mw[1]);
    check(`OVR ${ovr}: tiers as ${tier}`, r.tier, tier);
  });

  // THE REPORTED CASE, pinned on PEAK OVR — not base. Those are different numbers
  // (a base-80 build peaks around 83) and conditioning on the wrong one tests the
  // wrong population, which has already caused one wrong measurement in this repo.
  {
    const S = G.state;
    S.sandbox = false; S.autoPick = true; S.activeBadges = [];
    S.position = "SF"; S.positionFit = true;
    S.height = { rating: 60, label: "x" }; S.athleticism = { rating: 75, label: "y" };
    S.skills = {}; G.SKILL_ORDER.forEach(k => (S.skills[k] = { rating: 80 }));
    const team = G.TEAMS_BY_ABBR["OKC"]; S.team = team; S.teamNeedMet = true;
    const ovr = G.computeOVR();
    const hits = [];
    for (let s = 1; s <= 400; s++) {
      G.seedRng(s); const c = G.simCareer(ovr, team, {});
      if (c.peakOVR >= 82 && c.peakOVR <= 84) hits.push(c);
    }
    check("produced Peak-83 careers to test", hits.length, v => v > 0);
    const worst = k => Math.max(...hits.map(c => c[k]));
    check("Peak-83 never produces a 27+ PPG season (reported 27.8)",
      Math.max(...hits.map(c => c.bestSeason.ppg)), v => v < 27);
    check("Peak-83 never collects 10 All-Stars (reported 10)", worst("allStars"), v => v < 10);
    check("Peak-83 never collects 14 All-NBA (reported 14)", worst("allNBAs"), v => v < 14);
    check("Peak-83 never wins an MVP", worst("mvps"), 0);
  }

  // The other direction — this must not be "fixed" by flattening everything.
  const r95 = calibrationRow(95);
  check("OVR 95 still reaches an all-time peak season", r95.ppg, v => v >= 28);
  check("OVR 95 still posts a double-digit All-NBA resume", r95.allNBAs, v => v >= 10);
  check("OVR 95 still wins multiple MVPs", r95.mvps, v => v >= 5);

  // Every scaler must read the published bands, not a private number.
  check("the breadth governor is anchored on the Starter floor",
    G.breadthFactor(G.TIER_OVR_FLOORS["Starter"]) < G.breadthFactor(95), true);
  check("award floors sit under what each band actually produces",
    G.TIER_AWARD_FLOORS["All-Star"].allStars <= 5 &&
    G.TIER_AWARD_FLOORS["Superstar"].allStars <= 12 &&
    G.TIER_AWARD_FLOORS["Legend"].allStars <= 17, true);
}

// ############################################################################
console.log("\n=== AWARD EXPLANATIONS TRACK THE LIVE TUNING ===");
//
// awardReasons() renders the "why" line under each honor in Career Stats by Year.
// The whole point is that it recomputes from the SAME constants the rolls use, so
// retuning an award updates its explanation. These cases assert exactly that: the
// text must quote the CURRENT exported values, so changing a gate without the
// explanation following fails here rather than shipping a line that lies.
// ############################################################################

// A season object shaped like the ones simCareer pushes.
function season(o) {
  return Object.assign({
    wins: 55, seasonOVR: 84, seasonDef: 70, dStreak: 0, isRookie: false,
    mvp: false, ring: false, finalsMVP: false, roty: false, dpoy: false,
    allNBA: null, allDefensive: null, allStar: false,
    stats: { ppg: 25, apg: 5, rpg: 7, spg: 1.2, bpg: 0.8, tpg: 2.5, fgPct: 50, tptPct: 36 },
  }, o);
}

{
  const r = G.awardReasons(season({ mvp: true, seasonOVR: 88, wins: 62 }));
  check("MVP line quotes the live OVR gate",
    r.mvp.includes(String(G.MVP_OVR_GATE)), true, r.mvp);
  check("MVP line quotes the live win gate",
    r.mvp.includes(String(G.MVP_WIN_GATE)), true, r.mvp);
  check("MVP line quotes this season's real OVR and wins",
    r.mvp.includes("88") && r.mvp.includes("62"), true, r.mvp);
  // Must match the FULL roll, band scaler included — quoting the raw ramp would
  // overstate the odds the season actually faced.
  const trueOdds = G.mvpOdds(88, 62) * G.mvpBandFactor(G.scaleOVR(88));
  check("MVP odds in the line equal the full roll (ramp x band factor)",
    r.mvp.includes(Math.round(trueOdds * 100) + "%"), true, r.mvp);
}
{
  const r = G.awardReasons(season({ allDefensive: "1st", seasonDef: 96 }));
  check("All-Def line quotes the live 1st/2nd thresholds",
    r.allDefensive.includes(String(G.ALLDEF_1ST)) && r.allDefensive.includes(String(G.ALLDEF_2ND)), true, r.allDefensive);
  check("All-Def line quotes the season's actual defensive rating",
    r.allDefensive.includes("96"), true, r.allDefensive);
}
{
  const s = season({ dpoy: true, allDefensive: "1st", dStreak: 4,
    stats: { ppg: 8, apg: 1.5, rpg: 13.5, spg: 1.9, bpg: 3.2, tpg: 0.2, fgPct: 58, tptPct: 28 } });
  const r = G.awardReasons(s);
  check("DPOY odds in the line equal dpoyOdds() exactly",
    r.dpoy.includes(Math.round(G.dpoyOdds(s.stats, 4) * 100) + "%"), true, r.dpoy);
  check("DPOY line surfaces the compounding streak", r.dpoy.includes("4 straight"), true, r.dpoy);
  check("DPOY line quotes the real defensive box score",
    r.dpoy.includes("3.2") && r.dpoy.includes("1.9") && r.dpoy.includes("13.5"), true, r.dpoy);
}
{
  const s = season({ allNBA: "1st", wins: 60,
    stats: { ppg: 31, apg: 6, rpg: 7, spg: 1.2, bpg: 0.5, tpg: 3, fgPct: 52, tptPct: 38 } });
  const r = G.awardReasons(s);
  check("All-NBA line quotes the live 1st-team score line",
    r.allNBA.includes(String(G.ALLNBA_1ST_SCORE)), true, r.allNBA);
  check("All-NBA line quotes the score offensiveCase() actually computed",
    r.allNBA.includes(G.offensiveCase(s.stats, s.wins).score.toFixed(1)), true, r.allNBA);
  check("All-NBA 2nd team names the 2nd-team line",
    G.awardReasons(season({ allNBA: "2nd", wins: 50,
      stats: { ppg: 26, apg: 5, rpg: 7, spg: 1, bpg: 0.5, tpg: 2, fgPct: 50, tptPct: 35 } })).allNBA
      .includes(String(G.ALLNBA_2ND_SCORE)), true);
}
{
  // A 6-PPG rim protector's All-NBA 3rd can ONLY be the capped defensive path,
  // because the offensive ramp is 0% at or below the floor. Deterministic.
  const s = season({ allNBA: "3rd", allDefensive: "1st", wins: 44,
    stats: { ppg: 6, apg: 1.4, rpg: 13, spg: 2, bpg: 2.8, tpg: 0.1, fgPct: 60, tptPct: 28 } });
  check("All-NBA via the defensive path is named as such, not as a scoring case",
    /defensive path/.test(G.awardReasons(s).allNBA), true, G.awardReasons(s).allNBA);
  check("that season's offensive score is genuinely at or below the ramp floor",
    G.offensiveCase(s.stats, s.wins).score <= G.ALLNBA_Q_FLOOR, true);
}
{
  // All-Star: the line must name whichever case actually carried the season.
  const scorer = season({ allStar: true, wins: 55,
    stats: { ppg: 27, apg: 5, rpg: 6, spg: 1.1, bpg: 0.4, tpg: 2.6, fgPct: 50, tptPct: 36 } });
  check("All-Star scoring season is explained by scoring",
    /PPG on a 55-win team/.test(G.awardReasons(scorer).allStar), true, G.awardReasons(scorer).allStar);
  const anchor = season({ allStar: true, allDefensive: "1st", wins: 48,
    stats: { ppg: 6, apg: 1.5, rpg: 13, spg: 1.8, bpg: 2.9, tpg: 0.1, fgPct: 59, tptPct: 28 } });
  check("a 6-PPG anchor's All-Star is explained by defense, NOT scoring",
    /not scoring/.test(G.awardReasons(anchor).allStar), true, G.awardReasons(anchor).allStar);
  const passer = season({ allStar: true, wins: 44,
    stats: { ppg: 11, apg: 11.5, rpg: 4, spg: 1.4, bpg: 0.2, tpg: 1.5, fgPct: 47, tptPct: 34 } });
  check("a pass-first All-Star is explained by passing",
    /passing case/.test(G.awardReasons(passer).allStar), true, G.awardReasons(passer).allStar);
}
{
  const r = G.awardReasons(season({ roty: true, isRookie: true,
    stats: { ppg: 21, apg: 4, rpg: 6, spg: 1, bpg: 0.4, tpg: 2, fgPct: 48, tptPct: 35 } }));
  check("ROTY line quotes the live PPG floor", r.roty.includes(String(G.ROTY_PPG.floor)), true, r.roty);
  check("ROTY line attributes the debut to the right category", /on scoring/.test(r.roty), true, r.roty);
  const boards = G.awardReasons(season({ roty: true, isRookie: true,
    stats: { ppg: 7, apg: 1.4, rpg: 13, spg: 0.8, bpg: 1.9, tpg: 0.1, fgPct: 55, tptPct: 28 } })).roty;
  check("a rebounding rookie's ROTY is not credited to scoring", /on rebounding/.test(boards), true, boards);
}
check("a season with no honors produces no explanations",
  Object.keys(G.awardReasons(season({}))).length, 0);
check("awardReasons is safe on a season with no stats",
  Object.keys(G.awardReasons({ mvp: true })).length, 0);

console.log("\n" + "=".repeat(52));
if (failures.length) {
  console.log(`FAILED  ${failures.length} of ${passed + failures.length}`);
  failures.forEach(f => console.log(`   - ${f}`));
  process.exit(1);
}
console.log(`PASSED  all ${passed} checks`);
