#!/usr/bin/env node
/*
 * PERMANENT REGRESSION TESTS — tier assignment, alternate floor paths, award rates.
 *
 *     node test-tiers.js
 *
 * RE-RUN THIS WHENEVER YOU TOUCH: tierForCareer / meetsTierFloors /
 * meetsAwardFloor / TIER_OVR_FLOORS / TIER_AWARD_FLOORS / TIER_ALT_PATHS /
 * goatScore weights / the MVP, All-NBA or All-Star thresholds in simSeason.
 *
 * WHY THIS FILE EXISTS: the "maxed-out award record still lands at All-Star"
 * bug has been reported and patched at least four separate times. Each patch
 * added one narrow alternate path and moved on, so the next build that cleared
 * the award floors but not the peak-OVR floor fell straight back to All-Star.
 * These cases pin that behaviour down permanently. If you are reading this
 * because a tier looks wrong again: add the failing scenario here FIRST, watch
 * it fail, then fix the logic.
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

// The headline regression. A career that maxed BOTH award categories over 20
// seasons is unambiguously Legend-tier, even though its peak OVR (73) sits
// under Superstar's 76 floor — every prior version dropped this to All-Star
// because the peak-OVR gate had no award-based alternate.
check("20x All-NBA / 20x All-Star (peak OVR 73)",
  tierOf(career({ allNBAs: 20, allStars: 20, numSeasons: 20, peakOVR: 73, goatScore: 430 })),
  atLeast("Legend"),
  "peak-OVR floor must not veto a maxed-out award record");

// Same shape, but with the MVPs/rings a GOAT resume needs.
check("20x All-NBA / 20x All-Star + 5 MVP + 5 rings",
  tierOf(career({ allNBAs: 20, allStars: 20, numSeasons: 20, peakOVR: 75,
                  mvps: 5, rings: 5, finalsMVPs: 3, goatScore: 700 })),
  atLeast("Legend"));

// Career longevity / volume path: ~43k points over a long, winning career is
// top-10-all-time scoring volume and should reach Legend on its own.
check("43k career points, 20 seasons, 1000 wins (peak OVR 74)",
  tierOf(career({ totals: { pts: 43000, ast: 8000, reb: 9000, stl: 1500, blk: 900, threes: 1800 },
                  numSeasons: 20, careerWins: 1000, peakOVR: 74,
                  allStars: 15, allNBAs: 13, goatScore: 480 })),
  atLeast("Legend"));

// Defensive path must still work (added in an earlier session).
check("2 DPOY / 0 MVP, sub-floor peak OVR",
  tierOf(career({ dpoys: 2, allStars: 14, allNBAs: 12, peakOVR: 76, rings: 2, goatScore: 400 })),
  "Legend");

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
// All-Star 80, Superstar 85, Legend 90, GOAT 95. These cases pin each floor.
check("GOAT floor is reachable at scaled peak 95+",
  tierOf(career({ peakOVR: 96, allNBAs: 18, allStars: 19, numSeasons: 20, mvps: 5,
                  rings: 4, finalsMVPs: 3, goatScore: 900 })),
  "GOAT",
  "a maxed resume at peak 96 must reach GOAT, not stall below it");

check("just under the GOAT floor (peak 94) does not reach GOAT",
  tierOf(career({ peakOVR: 94, allNBAs: 18, allStars: 19, numSeasons: 20, mvps: 5,
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

console.log("\n=== MVP RATE SCALES WITH DOMINANCE ===");

// Build a dominant player and run real careers. A historically great season
// should convert to MVP most years, not lose a flat 65% coin flip every time.
function simN(skill, def, runs) {
  const T = G.TEAMS.reduce((a, t) => (t.scr > a.scr ? t : a));
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
  for (let i = 0; i < runs; i++) {
    G.seedRng(4242 + i);
    const c = G.simCareer(ovr, T, G.activeBadgeMods());
    mvpSum += c.mvps; anSum += c.allNBAs;
    seasonSum += c.numSeasons; rotySum += c.roty;
    maxSeasons = Math.max(maxSeasons, c.numSeasons);
    minSeasons = Math.min(minSeasons, c.numSeasons);
    const t = G.tierForCareer(c).name; tiers[t] = (tiers[t] || 0) + 1;
  }
  return { ovr, mvps: mvpSum / runs, allNBAs: anSum / runs, tiers,
           seasons: seasonSum / runs, minSeasons, maxSeasons, rotyRate: rotySum / runs };
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

console.log("\n=== ROTY GOES TO ANY REAL ROOKIE SEASON ===");

// A rookie season of real quality should win ROTY most of the time; only a
// bust-level debut should be a long shot.
check("solid rookie season wins ROTY most years",
  Number(great.rotyRate.toFixed(2)), v => v >= 0.7,
  "a quality rookie year should convert ~70-90% of the time");
check("mid-quality rookie season still usually wins ROTY",
  Number(mid.rotyRate.toFixed(2)), v => v >= 0.6,
  "Starter-tier-or-better debuts are the realistic ROTY pool");
check("bust-level rookie season rarely wins ROTY",
  Number(bust.rotyRate.toFixed(2)), v => v <= 0.15,
  "a genuinely bad debut should be near-zero, not a coin flip");

console.log("\n" + "=".repeat(52));
if (failures.length) {
  console.log(`FAILED  ${failures.length} of ${passed + failures.length}`);
  failures.forEach(f => console.log(`   - ${f}`));
  process.exit(1);
}
console.log(`PASSED  all ${passed} checks`);
