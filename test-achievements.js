#!/usr/bin/env node
// Targeted verification of the expanded achievement set: do the new triggers fire
// on the conditions they describe, and does unlock state stay split per mode?
const fs = require("fs"), path = require("path"), vm = require("vm");
const DIR = "/Users/sanirbyanjankar/Downloads/are-you-the-goat";

function load() {
  const src = fs.readFileSync(path.join(DIR, "data.js"), "utf8")
    + '\n;globalThis.__D__ = module.exports; module.exports = {};\n'
    + fs.readFileSync(path.join(DIR, "game.js"), "utf8")
    + '\n;globalThis.__G__ = module.exports;\n';
  let store = {};
  const ctx = { console, module: { exports: {} }, localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  }, __reset: () => { store = {}; } };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { G: Object.assign({}, ctx.__D__, ctx.__G__), reset: () => ctx.__reset() };
}
const { G, reset } = load();
const TI = n => G.TIERS.findIndex(t => t.name === n);

let fails = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fails++; };

// A neutral baseline run that unlocks nothing interesting.
const base = () => ({
  mode: "cap", goatScore: 100, tierIdx: TI("Starter"), tierName: "Starter", isHOF: false,
  rings: 0, mvps: 0, dpoys: 0, rotys: 0, allStars: 0, allNBAs: 0, allDefensives: 0,
  numSeasons: 10, dethroned: null, activatedBadgeKeys: [], fullStack: false,
  budgetExact: false, unanimous: false, baseOVR: 70, peakOVR: 80, budgetSpent: 9900,
  heightRating: 62, athleticismRating: 60, position: "SF", teamAbbr: "BOS",
  positionFit: false, teamNeedMet: false, rerollsUsed: 3, activeBadgeCount: 0,
  badgeSameTeam: false, badgeDefensivePair: false, badgeScoringPair: false,
  peakPPG: 12, peakRPG: 4, peakAPG: 3,
});
const runWith = (over, fresh = true) => {
  if (fresh) reset();
  return G.recordCareerRun(Object.assign(base(), over)).newlyUnlocked.map(a => a.id);
};
const has = (ids, id) => ids.includes(id);

console.log("=== SHADOW-CHASING ===");
ok(has(runWith({ dethroned: "Kevin Durant" }), "dethrone_kevin_durant"), "per-legend: dethroning Kevin Durant fires his own achievement");
ok(has(runWith({ dethroned: "Kevin Durant" }), "dethrone_first"), "Prodigy fires when it's the first career in the mode");
{ // second career should NOT re-award Prodigy
  reset();
  G.recordCareerRun(Object.assign(base(), { dethroned: "Larry Bird" }));
  const second = G.recordCareerRun(Object.assign(base(), { dethroned: "Magic Johnson" })).newlyUnlocked.map(a => a.id);
  ok(!has(second, "dethrone_first"), "Prodigy does NOT fire on a later career");
  ok(has(second, "dethrone_magic_johnson"), "the second legend's own achievement fires");
}
{ // three distinct legends -> Shadow Hunter
  reset();
  ["Michael Jordan", "Kobe Bryant"].forEach(n => G.recordCareerRun(Object.assign(base(), { dethroned: n })));
  const third = G.recordCareerRun(Object.assign(base(), { dethroned: "Tim Duncan" })).newlyUnlocked.map(a => a.id);
  ok(has(third, "dethrone_3"), "Shadow Hunter fires on the 3rd DIFFERENT legend");
}
{ // repeating the same legend must not advance the counter
  reset();
  G.recordCareerRun(Object.assign(base(), { dethroned: "Nikola Jokic" }));
  const again = G.recordCareerRun(Object.assign(base(), { dethroned: "Nikola Jokic" })).newlyUnlocked.map(a => a.id);
  ok(!has(again, "dethrone_3"), "repeating the same legend does not count toward Shadow Hunter");
}
ok(has(runWith({ dethroned: "Bill Russell", tierIdx: TI("Legend") }), "dethrone_clean"), "No Contest needs dethrone + Legend tier");
ok(!has(runWith({ dethroned: "Bill Russell", tierIdx: TI("All-Star") }), "dethrone_clean"), "No Contest does not fire below Legend");

