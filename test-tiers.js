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

console.log("\n" + "=".repeat(52));
if (failures.length) {
  console.log(`FAILED  ${failures.length} of ${passed + failures.length}`);
  failures.forEach(f => console.log(`   - ${f}`));
  process.exit(1);
}
console.log(`PASSED  all ${passed} checks`);