console.log("\n=== MODE-SPECIFIC ===");
ok(has(runWith({ mode: "classic", baseOVR: 66, tierIdx: TI("Superstar") }), "classic_rough"), "Diamond in the Rough: Classic, base OVR < 70, Superstar+");
ok(!has(runWith({ mode: "cap", baseOVR: 66, tierIdx: TI("Superstar") }), "classic_rough"), "Diamond in the Rough does NOT fire in Salary Cap");
ok(has(runWith({ mode: "classic", rerollsUsed: 0 }), "classic_purist"), "Purist: Classic with zero re-spins");
ok(!has(runWith({ mode: "classic", rerollsUsed: 1 }), "classic_purist"), "Purist does not fire if a re-spin was used");
ok(has(runWith({ mode: "classic", activeBadgeCount: 3 }), "classic_trio"), "Triple Threat: 3 active badges in Classic");
ok(has(runWith({ mode: "cap", budgetSpent: 7900, tierIdx: TI("Superstar") }), "cap_thrifty"), "Cap Wizard: Superstar+ under $80M");
ok(!has(runWith({ mode: "classic", budgetSpent: 7900, tierIdx: TI("Superstar") }), "cap_thrifty"), "Cap Wizard does NOT fire in Classic");
ok(has(runWith({ mode: "cap", budgetSpent: 5500, tierIdx: TI("All-Star") }), "cap_minimum"), "Minimum Deal: All-Star+ under $60M");
ok(!has(runWith({ mode: "cap", budgetSpent: 6500, tierIdx: TI("All-Star") }), "cap_minimum"), "Minimum Deal does not fire at $65M");

console.log("\n=== BADGES / COMPLETIONIST / FLAVOR ===");
ok(has(runWith({ badgeSameTeam: true }), "badge_same_team"), "Franchise Chemistry fires on shared-franchise badges");
ok(has(runWith({ badgeDefensivePair: true }), "badge_defense"), "Lockdown Duo fires on two Defense badges");
ok(has(runWith({ badgeScoringPair: true }), "badge_offense"), "Bucket Brigade fires on two scoring badges");
ok(has(runWith({ tierName: "Draft Bust", tierIdx: TI("Draft Bust"), rings: 1 }), "bust_ring"), "Right Place, Right Time: Draft Bust with a ring");
ok(has(runWith({ heightRating: 99, tierIdx: TI("Superstar") }), "tall_tale"), "Tallest Tale: 7'4\"+ reaching Superstar");
ok(has(runWith({ heightRating: 25, tierIdx: TI("Superstar") }), "small_ball"), "Giant Slayer: <=5'11\" reaching Superstar");
ok(has(runWith({ rings: 0, tierIdx: TI("Legend") }), "ringless"), "The Ringless Great: Legend with 0 rings");
ok(!has(runWith({ rings: 2, tierIdx: TI("Legend") }), "ringless"), "Ringless does not fire with rings");
ok(has(runWith({ numSeasons: 20 }), "iron_man"), "Iron Man: 20 seasons");
ok(has(runWith({ positionFit: true, teamNeedMet: true }), "perfect_fit"), "Perfect Fit: position + team need");
ok(has(runWith({ peakPPG: 26, peakRPG: 11, peakAPG: 6 }), "stat_stuffer"), "Stat Sheet Stuffer: 25/10/5 season");
ok(has(runWith({ peakRPG: 11, peakAPG: 10 }), "triple_dbl"), "Averaged a Triple-Double: 10 reb + 10 ast");
ok(has(runWith({ dpoys: 3 }), "def_dynasty"), "Defensive Dynasty: 3 DPOYs");
ok(has(runWith({ rotys: 1, mvps: 1 }), "rise_rise"), "Rise and Rise: ROTY + MVP");
ok(has(runWith({ allStars: 15 }), "allstar_15"), "Perennial: 15 All-Stars");
{ // all five positions across careers
  reset();
  const pos = Object.keys(G.POSITIONS);
  let last = [];
  pos.forEach(p => { last = G.recordCareerRun(Object.assign(base(), { position: p })).newlyUnlocked.map(a => a.id); });
  ok(has(last, "all_positions"), `Positional Chameleon fires after all ${pos.length} positions`);
}
{ // ten franchises
  reset();
  const abbrs = G.TEAMS.slice(0, 10).map(t => t.abbr);
  let last = [];
  abbrs.forEach(a => { last = G.recordCareerRun(Object.assign(base(), { teamAbbr: a })).newlyUnlocked.map(x => x.id); });
  ok(has(last, "teams_10"), "Well Travelled fires on the 10th different franchise");
}

console.log("\n=== PER-MODE ISOLATION (the split must hold for new achievements) ===");
{
  reset();
  G.recordCareerRun(Object.assign(base(), { mode: "cap", dethroned: "Larry Bird", tierIdx: TI("Legend"), rings: 0 }));
  const cap = G.loadProgress("cap"), classic = G.loadProgress("classic");
  ok(!!cap.unlocked["dethrone_larry_bird"], "cap pool has the Larry Bird unlock");
  ok(!classic.unlocked["dethrone_larry_bird"], "classic pool does NOT have it (isolated)");
  ok(!!cap.unlocked["ringless"] && !classic.unlocked["ringless"], "'The Ringless Great' is isolated per mode too");
  ok(cap.dethronedTargets.length === 1 && classic.dethronedTargets.length === 0, "lifetime dethroned list is per mode");
  ok(cap.positionsPlayed.length === 1 && classic.positionsPlayed.length === 0, "positionsPlayed accumulator is per mode");
  // now the same feat in classic should award classic's copy
  const cl = G.recordCareerRun(Object.assign(base(), { mode: "classic", dethroned: "Larry Bird" })).newlyUnlocked.map(a => a.id);
  ok(has(cl, "dethrone_larry_bird"), "the same legend re-awards in the OTHER mode's pool");
}

console.log("\n=== STICKINESS ===");
{
  reset();
  const first = G.recordCareerRun(Object.assign(base(), { numSeasons: 20 })).newlyUnlocked.map(a => a.id);
  const second = G.recordCareerRun(Object.assign(base(), { numSeasons: 20 })).newlyUnlocked.map(a => a.id);
  ok(has(first, "iron_man") && !has(second, "iron_man"), "an earned achievement is not re-awarded");
}

console.log("\n=== BACKWARD COMPAT: a pre-expansion save must load ===");
{
  reset();
  G.recordCareerRun(base());                 // create a v2 envelope
  const p = G.loadProgress("cap");
  ok(Array.isArray(p.positionsPlayed) && Array.isArray(p.teamsPlayed), "new accumulators exist and are arrays");
  ok(typeof p.totalAllStars === "number" && typeof p.totalAllNBAs === "number", "new counters default to numbers");
}


// =====================================================================
// REACHABILITY: can the GAME actually produce each achievement's trigger?
// =====================================================================
// Every check above hands the achievement a hand-built run object with the field
// already set, which proves the check function works and nothing more. Three
// achievements shipped that no build could ever satisfy — "two badges from the
// same player" (pick lists forbid repeat players), "two Defense badges" (there is
// one Defense slot), and dethroning Russell (11 rings, sim tops out at 10). Each
// passed this suite the whole time.
//
// So: play real games with strategies aimed at each trigger, and assert the run
// objects the game builds actually contain the values the checks look for.
console.log("\n=== REACHABILITY (real builds, not fixtures) ===");
{
  const S = G.state;
  const rngPick = (arr, i) => arr[i % arr.length];

  // Play one full game. `slotChoice(slot, options)` picks from real roster options.
  function play(seed, mode, slotChoice, shadow) {
    S.sandbox = false; S.autoPick = mode === "classic"; S.name = "T";
    S.shadowTarget = shadow || G.SHADOW_ORDER[0];
    S.height = null; S.athleticism = null; S.skills = {}; S.budgetSpent = 0;
    S.pickOrder = []; S.activeBadges = []; S.teamRerollsUsed = 0; S.playerRerollsUsed = 0;
    S.position = null; S.positionFit = null; S.team = null; S.teamNeedMet = false;
    S.scoutTeam = null; S.editingCategory = null; S.sharedView = false;
    G.seedRng(seed);
    for (const slot of ["height", "athleticism", ...G.SKILL_ORDER]) {
      const teams = G.availableTeams();
      if (!teams.length) return null;
      let opts = [];
      for (const t of teams) {
        if (mode === "classic") {
          for (const p2 of G.spinnablePlayers(t)) {
            opts.push({ player: p2, team: t, rating: G.categoryRating(p2, slot), cost: 0 });
          }
        } else {
          for (const o of G.getRosterOptions(slot, t)) if (o.affordable) opts.push({ opt: o, team: t, rating: o.rating, cost: o.cost });
        }
      }
      if (!opts.length) return null;
      const chosen = slotChoice(slot, opts);
      if (!chosen) return null;
      S.scoutTeam = chosen.team;
      const pick = mode === "classic"
        ? G.buildStatPick(chosen.player, chosen.team, slot, slot)
        : chosen.opt;
      if (slot === "height" || slot === "athleticism") G.lockPhysical(slot, pick);
      else G.lockSkill(slot, pick);
      S.pickOrder.push(slot);
    }
    return true;
  }
  const finish = (car, activate, pos, team) => {
    const acq = G.acquiredBadges();
    S.activeBadges = (activate ? activate(acq) : acq.slice(0, 3)).map(b => b.key);
    S.position = pos || Object.keys(G.POSITIONS).find(p2 => G.checkPositionFit(p2)) || "SF";
    S.positionFit = G.checkPositionFit(S.position);
    S.team = team || [...G.TEAMS].sort((a, b) => G.effectiveScr(b.abbr) - G.effectiveScr(a.abbr))[0];
    S.teamNeedMet = G.teamNeedPosition(S.team.abbr) === S.position;
    return G.buildCareerRun(car);
  };
  const strongest = (slot, opts) => opts.reduce((a, b) => (b.rating > a.rating ? b : a));
  const weakest   = (slot, opts) => opts.reduce((a, b) => (b.rating < a.rating ? b : a));
  const badgey    = (slot, opts) => {
    const withBadge = opts.filter(o => G.badgeFor((o.player || o.opt).name, slot, o.rating));
    return (withBadge.length ? withBadge : opts).reduce((a, b) => (b.rating > a.rating ? b : a));
  };
  const sim = () => G.simCareer(G.computeOVR(), S.team || G.TEAMS_BY_ABBR.BOS, G.activeBadgeMods());

  // --- full_stack: six badges collected on one build ---
  let bestAcq = 0;
  for (let i = 0; i < 12 && bestAcq < 6; i++) {
    if (!play(4000 + i, "classic", badgey)) continue;
    S.team = G.TEAMS_BY_ABBR.BOS; const run = finish(sim());
    bestAcq = Math.max(bestAcq, run.acquiredBadgeCount);
  }
  ok(bestAcq >= 6, `a real build can collect 6 badges (best seen ${bestAcq}) — full_stack is reachable`);

  // --- badge_defense: a Defense AND a Rebounding badge, both active ---
  let defPair = false;
  for (let i = 0; i < 12 && !defPair; i++) {
    if (!play(5000 + i, "classic", badgey)) continue;
    S.team = G.TEAMS_BY_ABBR.BOS;
    const run = finish(sim(), acq => {
      const d = acq.find(b => b.category === "Defense"), r = acq.find(b => b.category === "Rebounding");
      return d && r ? [d, r] : acq.slice(0, 2);
    });
    defPair = run.badgeDefensivePair;
  }
  ok(defPair, "a real build can hold a Defense + Rebounding badge pair — badge_defense is reachable");

  // --- no build can ever put two badges on one player (the old full_stack) ---
  let maxPerPlayer = 0;
  for (let i = 0; i < 8; i++) {
    if (!play(6000 + i, "classic", badgey)) continue;
    const byP = {};
    G.acquiredBadges().forEach(b => { byP[b.player] = (byP[b.player] || 0) + 1; });
    maxPerPlayer = Math.max(maxPerPlayer, 0, ...Object.values(byP));
  }
  ok(maxPerPlayer === 1, `repeat players stay impossible, so a per-player badge stack must not be an achievement (max ${maxPerPlayer})`);

  // --- draft_bust / a genuinely bad build still reaches the verdict ---
  let bust = false;
  for (let i = 0; i < 8 && !bust; i++) {
    if (!play(7000 + i, "classic", weakest)) continue;
    S.team = G.TEAMS_BY_ABBR.BOS;
    const run = finish(sim());
    if (run.tierName === "Draft Bust" || run.tierName === "Bench Piece") bust = true;
  }
  ok(bust, "deliberately weak play reaches the bottom tiers — draft_bust is reachable");

  // --- Salary Cap: a build can finish well under the cap ---
  let cheapest = Infinity;
  for (let i = 0; i < 8; i++) {
    if (!play(8000 + i, "cap", weakest)) continue;
    cheapest = Math.min(cheapest, S.budgetSpent);
  }
  ok(cheapest < 6000, `a cap build can come in under $60M (cheapest ${(cheapest / 100).toFixed(1)}M) — cap_minimum is reachable`);

  // --- every shadow legend can be dethroned ---
  const undethronable = G.SHADOW_ORDER.filter(nm => {
    const t = G.SHADOW_TARGETS[nm];
    return Math.min(t.rings, G.RING_PILLAR_CEILING) > 10 || t.mvps > 17 || t.allNBA > 20;
  });
  ok(undethronable.length === 0, `no legend's resume is outside what the sim can produce (${undethronable.join(", ") || "all reachable"})`);
}

console.log(fails ? `\n${fails} CHECK(S) FAILED` : `\nALL CHECKS PASSED (${G.ACHIEVEMENTS.length} achievements defined)`);
process.exit(fails ? 1 : 0);
