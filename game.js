// ===== ARE YOU THE GOAT? — GAME LOGIC =====

const SKILL_ORDER = ["Shooting", "Finishing", "Playmaking", "Handles", "Defense", "Rebounding"];
const CATEGORIES = ["height", "athleticism", ...SKILL_ORDER];
const BUDGET_CAP = 10000; // internal hundredths of $M — displays as the "$100M cap" via fmtSalary
const TEAM_REROLLS = 3; // shared across all 7 scouting spins

const state = {
  shadowTarget: null,  // "Chasing the Shadow" — which all-time great this build is measured against
  activeBadges: [],    // Signature Traits — up to 2 acquired-badge keys ("Player|Category") active in the sim
  name: "",
  height: null,       // { name, label, rating, cost }
  athleticism: null,   // { name, label, rating, cost }
  skills: {},          // { Shooting: {name, rating, cost}, ... }
  budgetSpent: 0,
  sandbox: false,      // Sandbox Mode: no cap, all badges active, excluded from all persistent progress
  autoPick: false,     // Auto-assign mode: no cap, player is randomly assigned per spin, up to 3 badges
  position: null,
  positionFit: null,   // true/false — does the finished build fit the chosen position
  teamNeedMet: false,  // true if the chosen position fills the career team's positional need
  team: null,          // career team — drives the season sim
  scoutTeam: null,     // per-pick scouting team — whose roster the current list shows
  teamRerollsUsed: 0,  // scout-spin "Spin Again" uses, shared across the whole build
  editingCategory: null, // set while revising an earlier pick from the sidebar
  seed: null,           // RNG seed for the career sim — encoded in share links
  sharedView: false,    // true when viewing someone else's build from a ?build= link
  currentStep: 0,       // index into STEPS
};

const STEPS = ["home", "shadow", "name", "height", "athleticism", ...SKILL_ORDER, "chooseBadges", "position", "careerTeam", "confirm", "simulating", "verdict"];

// Seedable PRNG (mulberry32). All sim randomness flows through rng(), so
// seeding with the same value before simCareer reproduces an identical
// career — that's what lets a short share link recreate the exact verdict.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let _rng = mulberry32((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
function rng() { return _rng(); }
function seedRng(n) { _rng = mulberry32(n >>> 0); }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function randInt(min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function pickRandom(arr) { return arr[randInt(0, arr.length - 1)]; }
// SALARY-CAP ECONOMY. Exponential curve: cost_$M = 0.480938 * e^(0.04345*rating).
// Rating 99 -> $35.5M ceiling (lower than the old ~$47M quadratic), same shape.
// Costs are stored in integer HUNDREDTHS of $M against a $100M cap
// (BUDGET_CAP = 10000 hundredths); fmtSalary() renders "$35.5M" / "$100M" at one
// decimal. Why hundredths and not tenths: the exponential is nearly flat at the
// low end, so at $0.1M (tenths) resolution several adjacent scrub ratings round
// to the SAME cost (18&19, 24&25, 27&28, ...), which collides in the live data
// and reintroduces the "always pick the higher rating for the same price" bug.
// At hundredths every rating in the pool prices uniquely (verify-costs.js
// confirms 0 collisions); display still rounds to $0.1M, so 18 and 19 both
// SHOW $1.1M but charge $1.05M vs $1.10M — distinct spend, no exploit. The
// pre-commit hook runs verify-costs on every commit touching this or data.js.
function wheelCost(rating) {
  return Math.round(0.480938 * Math.exp(0.04345 * rating) * 100);
}

// Render internal tenths-of-$M as a salary: 43 -> "$4.3M", 1000 -> "$100M".
function fmtSalary(hundredths) {
  return "$" + (hundredths / 100).toFixed(1).replace(/\.0$/, "") + "M";
}

function budgetRemaining() {
  // Sandbox lifts the cap entirely. Returning Infinity is deliberately the ONLY
  // budget change needed: getRosterOptions gates purely on `cost <= remaining`,
  // so every roster player becomes affordable and the budget-bin fallback (which
  // only exists to prevent a soft-lock when nothing is affordable) never fires.
  if (state.sandbox || state.autoPick) return Infinity;
  return BUDGET_CAP - state.budgetSpent;
}

function categoryRating(player, category) {
  if (category === "height") return player.height.rating;
  if (category === "athleticism") return player.athleticism.rating;
  return player.skills[category];
}

// Full roster of one team for one category, best to worst. Unaffordable
// players stay in the list (flagged) so the player sees what they're
// missing; if nothing on a skill list is affordable, the budget bin keeps
// the game from dead-ending. extraBudget covers edit mode, where the
// current pick's cost is refunded before the swap.
function getRosterOptions(category, team = state.scoutTeam, extraBudget = 0) {
  const roster = TEAM_ROSTERS[team.abbr] || [];
  const remaining = budgetRemaining() + extraBudget;
  const options = roster.map(p => {
    const rating = categoryRating(p, category);
    const cost = wheelCost(rating);
    const label = category === "height" ? p.height.label
      : category === "athleticism" ? p.athleticism.label
      : null;
    return { name: p.name, era: p.era, label, rating, cost, team, affordable: cost <= remaining };
  }).sort((a, b) => b.rating - a.rating);

  if (SKILL_ORDER.includes(category) && !options.some(o => o.affordable)) {
    BUDGET_BIN.forEach(p => {
      // cost clamps to whatever is left so the game can never soft-lock
      const cost = Math.min(wheelCost(p.rating), remaining);
      options.push({ name: p.name, era: "—", label: null, rating: p.rating, cost, team, affordable: true });
    });
  }
  return options;
}

function currentPick(category) {
  if (category === "height" || category === "athleticism") return state[category];
  return state.skills[category];
}

// Swap an already-locked pick: refund the old cost, charge the new one.
function replacePick(category, newPick) {
  const old = currentPick(category);
  state.budgetSpent += newPick.cost - old.cost;
  if (category === "height" || category === "athleticism") state[category] = newPick;
  else state.skills[category] = newPick;
}

function lockSkill(skillName, result) {
  state.skills[skillName] = result;
  state.budgetSpent += result.cost;
}

function lockPhysical(key, result) {
  state[key] = result;
  state.budgetSpent += result.cost;
}

// Every team's options for a category, flattened — powers the Sandbox roster
// search. Reuses getRosterOptions per team so affordability, labels and the
// budget-bin fallback behave identically to a normal scouted list.
function getAllRosterOptions(category) {
  return Object.values(TEAMS)
    .flatMap(t => getRosterOptions(category, t))
    .sort((a, b) => b.rating - a.rating);
}

// Auto-assign mode: spin a team, then take whoever that spin lands on for this
// category — no roster list, no shopping. A player already used earlier in the
// build is never assigned twice; if the spun team has nobody left, we respin the
// team rather than hand back a duplicate. `attempts` is bounded so a pathological
// state can never spin forever.
// Returns { name, era, label, rating, cost, team } — the same shape
// getRosterOptions produces, so lockSkill/lockPhysical need no special-casing.
function autoAssignPick(category, usedNames = []) {
  const used = new Set(usedNames);
  const build = (p, team) => ({
    name: p.name, era: p.era,
    label: category === "height" ? p.height.label
      : category === "athleticism" ? p.athleticism.label
      : null,
    rating: categoryRating(p, category),
    cost: 0, // this mode tracks no spending at all
    team,
  });
  // first try the team already on screen
  let team = state.scoutTeam;
  if (team) {
    const pool = (TEAM_ROSTERS[team.abbr] || []).filter(p => !used.has(p.name));
    if (pool.length) return build(pickRandom(pool), team);
  }
  // that team is exhausted for this build — respin until one has a free player
  for (let attempts = 0; attempts < 60; attempts++) {
    team = pickRandom(TEAMS);
    const pool = (TEAM_ROSTERS[team.abbr] || []).filter(p => !used.has(p.name));
    if (pool.length) { state.scoutTeam = team; return build(pickRandom(pool), team); }
  }
  return null; // unreachable with 30 teams x ~17 players and only 8 picks
}

// ---- Modifiers ----
function applyModifiers(baseRating, statName) {
  const h = state.height.rating;
  const a = state.athleticism.rating;
  let mod = 0;
  if (["Rebounding", "Defense"].includes(statName)) mod += (h - 70) * 0.15;
  // Athleticism is a CLEAN one-directional bonus: explosion finishes over rim
  // protection, closing speed and lateral quickness defend, leaping rebounds.
  // Unlike the old Frame it has no penalty side — bulk used to punish
  // Shooting/Handles at the extremes, but there is no equivalent downside to
  // being a better athlete. Below-average athleticism is simply neutral, and
  // you still pay for the bonus through the shared cap.
  if (["Finishing", "Defense", "Rebounding"].includes(statName)) mod += Math.max(0, a - 55) * 0.15;
  if (["Playmaking", "Shooting", "Handles"].includes(statName)) {
    if (h >= 90) mod -= (h - 70) * 0.15;
  }
  return clamp(Math.round(baseRating + mod), 25, 99);
}

function finalSkills() {
  const out = {};
  SKILL_ORDER.forEach(s => {
    out[s] = applyModifiers(state.skills[s].rating, s);
  });
  return out;
}

function computeOVR() {
  const f = finalSkills();
  const ovr =
    f.Shooting * 0.16 +
    f.Finishing * 0.16 +
    f.Playmaking * 0.14 +
    f.Handles * 0.12 +
    f.Defense * 0.18 +
    f.Rebounding * 0.14 +
    state.height.rating * 0.05 +
    state.athleticism.rating * 0.05;
  let bonus = state.positionFit ? 3 : 0;
  return clamp(Math.round(ovr + bonus), 25, 99);
}

function checkPositionFit(posKey) {
  const pos = POSITIONS[posKey];
  const h = state.height.rating;
  // Height alone gates position fit. Center used to also require a bulk floor,
  // but height already carries the size requirement and Athleticism explicitly
  // does not mean mass — gating Centers on explosiveness would wrongly exclude
  // grounded bigs like Jokic.
  return h >= pos.hMin && h <= pos.hMax;
}

// ---- Team positional needs (for the Career Team pick) ----
// Each team's "need" is the position where its roster is weakest RELATIVE to
// the rest of the league. Per position, score a team by the top skill-total
// among players who physically fit it (height in range), then
// z-score that against all 30 teams so a position's inherent difficulty (e.g.
// C is hard to fill everywhere) doesn't bias every team toward the same need.
// The need is the position with the lowest z-score. Data-driven; spreads
// needs across all five positions.
function bestFitScore(abbr, posKey) {
  const pos = POSITIONS[posKey];
  let best = 0;
  (TEAM_ROSTERS[abbr] || []).forEach(p => {
    const fits = p.height.rating >= pos.hMin && p.height.rating <= pos.hMax;
    if (fits) { const total = Object.values(p.skills).reduce((a, b) => a + b, 0); if (total > best) best = total; }
  });
  return best;
}
function computeTeamNeeds() {
  const positions = Object.keys(POSITIONS);
  const fit = {};
  TEAMS.forEach(t => { fit[t.abbr] = {}; positions.forEach(pos => { fit[t.abbr][pos] = bestFitScore(t.abbr, pos); }); });
  const stat = {};
  positions.forEach(pos => {
    const vals = TEAMS.map(t => fit[t.abbr][pos]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
    stat[pos] = { mean, sd };
  });
  const needs = {};
  TEAMS.forEach(t => {
    let need = null, lowZ = Infinity;
    positions.forEach(pos => {
      const z = (fit[t.abbr][pos] - stat[pos].mean) / stat[pos].sd;
      if (z < lowZ) { lowZ = z; need = pos; } // ties -> earliest position (PG..C)
    });
    needs[t.abbr] = need;
  });
  return needs;
}
const TEAM_NEEDS = computeTeamNeeds();

// ---- Per-season box score ----
// Per-game averages for one season, jittered so no two years look identical.
// ovr = that season's overall, f = finalSkills(), h = height, fr = athleticism.
// OVR is a global governor on the whole line: skills set the SHAPE of the
// box score (which stats dominate), but OVR gates the MAGNITUDE, so an elite
// individual skill on a mediocre build can't post all-time counting stats.
// The factor runs ~0.35 at OVR 40 up to 1.0 at OVR 96+, so only 90+ builds
// approach 30 PPG and only maxed 95+ builds reach the historical outliers.
// mods: additive Signature-Trait deltas ({ppg, apg, rpg, spg, bpg, tpg, fgPct,
// tptPct}), applied INSIDE each stat's clamp so boosts still respect the sim's
// realistic ceilings. Applied every season, so Best Season and Career Totals
// both reflect the active badges.
function generateSeasonStats(ovr, f, h, fr, mods = {}) {
  const m = k => mods[k] || 0;
  const jitter = () => 1 + randInt(-8, 8) / 100;
  const ovrFactor = clamp((ovr - 48) / 50, 0.35, 1);
  // EVERY box-score volume stat tracks its OWN driving attribute, not overall
  // OVR. Multiplying by ovrFactor (0.35-1.0) crushed specialists whose other
  // categories were weak: a 94-Finishing scorer fell to ~11 PPG (fixed
  // earlier), and a 90-Playmaking passer fell to ~3.6 APG because a weak
  // Defense/Rebounding/athleticism dragged OVR to ~54 => ovrFactor 0.35. All volume
  // stats now use the same light team-role dampener (x0.85-1.0) instead, so
  // the driving attribute — Playmaking for APG, Rebounding for RPG, Defense
  // for SPG/BPG — sets the output regardless of unrelated weaknesses.
  const oppFactor = 0.85 + 0.15 * ovrFactor;
  const scoring = (f.Shooting + f.Finishing) / 2;
  // PPG is anchored directly to the scoring skills with a proper ceiling: the
  // 0.63 slope off a rating-45 baseline gives decent (scoring ~75) builds
  // ~19 PPG, strong (~82) ~23, and reserves 28+ all-time volume for genuinely
  // elite (~90+) Shooting/Finishing. Earlier `4 + (scoring-25)*0.42` was too
  // hot in the middle — a scoring-75 build hit ~25 PPG, all-star-averages for
  // a merely-good scorer — so it's re-anchored to make the top end mean
  // something. oppFactor (0.85-1.0) is a light team-role dampener only.
  const ppg = clamp(0.63 * (scoring - 45) * oppFactor * jitter() + m("ppg"), 3, 35);
  const apg = clamp((0.5 + (f.Playmaking - 25) * 0.15) * oppFactor * jitter() + m("apg"), 0.5, 11.5);
  const rpg = clamp((1 + (f.Rebounding - 25) * 0.155 + (h - 50) * 0.05) * oppFactor * jitter() + m("rpg"), 1, 15);
  // smaller, leaner builds poke more passing lanes; bigger builds protect the rim
  const spg = clamp((0.2 + (f.Defense - 25) * 0.03 + (60 - h) * 0.008 + (60 - fr) * 0.004) * oppFactor * jitter() + m("spg"), 0.2, 3.6);
  const bpg = clamp((0.1 + (f.Defense - 25) * 0.022 + (h - 60) * 0.03 + (fr - 60) * 0.008) * oppFactor * jitter() + m("bpg"), 0.2, 3.6);
  // threes come from Shooting alone; very tall or Powerful builds live closer to the rim
  const tallPenalty = h >= 85 ? (h - 85) * 0.03 : 0;
  const bulkPenalty = fr >= 90 ? 0.6 : 0;
  const tpg = clamp(((f.Shooting - 40) * 0.08 - tallPenalty - bulkPenalty) * oppFactor * jitter() + m("tpg"), 0, 5.2);
  // Shooting percentages are efficiency, not volume — derived from the scoring
  // skills, NOT scaled by ovrFactor, with a small per-season wobble.
  const jPct = () => randInt(-2, 2);
  const fgPct = clamp(45 + (scoring - 25) * 0.27 + jPct() + m("fgPct"), 42, 66);
  const tptPct = clamp(30 + (f.Shooting - 40) * 0.254 + jPct() + m("tptPct"), 28, 47);
  const r1 = v => Math.round(v * 10) / 10;
  return { ppg: r1(ppg), apg: r1(apg), rpg: r1(rpg), spg: r1(spg), bpg: r1(bpg), tpg: r1(tpg), fgPct: r1(fgPct), tptPct: r1(tptPct) };
}

// ---- Season / career sim ----
function simSeason(ovr, scr, varianceRange, isRookie = false, defRating = 0) {
  const variance = randInt(-varianceRange, varianceRange);
  let wins = Math.round(41 + (ovr - 75) * 0.9 + (scr - 60) * 0.35 + variance);
  wins = clamp(wins, 12, 73);

  let madePlayoffs = wins >= 42;
  let ring = false;
  let finalsAppearance = false;
  let roundsWon = 0;

  if (madePlayoffs) {
    let opponentBase = 70;
    for (let round = 1; round <= 4; round++) {
      const oppRating = clamp(opponentBase + round * 5 + randInt(-5, 5), 60, 98);
      const gameWinPct = clamp(0.5 + (((ovr + scr) / 2) - oppRating) * 0.01, 0.15, 0.85);
      let wWins = 0, lWins = 0;
      while (wWins < 4 && lWins < 4) {
        if (rng() < gameWinPct) wWins++; else lWins++;
      }
      if (wWins === 4) {
        roundsWon++;
        if (round === 4) ring = true;
        if (round === 3) finalsAppearance = true;
      } else {
        break;
      }
    }
  }

  // All-Star is a pure OVR gate (70+). All-NBA (selection AND 1st/2nd/3rd tier)
  // is decided later in simCareer by allNbaSelection(), which sees the season's
  // real box score and hardware — raw OVR alone flattened every qualifying
  // season of a modest-OVR scorer to 3rd team regardless of how dominant it was.
  const allStar = ovr >= 70;

  // MVP odds SCALE with how dominant the season was, rather than a flat roll at
  // the qualifying line. A flat 35% meant a merely-eligible 80-OVR/50-win year
  // and a historically unprecedented 99-OVR/70-win year were equally likely to
  // win it — so a build posting an all-time statline every season still lost
  // the award roughly two years in three. Now clearing the bar barely is a long
  // shot (~8%), while a season that clears it by a wide margin on a winning
  // team takes it the large majority of the time.
  let mvp = false;
  if (ovr >= 80 && wins >= 50) {
    const ovrEdge = Math.min(1, (ovr - 80) / 14);  // 80 -> 0.0, 94+ -> 1.0
    const winEdge = Math.min(1, (wins - 50) / 18); // 50 -> 0.0, 68+ -> 1.0
    mvp = rng() < 0.08 + 0.82 * (0.65 * ovrEdge + 0.35 * winEdge);
  }

  let finalsMVP = ring && ovr >= 78;

  // Rookie of the Year: first simulated season only. ROTY is contested by one
  // draft class, not the whole league, so a debut of any real quality wins it
  // most years — the old "OVR 72+, then a 50/50 roll" made it an All-Star-only
  // lottery that a perfectly respectable Starter-tier rookie could never win
  // (an OVR-67 build peaks at 70 and was locked out entirely). Odds now ramp
  // from ~3% at bust level to ~88% once the season clears a modest bar.
  let roty = false;
  if (isRookie) {
    const edge = clamp((ovr - 50) / 12, 0, 1); // 50 -> 0.0, 62+ -> 1.0
    roty = rng() < 0.03 + 0.85 * edge;
  }

  // Defensive Player of the Year: gated on the build's post-modifier DEFENSE
  // rating specifically, not overall OVR — a defensive specialist with a
  // modest OVR can still win it. Eligibility now requires ELITE defense (90+),
  // and even then the per-season odds are low: the real all-time record is 4,
  // and it takes anchor-level, generational defense. The old "Defense 80 →
  // rng() < 0.3" handed a merely-good defender ~6 expected DPOYs over 20
  // seasons (one build won 9). The ramp below tops out at ~0.094 for a 99
  // Defense, so even a perfect-defense 20-season career averages <2 and lands
  // in the realistic 0-4 range essentially always.
  let dpoy = false;
  if (defRating >= 90) dpoy = rng() < (0.04 + (defRating - 90) * 0.006);

  // All-Defensive Team: the defensive analogue of All-NBA, keyed on the build's
  // DEFENSE rating rather than overall OVR. Defense gets its own +/-3 season
  // swing (same shape as seasonOVR) so a strong defender isn't simply all-or-
  // nothing every year. Real All-Defensive has two teams, not three. The ladder
  // reads: 85+ is a genuine stopper (2nd), 92+ is generational (1st), with
  // DPOY's 90 eligibility sitting between them.
  // The swing is +/-5 rather than seasonOVR's +/-3 on purpose: defRating is a
  // single constant attribute, so a narrow band made this all-or-nothing (a
  // Defense-77 build got zero forever, a Defense-87 build made it ~85% of
  // seasons). A wider band grades the middle instead of cliff-edging it — the
  // same dead-zone trap All-NBA fell into twice.
  const seasonDef = clamp(defRating + randInt(-5, 5), 25, 99);
  let allDefensive = null;
  if (seasonDef >= 93) allDefensive = "1st";
  else if (seasonDef >= 85) allDefensive = "2nd";

  return { wins, madePlayoffs, ring, finalsMVP, allStar, mvp, roty, dpoy, allDefensive, roundsWon };
}

// All-NBA selection AND 1st/2nd/3rd tier from a season's real quality, called
// from simCareer once the box score and hardware are known. Qualification keeps
// overall OVR as the spine — with a small, capped assist so an elite-but-modest-
// OVR scorer isn't shut out — while the tier split is driven by how dominant the
// season actually was (scoring, efficiency, and DPOY/MVP hardware). This is what
// stops a genuinely great two-way year from flattening to 3rd team just because
// the build's overall OVR is held down by weak non-scoring categories.
function allNbaSelection(seasonOVR, stats, mvp, dpoy) {
  // Qualify on OVR alone (71+), a uniform gate so the qualifying pool spans the
  // full range of season quality — a DPOY-anchor season always makes it. This
  // is deliberately decoupled from the tier below: if scoring gated entry too,
  // every qualifying season would already be a big-scoring one and the tiers
  // would collapse to a single band.
  if (seasonOVR < 71 && !dpoy) return null;
  if (mvp) return "1st"; // an MVP season is a 1st-team season, always
  // Tier: how dominant was THIS season? OVR base, lifted by heavy scoring, elite
  // efficiency, and a DPOY anchor — so a 26/66 year reads 2nd and pairing it with
  // DPOY reads 1st, while a bare qualifying season stays 3rd.
  const quality = seasonOVR
    + Math.max(0, stats.ppg - 20) * 0.55
    + Math.max(0, stats.fgPct - 52) * 0.18
    + (dpoy ? 5 : 0);
  if (quality >= 80) return "1st";
  if (quality >= 77) return "2nd";
  return "3rd";
}

const GAMES_PER_SEASON = 82;

// Peak OVR is reported on a full 25-99 scale, while the SIMULATION keeps running
// on its own raw scale. Those are deliberately different things. Under the $100M
// cap the best possible allocation tops out at a raw peak of 83 (solved exactly:
// concave-hull optimisation over every height/athleticism pair, cross-checked by
// randomized local search), so a raw peak is compressed into 25..83 and the top
// of the published ladder would be unreachable. This maps that achievable band
// onto the full 25..99 the player sees, so the tier floors read as the published
// numbers (Bust <60 ... GOAT 95+) without touching the economy, the award gates
// or generateSeasonStats — all of which stay on the raw scale.
function scaleOVR(raw) {
  return clamp(Math.round((raw - 25) * (74 / 58) + 25), 25, 99);
}

function simCareer(ovr, team, mods = {}) {
  // Career length scales with quality: a genuinely bad player gets cut, he does
  // not log 15+ seasons. A flat randInt(15,20) kept Draft-Bust builds in the
  // league two decades. Anchors: OVR 45 and below -> ~3-7 seasons (out by year
  // 5-6), the middle scales through, and OVR 78+ still gets the full 15-20 —
  // so strong builds (the greedy-optimal build sits at exactly 78) are
  // unchanged and the tier distribution stays put.
  // Interpolating the RANGE ENDS (rather than a midpoint +/- jitter) matters:
  // at OVR 78+ this resolves to exactly randInt(15, 20), so the old behaviour
  // for strong builds is reproduced bit for bit and their tier distribution is
  // untouched. A midpoint-plus-jitter version clamped at 20 quietly truncated
  // the upper tail and pushed the perfect build's GOAT rate up ~7 points.
  const lenT = clamp((ovr - 45) / 33, 0, 1);  // 45 -> 0.0, 78+ -> 1.0
  const numSeasons = randInt(Math.round(3 + lenT * 12), Math.round(7 + lenT * 13));
  const seasons = [];
  let rings = 0, mvps = 0, finalsMVPs = 0, allNBAs = 0, allStars = 0, careerWins = 0, peakOVR = scaleOVR(ovr);
  let bestMVPOVR = 0; // OVR of the strongest MVP-winning season (0 if none)
  let roty = 0, dpoys = 0; // Rookie of the Year (0/1), Defensive Player of the Year (repeatable)
  let allDefensives = 0;   // All-Defensive Team selections (1st or 2nd), repeatable
  const varianceRange = state.positionFit ? 4 : 8;
  const f = finalSkills();
  const totals = { pts: 0, ast: 0, reb: 0, stl: 0, blk: 0, threes: 0 };
  let fgSum = 0, tptSum = 0; // percentages are averaged, not summed
  let bestSeason = null;

  for (let i = 0; i < numSeasons; i++) {
    const seasonOVR = clamp(ovr + randInt(-3, 3), 25, 99);
    peakOVR = Math.max(peakOVR, scaleOVR(seasonOVR)); // seasonOVR itself stays raw for the award gates
    // Filling the team's positional need lifts the supporting cast a touch.
    const teamScr = team.scr + (state.teamNeedMet ? 5 : 0);
    const scrThisYear = clamp(teamScr + randInt(-5, 5), 15, 99);
    const result = simSeason(seasonOVR, scrThisYear, varianceRange, i === 0, f.Defense);
    careerWins += result.wins;
    if (result.ring) rings++;
    if (result.mvp) { mvps++; bestMVPOVR = Math.max(bestMVPOVR, scaleOVR(seasonOVR)); }
    if (result.finalsMVP) finalsMVPs++;
    if (result.allStar) allStars++;
    if (result.roty) roty = 1;
    if (result.dpoy) dpoys++;
    if (result.allDefensive) allDefensives++;

    const stats = generateSeasonStats(seasonOVR, f, state.height.rating, state.athleticism.rating, mods);
    // All-NBA needs the season's box score + hardware, so it's resolved here.
    result.allNBA = allNbaSelection(seasonOVR, stats, result.mvp, result.dpoy);
    if (result.allNBA) allNBAs++;
    totals.pts += stats.ppg * GAMES_PER_SEASON;
    totals.ast += stats.apg * GAMES_PER_SEASON;
    totals.reb += stats.rpg * GAMES_PER_SEASON;
    totals.stl += stats.spg * GAMES_PER_SEASON;
    totals.blk += stats.bpg * GAMES_PER_SEASON;
    totals.threes += stats.tpg * GAMES_PER_SEASON;
    fgSum += stats.fgPct;
    tptSum += stats.tptPct;
    const peakScore = stats.ppg + stats.apg * 1.5 + stats.rpg;
    if (!bestSeason || peakScore > bestSeason.peakScore) bestSeason = { year: i + 1, peakScore, ...stats };

    seasons.push({ ...result, stats });
  }
  Object.keys(totals).forEach(k => { totals[k] = Math.round(totals[k]); });

  // MVPs escalate: 12 each, plus +15 for every MVP beyond the first. A
  // multi-MVP haul is a dominance signal, not a stat line — without the
  // bonus, a 4-MVP / 18x All-NBA career (score ~589) capped at Superstar
  // below the Legend line (600), which read as a design gap.
  // DPOY counts like an All-NBA nod per occurrence; ROTY is a small one-time bonus.
  const goatScore = Math.round(
    peakOVR * 4 +
    rings * 15 +
    mvps * 12 + Math.max(0, mvps - 1) * 15 +
    finalsMVPs * 10 +
    allNBAs * 3 +
    allStars * 1 +
    dpoys * 3 +
    allDefensives * 2 +
    roty * 2 +
    careerWins / 10
  );

  const avgFgPct = Math.round(fgSum / numSeasons * 10) / 10;
  const avgTptPct = Math.round(tptSum / numSeasons * 10) / 10;
  return { numSeasons, seasons, rings, mvps, finalsMVPs, allNBAs, allStars, roty, dpoys, allDefensives, careerWins, peakOVR, bestMVPOVR, goatScore, totals, avgFgPct, avgTptPct, bestSeason };
}

// ---- Tier ladder ----
// Score mins calibrated to the salary curve + rescaled award gates (which
// award MVPs/All-NBA/rings at lower OVRs, inflating scores): set from
// 5000-run percentiles on the best team — GOAT 755 = ~p96 of the PERFECT
// (base-80) build (~3-5% GOAT for perfect play; re-anchored from 690 when
// the escalating MVP bonus lifted the top tail), Legend 600 = ~p50 of that
// build, Superstar 465 = ~p50 of a strong maxed-out (base-73) build.
// GOAT Score buckets, rebalanced onto the scaled-peak distribution (peakOVR * 4
// is a term in goatScore, so rescaling peak moved every score up). Only the
// bottom three are load-bearing: tiers All-Star and up are decided by the floors
// in tierForCareer, and anything failing those is capped below All-Star. The old
// Bench 100 / Starter 150 sat BELOW the entire population that reaches them
// (which scores 175+), so Draft Bust and Bench Piece were literally unreachable —
// every failing build landed Starter. The upper mins are kept consistent with
// observed scores at those tiers so tierForScore stays coherent.
const TIERS = [
  { name: "Draft Bust", min: -Infinity },
  { name: "Bench Piece", min: 280 },
  { name: "Starter", min: 360 },
  { name: "All-Star", min: 450 },
  { name: "Superstar", min: 560 },
  { name: "Legend", min: 680 },
  { name: "GOAT", min: 820 },
];

function tierForScore(score) {
  let result = TIERS[0];
  for (const t of TIERS) {
    if (score >= t.min) result = t;
  }
  return result;
}

// Top tiers demand a truly elite build, not just longevity: a career must
// clear BOTH the score threshold AND the peak-OVR floor. Miss the floor and
// you drop until a tier's floor (if any) is satisfied.
// The intended thresholds on a 0-99 OVR scale: a genuinely elite PEAK is
// required for the top tiers, so a merely-very-good build can't reach them on
// volume/longevity alone. Re-run the balance sim if the category count,
// budget, or cost curve changes.
// Calibrated to the salary curve's DP-verified ceiling: max base OVR 80,
// max peak ~83 with the +3 season roll. GOAT at 82 needs a near-perfect
// build (base 79+) plus a hot season; at 84+ GOAT would be mathematically
// unreachable — the trap to avoid when retuning.
// The published ladder, on the 25-99 scaled peak axis (see scaleOVR):
//   Draft Bust <60 | Bench 60-70 | Starter 70-80 | All-Star 80-85
//   Superstar 85-90 | Legend 90-95 | GOAT 95-99
const TIER_OVR_FLOORS = {
  "Bench Piece": 60, "Starter": 70, "All-Star": 80,
  "Superstar": 85, "Legend": 90, "GOAT": 95,
};

// Award-count floors per tier — the same AND-gate pattern as TIER_OVR_FLOORS:
// a career must clear EVERY requirement of a tier (score, OVR floor, and all
// award counts) or it drops to the tier below and is re-checked there.
// `hardware` = rings + Finals MVPs combined. Calibrated against 15-20 season
// careers: Legend's 14 All-Star / 12 All-NBA is clearable by a 15-season
// career that stars nearly every year (the low end of the requested ~15/~13,
// so short-career greats aren't mathematically locked out), while GOAT's
// 18+ All-Star line deliberately requires an 18-20 season career of sustained
// dominance — rare by construction, but reachable.
// The All-Star tier is gated on ACTUAL All-Star selections alone. It used to
// also require 3 All-NBA nods, which capped a legitimate 7x All-Star / 2x
// All-NBA career at *Starter* — no tier sits between them, so failing the
// All-NBA sub-gate dropped it two tiers. Being a repeat All-Star IS the
// All-Star tier; All-NBA requirements start at Superstar.
// Superstar sits at 11/7 rather than 9/6 to space the ladder: All-Star seasons
// need OVR 70 and All-NBA 71, so the two counts move together (mean gap 1.7) and
// a 9-All-Star floor left only a 6-8 window mapping to the All-Star tier — 77% of
// qualifying careers jumped straight to Superstar. 6 -> 11 -> 14 -> 18 spreads it.
const TIER_AWARD_FLOORS = {
  "All-Star":  { allStars: 6 },
  "Superstar": { allStars: 11, allNBAs: 7 },
  "Legend":    { allStars: 14, allNBAs: 12, mvps: 1 },
  "GOAT":      { allStars: 18, allNBAs: 15, mvps: 4, hardware: 4 },
};
// FAIL-SAFE: a missing career counts every award as ZERO, so it fails every
// floor. The old `if (!req || !career) return true` was fail-OPEN — any caller
// that forgot to pass the career silently disabled all award floors, which is
// how a 0-award build reached All-Star. Absent data can now only demote.
// ALTERNATE QUALIFYING PATHS to a tier's peak-OVR floor.
//
// The peak-OVR floor is an AND-gate, and for a long time it was an absolute
// one: the ONLY way past it was a high tracked peakOVR. That is the root cause
// behind a bug reported and re-patched at least four times — a career that
// maxed out its award record (e.g. 20x All-NBA / 20x All-Star) but peaked at
// OVR 73 failed Superstar/Legend/GOAT on the OVR gate alone and fell to
// All-Star, the one floor tier with no OVR requirement. Each past fix bolted on
// one narrow escape hatch (MVP-season OVR, then DPOY count) instead of naming
// the general rule, so the next shape of dominant-but-modest-OVR career fell
// straight back through.
//
// The general rule: OVR is a PROXY for greatness, so overwhelming direct
// evidence of greatness must be able to stand in for it. Three routes qualify:
//   dpoys    — defensive dominance (peak Russell / prime Mutombo)
//   allNBAs  — sustained award dominance, well above the tier's own award floor
//   volume   — elite career totals: points AND longevity AND winning, together
// Any ONE route clears the peak-OVR floor and waives that tier's MVP
// requirement. The All-Star / All-NBA / hardware floors always still apply, so
// this is a route to the tier, never a blanket bypass.
//
// Regression coverage for all of this lives in test-tiers.js — run it after
// touching anything here.
// `waivesMvp` is deliberately false for GOAT. MVPs ARE the defining credential
// of the top tier, and All-NBA is cheap to accumulate here (any season at OVR
// 71+ qualifies), so letting an All-NBA count waive GOAT's 4-MVP floor promoted
// the plain budget-optimal build from Superstar straight to GOAT ~18% of runs.
// At Legend the floor is a single MVP, which a defensive or volume-scoring
// great can legitimately never win — so the waiver belongs there and only there.
// Superstar was missing an entry, which made it HARDER than Legend: Legend could
// clear its OVR floor via an alternate path while Superstar could not, so a build
// with 15 All-NBA and a sub-floor peak skipped straight past Superstar. The three
// tiers now step Superstar - Legend - GOAT so the ladder is monotonic.
const TIER_ALT_PATHS = {
  "All-Star": { dpoys: 1, allNBAs: 5,  points: 16000, seasons: 10, wins: 500,  waivesMvp: true },
  Superstar: { dpoys: 1, allNBAs: 10, points: 24000, seasons: 14, wins: 700,  waivesMvp: true },
  Legend:    { dpoys: 2, allNBAs: 15, points: 32000, seasons: 17, wins: 850,  waivesMvp: true },
  GOAT:      { dpoys: 3, allNBAs: 20, points: 40000, seasons: 19, wins: 1000, waivesMvp: false },
};
function hasAltPath(tierName, career) {
  const alt = TIER_ALT_PATHS[tierName];
  if (!alt || !career) return false;
  if ((career.dpoys || 0) >= alt.dpoys) return true;
  if ((career.allNBAs || 0) >= alt.allNBAs) return true;
  const pts = (career.totals && career.totals.pts) || 0;
  return pts >= alt.points
    && (career.numSeasons || 0) >= alt.seasons
    && (career.careerWins || 0) >= alt.wins;
}
// Whether an alt path at this tier may also stand in for the MVP award floor.
function altPathWaivesMvp(tierName, career) {
  const alt = TIER_ALT_PATHS[tierName];
  return !!(alt && alt.waivesMvp) && hasAltPath(tierName, career);
}

// `altPath` substitutes ONLY for the MVP requirement here — All-Star / All-NBA
// / hardware floors still stand, so this is a route to the tier, not a bypass.
function meetsAwardFloor(tierName, career, altPath = false) {
  const req = TIER_AWARD_FLOORS[tierName];
  if (!req) return true; // Starter and below carry no award requirement
  const c = career || {};
  if ((c.allStars || 0) < (req.allStars || 0)) return false;
  if ((c.allNBAs || 0) < (req.allNBAs || 0)) return false;
  if (!altPath && (c.mvps || 0) < (req.mvps || 0)) return false;
  if (req.hardware && ((c.rings || 0) + (c.finalsMVPs || 0)) < req.hardware) return false;
  return true;
}

// One gate for a tier: BOTH the peak-OVR floor and the award floor must pass.
// Every tier assignment routes through this — there is no path that sets a
// tier without running both checks. TIER_ALT_PATHS above supplies the alternate
// routes (alongside the MVP-season OVR already folded into effectivePeak): any
// one clears the peak-OVR floor AND waives the MVP award requirement.
function meetsTierFloors(tierName, effectivePeak, career) {
  const ovrFloor = TIER_OVR_FLOORS[tierName];
  if (ovrFloor && effectivePeak < ovrFloor && !hasAltPath(tierName, career)) return false;
  return meetsAwardFloor(tierName, career, altPathWaivesMvp(tierName, career));
}

// A tier's OVR floor is satisfied by EITHER the tracked career peak OR the
// best MVP-winning season's OVR: winning MVP is proof of a floor-worthy
// season, so a technicality in peak tracking can never cap an MVP winner.
// (Today this is a safety invariant rather than a live branch — peakOVR is
// the max over all seasons so it always >= bestMVPOVR, and the MVP gate (80)
// equals the Legend floor — but it guards any future retune where the MVP
// gate drops below a floor or peak tracking changes.)
// `career` (when passed) additionally enforces TIER_AWARD_FLOORS above.
// PREFERRED CALL: tierForCareer(career) — the career object carries score,
// peak OVR and every award count, so the floors can never be accidentally
// bypassed. The legacy positional form (score, peakOVR, bestMVPOVR, career)
// still works, but omitting the career now counts awards as zero (fail-safe)
// instead of skipping the award floors entirely.
// Starts at the tier the raw GOAT Score implies, then walks DOWN one tier at a
// time and returns the HIGHEST tier whose FULL requirements (score bucket +
// peak-OVR floor + award floors) are all satisfied.
function tierForCareer(career, ...legacy) {
  let score, effectivePeak, c;
  if (typeof career === "number") {
    const [peakOVR = 0, bestMVPOVR = 0, careerArg = null] = legacy;
    score = career;
    effectivePeak = Math.max(peakOVR, bestMVPOVR);
    c = careerArg;
  } else {
    c = career || null;
    score = c ? c.goatScore : -Infinity;
    effectivePeak = c ? Math.max(c.peakOVR, c.bestMVPOVR || 0) : 0;
  }
  // Tiers All-Star and up are decided by REAL ACCOMPLISHMENTS (award floors +
  // peak-OVR floor), walking down from GOAT to the highest one fully met. The
  // GOAT Score bucket no longer gates them: a 15x All-Star / 8x All-NBA career
  // scores only ~410 (All-Star = 1pt each, peakOVR*4 dominates) and so was
  // capped at All-Star despite clearing Superstar's 9 AS / 6 AN floor outright.
  // Below All-Star there are no award floors, so those tiers stay score-ranked.
  const firstFloorTier = TIERS.findIndex(t => TIER_AWARD_FLOORS[t.name]);
  for (let i = TIERS.length - 1; i >= firstFloorTier; i--) {
    if (meetsTierFloors(TIERS[i].name, effectivePeak, c)) return TIERS[i];
  }
  // No floor tier earned. Below All-Star there are no award floors, so rank by
  // BOTH the published peak-OVR band and the GOAT Score bucket and take the
  // LOWER of the two — that way the score bucket and the OVR floor agree with
  // each other instead of one silently overriding the other.
  let byOvr = 0;
  for (let i = firstFloorTier - 1; i >= 0; i--) {
    const f = TIER_OVR_FLOORS[TIERS[i].name];
    if (!f || effectivePeak >= f) { byOvr = i; break; }
  }
  let byScore = TIERS.indexOf(tierForScore(score));
  if (byScore >= firstFloorTier) byScore = firstFloorTier - 1;
  return TIERS[Math.max(0, Math.min(byOvr, byScore))];
}

// Hall of Fame: a top-tier career (Superstar+) — OR the very-good/long-career
// path many real Hall of Famers took: a 10+ season career with 5+ All-Star nods
// even without ever reaching a top tier.
function isHallOfFame(career, tier) {
  const tierIdx = TIERS.findIndex(t => t.name === tier.name);
  const superstarIdx = TIERS.findIndex(t => t.name === "Superstar");
  if (tierIdx >= superstarIdx) return true;
  return career.numSeasons >= 10 && career.allStars >= 5;
}

// ---- Percentile (z-score approx against assumed distribution) ----
function percentileForScore(score) {
  const mean = 230, stdev = 110;
  const z = (score - mean) / stdev;
  // Approximation of normal CDF
  const cdf = 0.5 * (1 + erf(z / Math.sqrt(2)));
  const topPct = clamp((1 - cdf) * 100, 0.1, 99.9);
  return topPct;
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

// ---- Badges ----
// One-phrase criteria shown as hover tooltips; keep in sync with computeBadges.
const BADGE_INFO = {
  // ---- original set ----
  "Unicorn Build": "Elite height (85+) paired with elite Shooting (85+)",
  "Small Ball Terror": "Undersized build (height 40 or less) with elite 85+ Rebounding",
  "Two-Way Monster": "Elite on both ends: 88+ Defense plus an 88+ scoring skill",
  "Full Send": "Committed $97M+ of the $100M cap",
  "Positional Anomaly": "Played a position the build doesn't naturally fit",
  "Certified Bust": "GOAT Score under 100 — this build never got going",
  // ---- skill / physical archetypes ----
  "3-Point Sniper": "88+ Shooting without elite athleticism — wins on pure shotmaking",
  "Stretch Big": "A 6'11\"+ big with 82+ Shooting — spaces the floor from the frontcourt",
  "Mid-Range Maestro": "Elite shot creation: 84+ Shooting, 82+ Handles, and 80+ Finishing",
  "Post-Up Punisher": "88+ Finishing without elite athleticism — scores on craft and footwork",
  "Slasher": "88+ Finishing and 82+ Handles on a guard or wing — lives at the rim",
  "Rim Protector": "88+ Defense at 6'11\"+ — anchors the paint",
  "Perimeter Lockdown": "88+ Defense at 6'7\" or shorter — smothers ball-handlers",
  "Playmaking Savant": "Elite 90+ Playmaking — sees the whole floor",
  "Floor General": "84+ Playmaking and Handles on a true guard (6'4\" or under)",
  "Handles God": "Elite 92+ Handles — ankle-breaking ball control",
  "Glass Cleaner": "Elite 90+ Rebounding — owns the boards",
  "Two-Way Wing": "A 6'6\"–6'9\" wing with 84+ Defense and 84+ Shooting — the 3-and-D ideal",
  "Point Center": "A 6'11\"+ big with 82+ Playmaking and 75+ Handles — a point center",
  "Point Forward": "A 6'7\"–6'10\" forward with 85+ Playmaking — initiates from the wing",
  "Undersized Menace": "6'2\" or under with 85+ Finishing or Defense — punches above his size",
  "Twitchy Guard": "Sub-6'3\" with 88+ Handles and 82+ Shooting — a shifty microwave scorer",
  "Towering Giant": "7'2\" or taller — a skyscraper in the paint",
  "Waterbug": "5'9\" or shorter — tiny, quick, and fearless",
  "Defensive Anchor": "88+ Defense and 85+ Rebounding but can't shoot (55 or below)",
  "Glass Cannon": "85+ scoring with 50-or-below Defense AND Rebounding — all offense",
  // ---- career outcomes: awards & stats ----
  "Ringless Legend": "Legend-caliber career (450+ GOAT Score) with zero championships",
  "Champion": "Won at least one championship",
  "Dynasty Builder": "Won 3 or more championships — built a dynasty",
  "MVP": "Won at least one league MVP",
  "MVP Machine": "Won 3 or more MVPs — perennial best in the world",
  "Finals Hero": "Won Finals MVP — delivered on the biggest stage",
  "Perennial All-Star": "Made 12 or more All-Star teams",
  "All-NBA Fixture": "Named All-NBA 8 or more times",
  "Volume Scorer": "35,000+ career points — a scoring machine",
  "Empty Stats": "30,000+ points but the wins never came (under 45 a season)",
  "Dime Machine": "8,000+ career assists — an elite distributor",
  "Board Man": "11,000+ career rebounds — a generational glass-eater",
  "Rim Guardian": "2,500+ career blocks — a wall at the rim",
  "Ball Hawk": "2,000+ career steals — relentless in the passing lanes",
  "Splash Archive": "2,500+ career made threes — a lifetime of splashes",
  "Perennial Contender": "Averaged 55+ wins a season — always in the hunt",
  "Peak Merchant": "A 32+ PPG peak season — carried the offense",
  "Walking Triple-Double": "A peak year of 22+ PPG, 8+ APG, and 8+ RPG",
  "Iron Man": "Played a full 20-season career — remarkable longevity",
  "GOAT Candidate": "600+ GOAT Score — squarely in the all-time conversation",
  // ---- build strategy / budget ----
  "Balanced Build": "No skill outweighs another by more than 20 — a well-rounded build",
  "All In": "Extreme min-max: 2+ elite (90+) skills alongside 2+ glaring holes (45 or below)",
  "Bargain Hunter": "80+ OVR while committing $80M or less — ruthless value",
  "Need Filler": "Signed with a team that needed your position",
};

function computeBadges(ovr, career) {
  const f = finalSkills();
  const SH = f.Shooting, FI = f.Finishing, PL = f.Playmaking, HA = f.Handles, DE = f.Defense, RE = f.Rebounding;
  const skills = [SH, FI, PL, HA, DE, RE];
  const h = state.height.rating, ath = state.athleticism.rating;
  const t = career.totals, b = career.bestSeason;
  const scoring = Math.max(SH, FI);
  const eliteCount = skills.filter(s => s >= 90).length;
  const weakCount = skills.filter(s => s <= 45).length;
  const spread = Math.max(...skills) - Math.min(...skills);
  const winsPerSeason = career.careerWins / career.numSeasons;
  // Each earned badge carries a match-strength score (roughly 0-100): rarer /
  // more elite / more strongly-cleared badges score higher, so a build with
  // many badges surfaces its most defining ones. add(name, score).
  const badges = [];
  const add = (name, score) => badges.push({ name, score });

  // ---- original set ----
  if (h >= 85 && SH >= 85) add("Unicorn Build", 90 + (h - 85 + SH - 85) / 2);
  if (h <= 40 && RE >= 85) add("Small Ball Terror", 82 + (RE - 85));
  if (DE >= 88 && (SH >= 88 || FI >= 88)) add("Two-Way Monster", 88 + (DE - 88 + scoring - 88) / 2);
  if (!state.sandbox && state.budgetSpent >= 9700) add("Full Send", 42);
  if (!state.positionFit) add("Positional Anomaly", 56);
  if (career.goatScore < 100) add("Certified Bust", 45);

  // ---- skill / physical archetypes ----
  if (SH >= 88 && ath <= 52) add("3-Point Sniper", SH);
  if (h >= 82 && SH >= 82) add("Stretch Big", (SH + h) / 2);
  if (SH >= 84 && HA >= 82 && FI >= 80) add("Mid-Range Maestro", (SH + HA + FI) / 3);
  if (FI >= 88 && ath <= 55) add("Post-Up Punisher", FI);
  if (FI >= 88 && HA >= 82 && h <= 62) add("Slasher", (FI + HA) / 2);
  if (DE >= 88 && h >= 82) add("Rim Protector", DE);
  if (DE >= 88 && h <= 58) add("Perimeter Lockdown", DE);
  if (PL >= 90) add("Playmaking Savant", PL);
  if (PL >= 84 && HA >= 84 && h <= 48) add("Floor General", (PL + HA) / 2);
  if (HA >= 92) add("Handles God", HA);
  if (RE >= 90) add("Glass Cleaner", RE);
  if (h >= 52 && h <= 68 && DE >= 84 && SH >= 84) add("Two-Way Wing", (DE + SH) / 2 + 4);
  if (h >= 82 && PL >= 82 && HA >= 75) add("Point Center", (PL + HA) / 2 + 8);
  if (h >= 58 && h <= 75 && PL >= 85) add("Point Forward", PL + 3);
  if (h <= 40 && (FI >= 85 || DE >= 85)) add("Undersized Menace", Math.max(FI, DE) + 3);
  if (h <= 44 && HA >= 88 && SH >= 82) add("Twitchy Guard", (HA + SH) / 2);
  if (h >= 93) add("Towering Giant", h);
  if (h <= 25) add("Waterbug", 55 + (25 - h) * 2);
  if (DE >= 88 && RE >= 85 && SH <= 55) add("Defensive Anchor", (DE + RE) / 2);
  if (scoring >= 85 && DE <= 50 && RE <= 50) add("Glass Cannon", scoring);

  // ---- career outcomes: awards & stats ----
  if (career.rings === 0 && career.goatScore >= 450) add("Ringless Legend", 82);
  if (career.rings >= 1 && career.rings < 3) add("Champion", 68 + career.rings * 2);
  if (career.rings >= 3) add("Dynasty Builder", 96 + career.rings);
  if (career.mvps >= 1 && career.mvps < 3) add("MVP", 86 + career.mvps * 2);
  if (career.mvps >= 3) add("MVP Machine", 97 + career.mvps);
  if (career.finalsMVPs >= 1) add("Finals Hero", 90 + career.finalsMVPs * 2);
  if (career.allStars >= 12) add("Perennial All-Star", 62 + career.allStars / 2);
  if (career.allNBAs >= 8) add("All-NBA Fixture", 66 + career.allNBAs);
  if (t.pts >= 35000) add("Volume Scorer", 80 + (t.pts - 35000) / 2000);
  if (t.pts >= 30000 && winsPerSeason < 45) add("Empty Stats", 66);
  if (t.ast >= 8000) add("Dime Machine", 80 + (t.ast - 8000) / 1000);
  if (t.reb >= 11000) add("Board Man", 80 + (t.reb - 11000) / 1000);
  if (t.blk >= 2500) add("Rim Guardian", 80 + (t.blk - 2500) / 500);
  if (t.stl >= 2000) add("Ball Hawk", 76 + (t.stl - 2000) / 500);
  if (t.threes >= 2500) add("Splash Archive", 76 + (t.threes - 2500) / 500);
  if (winsPerSeason >= 55) add("Perennial Contender", 70 + (winsPerSeason - 55));
  if (b.ppg >= 32) add("Peak Merchant", 84 + (b.ppg - 32));
  if (b.ppg >= 22 && b.apg >= 8 && b.rpg >= 8) add("Walking Triple-Double", 90);
  if (career.numSeasons >= 20) add("Iron Man", 56);
  if (career.goatScore >= 600) add("GOAT Candidate", 95 + (career.goatScore - 600) / 20);

  // ---- build strategy / budget ----
  if (spread <= 20) add("Balanced Build", 48);
  if (eliteCount >= 2 && weakCount >= 2) add("All In", 62);
  if (!state.sandbox && ovr >= 80 && state.budgetSpent <= 8000) add("Bargain Hunter", 80 + (ovr - 80));
  if (state.teamNeedMet) add("Need Filler", 52);

  return badges.sort((a, b) => b.score - a.score);
}

// ---- Career highlight reel (sim loading screen) ----
// A handful of real moments pulled from the just-computed season-by-season
// data: firsts, every early ring/MVP, retirement.
// Full chronological career timeline for the sim-loading feed: rookie entry
// (+ROTY), then one line per notable year combining that season's honors
// (each All-Star selection with its ordinal, each All-NBA nod, MVP, DPOY,
// rings/Finals MVP), the career-best season, playoff firsts for quieter
// careers, and a retirement summary. A great career yields ~15-22 lines; the
// loading screen paces them across 10-14s so it reads as a career unfolding.
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function careerHighlights(career) {
  const h = [];
  let asCount = 0, anCount = 0, madePO = false;
  career.seasons.forEach((s, i) => {
    const yr = i + 1;
    const parts = [];
    if (i === 0) {
      let entry = `Drafted by the ${state.team.name} — ${s.stats.ppg} PPG as a rookie`;
      if (s.roty) entry += " · ROOKIE OF THE YEAR";
      h.push(`Year 1: ${entry}`);
    }
    if (s.allStar) { asCount++; parts.push(`All-Star (${ordinal(asCount)})`); }
    if (s.allNBA) { anCount++; parts.push(`All-NBA ${s.allNBA} Team (${ordinal(anCount)})`); }
    if (s.mvp) parts.push("WINS MVP");
    if (s.dpoy) parts.push("Defensive Player of the Year");
    if (s.ring) parts.push("NBA CHAMPION" + (s.finalsMVP ? " · Finals MVP" : ""));
    if (!parts.length && !madePO && s.madePlayoffs && i > 0) parts.push(`Leads the ${state.team.name} to the playoffs`);
    if (s.madePlayoffs) madePO = true;
    if (career.bestSeason && career.bestSeason.year === yr)
      parts.push(`career-best ${career.bestSeason.ppg}/${career.bestSeason.rpg}/${career.bestSeason.apg}`);
    if (parts.length && !(i === 0 && parts.length === 0)) {
      if (i === 0 && parts.length) h.push(`Year 1: ${parts.join(" · ")}`);
      else if (i > 0) h.push(`Year ${yr}: ${parts.join(" · ")}`);
    }
  });
  const summary = [];
  if (career.allStars) summary.push(`${career.allStars}× All-Star`);
  if (career.allNBAs) summary.push(`${career.allNBAs}× All-NBA`);
  if (career.rings) summary.push(`${career.rings} ring${career.rings === 1 ? "" : "s"}`);
  h.push(`Retires after ${career.numSeasons} seasons` + (summary.length ? ` — ${summary.join(", ")}` : ""));
  return h;
}

// ---- Scouting report (verdict narrative) ----
const ATH_ADJ = {
  Grounded: "ground-bound", Limited: "unspectacular", Solid: "capable",
  Athletic: "athletic", Explosive: "explosive", Elite: "freakishly explosive",
};

// ---- Playstyle comp ----
// The finished build's 8-D on-court profile: physicals raw, skills post-modifier.
const COMP_DIMS = ["height", "athleticism", ...SKILL_ORDER];
// Height and athleticism are physically defining, so they carry more weight than any
// single skill — without this a short body with forward-like skills could be
// outvoted across the 6 skill dims and match a much taller player.
const COMP_WEIGHTS = { height: 4, athleticism: 1.5, Shooting: 1, Finishing: 1, Playmaking: 1, Handles: 1, Defense: 1, Rebounding: 1 };
// Signature emphasis: a skill dimension where EITHER the build or the candidate
// is extreme (far from a ~55 average) is a defining trait, and a gap there
// should hurt far more than a gap on a middling dimension. Without this, a
// scoring guard with weak Playmaking (70) matched Tony Parker (elite 82+
// playmaker) because the 12-pt Playmaking gap — his signature skill — counted
// the same as any other and got outvoted. emphasis scales the squared diff up
// to ~3.5x for a maxed defining trait. Applies to skills only; the physical
// dims already carry fixed structural weights.
const COMP_SIG = 2.6;
function sigEmphasis(a, b) {
  const dev = Math.max(Math.abs(a - 55), Math.abs(b - 55)) / 44; // 0 at avg, ~1 at the extremes
  return 1 + COMP_SIG * Math.min(1, dev);
}
function buildProfile() {
  const f = finalSkills();
  const p = { height: state.height.rating, athleticism: state.athleticism.rating };
  SKILL_ORDER.forEach(s => { p[s] = f[s]; });
  return p;
}

// Comp players carry their real-world career accomplishments (rings, MVPs,
// Finals MVPs, All-NBA, All-Star) from data.js (COMP_ROWS). accompOf returns
// that record; the comp match weights trophy-case PROXIMITY (see accompDistance)
// so a heavily decorated build lands on real hardware and a great-but-ringless
// build lands on a great-but-ringless real player, not just the nearest skills.
const ZERO_ACCOMP = { rings: 0, mvps: 0, finalsMVPs: 0, allNBA: 0, allStar: 0 };
function accompOf(ref) { return ref.accomplishments || ZERO_ACCOMP; }

// Trophy-case proximity between a finished build's career and a comp player's
// real accomplishments. Weighted Euclidean, emphasizing HARDWARE (rings, MVPs,
// Finals MVPs) over the more skill-correlated volume awards (All-NBA/All-Star,
// which the attribute distance already captures indirectly). Bidirectional: a
// decorated build is pulled toward decorated players AND a ringless build
// toward ringless players.
const ACCOMP_WEIGHTS = { rings: 3, mvps: 3, finalsMVPs: 2, allNBA: 0.35, allStar: 0.2 };
function accompDistance(career, acc) {
  if (!career) return 0;
  const b = { rings: career.rings, mvps: career.mvps, finalsMVPs: career.finalsMVPs, allNBA: career.allNBAs, allStar: career.allStars };
  let sum = 0;
  for (const k of ["rings", "mvps", "finalsMVPs", "allNBA", "allStar"]) { const d = b[k] - acc[k]; sum += ACCOMP_WEIGHTS[k] * d * d; }
  return Math.sqrt(sum);
}

function compDistance(profile, ref) {
  let sum = 0;
  for (const d of COMP_DIMS) {
    const diff = profile[d] - ref.dims[d];
    const emph = SKILL_ORDER.includes(d) ? sigEmphasis(profile[d], ref.dims[d]) : 1;
    sum += COMP_WEIGHTS[d] * emph * diff * diff;
  }
  return Math.sqrt(sum);
}

// Closest real player by signature-weighted skill distance PLUS trophy-case
// proximity (ACCOMP_MATCH_WEIGHT * accompDistance) so the match respects both
// how a build plays and how decorated its career is. A full hardware mismatch
// (e.g. a 4-ring/2-MVP build vs a ringless comp) adds ~30 to the distance —
// enough to pull a heavily decorated build off a much-closer-on-skill but
// ringless player (it stopped matching a 4-ring build to Paul George) toward a
// similarly decorated one, while skill still discriminates among peers of like
// standing. Never position-filtered; ties break on name.
const ACCOMP_MATCH_WEIGHT = 3.5;
// Full comp pool ranked closest-first: skill distance + accolade proximity,
// ties broken alphabetically (so ordering is deterministic and the #1 match is
// identical to the old single-best loop). Returns the top `n` refs.
function topComps(profile, career = null, n = 3) {
  return COMP_PLAYERS
    .map(ref => ({ ref, dist: compDistance(profile, ref) + ACCOMP_MATCH_WEIGHT * accompDistance(career, accompOf(ref)) }))
    .sort((a, b) => a.dist - b.dist || (a.ref.name < b.ref.name ? -1 : 1))
    .slice(0, n)
    .map(x => x.ref);
}

function closestComp(profile, career = null) {
  return topComps(profile, career, 1)[0];
}

// Convenience for the verdict screen: returns { name, pos, reason }. Pass the
// career so a decorated build prefers a comp with matching real-life hardware.
function playstyleComp(career = null) {
  const profile = buildProfile();
  const top = topComps(profile, career, 3);
  const ref = top[0];
  // Reasoning is the hand-written per-player text stored on the comp record.
  // `shades` = the next-closest names (no reasoning), a supporting detail.
  return { name: ref.name, pos: ref.pos, reason: ref.reasoning, shades: top.slice(1).map(r => r.name) };
}

// What tier a build of this OVR "should" reach, for over/under-performance
// flavor — aligned with TIER_OVR_FLOORS on the integer-curve ceiling (~83).
function expectedTierIndex(ovr) {
  if (ovr >= 82) return 6; // GOAT-capable
  if (ovr >= 80) return 5; // Legend
  if (ovr >= 76) return 4; // Superstar
  if (ovr >= 71) return 3; // All-Star
  if (ovr >= 62) return 2; // Starter
  return 1;
}

function generateScoutingReport(career, ovr, tier) {
  const name = state.name || "The Mystery Player";
  const pos = POSITIONS[state.position].label.toLowerCase();
  const adj = ATH_ADJ[state.athleticism.label] || "unorthodox";
  const attr = topAttribute().toLowerCase();
  const b = career.bestSeason;
  const team = state.team.name;

  const buildArticle = /^[aeiou]/i.test(adj) ? "an" : "a";
  const s1 = `${name} was ${buildArticle} ${adj} ${state.height.label} ${pos} whose game ran through his ${attr}.`;

  let s2 = `At his Year ${b.year} peak he put up ${b.ppg} points, ${b.rpg} boards, and ${b.apg} assists a night`;
  if (career.rings > 0) {
    s2 += `, powering the ${team} to ${career.rings === 1 ? "a championship" : career.rings + " championships"}.`;
  } else if (career.mvps > 0) {
    s2 += ` — MVP-level stuff the ${team} never quite cashed in.`;
  } else {
    s2 += `, though the ${team} never got him over the hump.`;
  }

  const tierIdx = TIERS.findIndex(t => t.name === tier.name);
  const expIdx = expectedTierIndex(ovr);
  const article = /^[AEIOU]/i.test(tier.name) ? "an" : "a";
  let s4;
  if (tierIdx > expIdx) s4 = `The history books call him ${article} ${tier.name} — more than that build had any right to promise.`;
  else if (tierIdx < expIdx) s4 = `Built for more, remembered as ${article} ${tier.name} — the what-ifs write themselves.`;
  else s4 = `${article === "an" ? "An" : "A"} ${tier.name}, and exactly the career that build was always going to deliver.`;

  return `${s1} ${s2} ${s4}`;
}

// ---- Headline generator ----
function topAttribute() {
  const f = finalSkills();
  let best = SKILL_ORDER[0];
  SKILL_ORDER.forEach(s => { if (f[s] > f[best]) best = s; });
  return best;
}

function generateHeadline(career, tier) {
  const name = state.name || "The Mystery Player";
  const team = state.team.name;
  const attr = topAttribute();
  if (career.rings > 0) {
    return `${name.toUpperCase()} STUNS THE LEAGUE: ${team.toUpperCase()} RIDE ELITE ${attr.toUpperCase()} TO ${career.rings > 1 ? `${career.rings} RINGS` : "A RING"}`;
  }
  if (tier.name === "Draft Bust") {
    return `${name.toUpperCase()} FLAMES OUT IN ${team.toUpperCase()}: A CAUTIONARY TALE`;
  }
  return `${name.toUpperCase()} CARRIES ${team.toUpperCase()} ON ${attr.toUpperCase()} ALONE, FALLS SHORT OF A RING`;
}

// ===== "CHASING THE SHADOW" =====
// Compares a finished career against the chosen all-time great across the six
// benchmark metrics. Entirely separate from the OVR tier-floor and closest-comp
// logic — this is an additive lens, not a replacement. A metric is "beaten"
// when the build matches or exceeds the target's number. Peak PPG/APG/RPG come
// straight from the existing Best Season data.
// `weight` reflects what a metric actually signals about greatness. The three
// résumé pillars — Rings, MVPs, All-NBA — carry 3x the weight of ROTY, DPOY and
// the peak-stat categories, so piling up volume stats and minor hardware can
// never add up to "beating" a legend the way matching their MVP/All-NBA
// résumé does. Rings/MVPs/All-NBA are additionally a hard prestige gate below.
const SHADOW_METRICS = [
  { key: "rings",  label: "Rings",     get: c => c.rings,           tgt: t => t.rings,   decimals: 0, weight: 3, phrase: "the rings" },
  { key: "mvps",   label: "MVPs",      get: c => c.mvps,            tgt: t => t.mvps,    decimals: 0, weight: 3, phrase: "the MVPs" },
  { key: "allNBA", label: "All-NBA",   get: c => c.allNBAs,         tgt: t => t.allNBA,  decimals: 0, weight: 3, phrase: "the All-NBA nods" },
  { key: "roty",   label: "ROTY",      get: c => c.roty || 0,       tgt: t => t.roty,    decimals: 0, weight: 1, phrase: "Rookie of the Year" },
  { key: "dpoy",   label: "DPOY",      get: c => c.dpoys || 0,      tgt: t => t.dpoys,   decimals: 0, weight: 1, phrase: "Defensive Player of the Year" },
  { key: "ppg",    label: "Peak PPG",  get: c => c.bestSeason.ppg,  tgt: t => t.peakPPG, decimals: 1, weight: 1, phrase: "peak scoring" },
  { key: "apg",    label: "Peak APG",  get: c => c.bestSeason.apg,  tgt: t => t.peakAPG, decimals: 1, weight: 1, phrase: "peak playmaking" },
  { key: "rpg",    label: "Peak RPG",  get: c => c.bestSeason.rpg,  tgt: t => t.peakRPG, decimals: 1, weight: 1, phrase: "peak rebounding" },
];
// The résumé pillars that gate a true "dethroning": you must match ALL THREE.
const SHADOW_PILLARS = ["rings", "mvps", "allNBA"];

// { targetName, targetLabel, target, rows, beatCount, total, weightedBeat,
//   weightedTotal, resumeCleared, majority }
function compareToShadow(career) {
  const targetName = state.shadowTarget;
  const target = SHADOW_TARGETS[targetName];
  if (!target) return null;
  const rows = SHADOW_METRICS.map(m => {
    const build = m.get(career);
    const tv = m.tgt(target);
    return { key: m.key, label: m.label, phrase: m.phrase, decimals: m.decimals, weight: m.weight, build, target: tv, beat: build >= tv };
  });
  const beatCount = rows.filter(r => r.beat).length;
  const weightedBeat = rows.filter(r => r.beat).reduce((s, r) => s + r.weight, 0);
  const weightedTotal = rows.reduce((s, r) => s + r.weight, 0);
  // The prestige gate: all three résumé pillars (rings, MVPs, All-NBA) beaten.
  const resumeCleared = SHADOW_PILLARS.every(k => rows.find(r => r.key === k).beat);
  return {
    targetName, targetLabel: target.label, target, rows, beatCount, total: rows.length,
    weightedBeat, weightedTotal, resumeCleared,
    majority: weightedBeat * 2 >= weightedTotal, // weighted majority (informational)
  };
}

// The single canonical "you dethroned this legend" test — used by the verdict
// header, the triumphant narrative, the achievement, and the lifetime
// dethroned-legends list, so none of them can disagree. Requires BOTH clearing
// the target's résumé pillars AND a Legend/GOAT-tier career of one's own: a
// volume-stat "win" on an All-Star career is not a dethroning.
function tierIsLegendPlus(career) {
  const idx = TIERS.findIndex(t => t.name === tierForCareer(career).name);
  return idx >= TIERS.findIndex(t => t.name === "Legend");
}
function isDethroned(career) {
  const cmp = compareToShadow(career);
  return !!cmp && cmp.resumeCleared && tierIsLegendPlus(career);
}

// Verdict paragraph naming the SPECIFIC metrics beaten vs. fallen short of.
// Three shapes: clear dethroning, statistical win but ringless, clear fall-short.
function generateShadowVerdict(career) {
  const cmp = compareToShadow(career);
  if (!cmp) return "";
  const name = state.name || "The Mystery Player";
  const T = cmp.targetLabel;
  const beat = cmp.rows.filter(r => r.beat);
  const short = cmp.rows.filter(r => !r.beat);
  const list = arr => {
    const p = arr.map(r => r.phrase);
    if (p.length === 0) return "";
    if (p.length === 1) return p[0];
    if (p.length === 2) return `${p[0]} and ${p[1]}`;
    return `${p.slice(0, -1).join(", ")}, and ${p[p.length - 1]}`;
  };
  // Tone is tied to the build's OWN tier, not just the benchmark comparison: a
  // triumphant "cast his own shadow" is reserved for a Legend/GOAT career that
  // also cleared the target's résumé pillars. The pillar rows (Rings/MVPs/
  // All-NBA) drive the "why it isn't a dethroning" callouts below.
  const tier = tierForCareer(career);
  const isLegendPlus = TIERS.findIndex(t => t.name === tier.name) >= TIERS.findIndex(t => t.name === "Legend");
  const resume = cmp.resumeCleared;
  const pillarRows = SHADOW_PILLARS.map(k => cmp.rows.find(r => r.key === k));
  const lostPillars = pillarRows.filter(r => !r.beat);

  // ROTY/DPOY get their own editorial aside below, so keep them out of the
  // generic prose enumeration — otherwise each award would be named twice in
  // the same paragraph. They still count toward beatCount and show in the grid.
  const AWARD_KEYS = ["roty", "dpoy"];
  const beatP = beat.filter(r => !AWARD_KEYS.includes(r.key));
  const shortP = short.filter(r => !AWARD_KEYS.includes(r.key));

  // A one-off aside when the two careers diverge on the hardware the base
  // Rings/MVP/stat metrics don't speak to — the DPOY and ROTY. Returns ""
  // when neither award separates the two.
  const awardAside = () => {
    const rotyRow = cmp.rows.find(r => r.key === "roty");
    const dpoyRow = cmp.rows.find(r => r.key === "dpoy");
    const notes = [];
    if (dpoyRow.build > 0 && dpoyRow.target === 0) notes.push(`he anchored a defense all the way to a DPOY ${T} never won`);
    else if (dpoyRow.target > 0 && dpoyRow.build === 0) notes.push(`${T}'s ${dpoyRow.target === 1 ? "DPOY" : `${dpoyRow.target} DPOYs`} on the other end went unanswered`);
    if (rotyRow.build > 0 && rotyRow.target === 0) notes.push(`he arrived a Rookie of the Year, which ${T} never was`);
    else if (rotyRow.target > 0 && rotyRow.build === 0) notes.push(`${T} broke in as Rookie of the Year while he did not`);
    if (!notes.length) return "";
    const joined = notes.length === 2 ? `${notes[0]}, and ${notes[1]}` : notes[0];
    return " " + joined.charAt(0).toUpperCase() + joined.slice(1) + ".";
  };

  // A) FULL TRIUMPH — cleared the target's résumé pillars (rings + MVPs +
  //    All-NBA) AND backed it with a Legend/GOAT-tier career. Only here does the
  //    "stepped out of the shadow" language fire.
  if (resume && isLegendPlus) {
    return `Matched or beat ${T} on ${cmp.beatCount} of ${cmp.total} measures — the rings, the MVPs and the All-NBA nods included. ${name} didn't just chase the shadow; he stepped out of it and cast his own.${awardAside()}`;
  }
  // B) Cleared the pillars on paper, but the career itself never reached Legend
  //    tier — measured, not triumphant.
  if (resume) {
    return `On paper ${name} matched ${T} where it counts — ${list(pillarRows)} — but a ${tier.name}-tier career never built the sustained, year-after-year résumé to call it a dethroning. A hell of a run in the shadow, not out of it.${awardAside()}`;
  }
  // C) A Legend/GOAT in his own right, but didn't clear the target's pillars —
  //    respectful concession rather than a fall-short.
  if (isLegendPlus) {
    return `${name} carved out a ${tier.name}'s career of his own, but ${list(lostPillars)} still belong to ${T} — the separation that keeps a legend a legend.${awardAside()}`;
  }
  // D) Missed the pillars and isn't Legend-tier, with nothing on the board.
  if (beat.length === 0) {
    return `${name} chased ${T}'s shadow and never caught a piece of it — ${list(shortP)} all stayed the GOAT's alone. A real career, but the throne doesn't wobble.${awardAside()}`;
  }
  // E) Won something — often volume stats and/or rings — but the MVPs and
  //    All-NBA that mark sustained greatness stayed the legend's. Explicitly NOT
  //    a dethroning, which is the case issue #1 was about.
  const beatClause = beatP.length ? `took ${list(beatP)} off ${T}` : `pushed ${T} in spots`;
  return `${name} ${beatClause}, but ${list(lostPillars)} — the markers of sustained greatness — stayed his. Flashes of the legend, not a dethroning.${awardAside()}`;
}

// ===== SIGNATURE TRAIT BADGES =====
// Which badges the current build has ACQUIRED: one per skill pick whose player
// carries a TRAIT_BADGES entry for that category. Recomputed live from picks, so
// editing a pick updates the set. Returns [{ key, category, player, name, effect, mods }].
function acquiredBadges() {
  const out = [];
  for (const cat of SKILL_ORDER) {
    const pick = state.skills[cat];
    if (!pick) continue;
    const key = pick.name + "|" + cat;
    const b = TRAIT_BADGES[key];
    if (b) out.push({ key, category: cat, player: pick.name, name: b.name, effect: b.effect, mods: b.mods });
  }
  return out;
}

// Summed stat deltas from the ACTIVE badges — but only those still acquired
// (guards against a stale activeBadges after a pick edit). <=1 acquired badge is
// auto-active; 2+ means the player chose exactly 2 on the chooseBadges step.
function activeBadgeMods() {
  const acquired = acquiredBadges();
  // Sandbox stacks EVERY collected trait — no 2-cap, no chooseBadges selection.
  const activeKeys = state.sandbox
    ? acquired.map(b => b.key)
    : acquired.length <= 1
    ? acquired.map(b => b.key)
    : state.activeBadges.filter(k => acquired.some(b => b.key === k));
  const mods = {};
  for (const b of acquired) {
    if (!activeKeys.includes(b.key)) continue;
    for (const [stat, delta] of Object.entries(b.mods)) mods[stat] = (mods[stat] || 0) + delta;
  }
  return mods;
}

// The active badge records (for the verdict "Signature Traits" section), with
// the same <=1 auto-active rule.
function activeBadgeList() {
  const acquired = acquiredBadges();
  if (state.sandbox || acquired.length <= 1) return acquired;
  return acquired.filter(b => state.activeBadges.includes(b.key));
}

// ===== PERSISTENT PROGRESS: lifetime stats + achievements =====
// Everything the player accumulates across careers lives under one localStorage
// key. Unlike the per-build state, this survives Play Again and page reloads.
const PROGRESS_KEY = "aytg_progress";
const LEGACY_BEST_KEY = "aytg_best_score"; // the one thing that already persisted

// The two TRACKED modes. Sandbox is excluded from progress entirely and so has
// no pool. Definitions (ACHIEVEMENTS) stay one shared list — only unlock STATE
// and the accumulators below are split per mode.
const MODE_KEYS = ["cap", "classic"];
const MODE_LABELS = { cap: "Salary Cap Edition", classic: "Classic" };
const DEFAULT_MODE = "cap";
const normMode = m => (MODE_KEYS.includes(m) ? m : DEFAULT_MODE);

// One mode's accumulator. Shape is unchanged from the pre-split version — only
// where it lives changed, so every field and every consumer still reads the same.
function blankProgress() {
  return {
    careersPlayed: 0,
    bestScore: 0,
    bestTierIdx: -1,       // index into TIERS; -1 = no career yet
    totalRings: 0, totalMVPs: 0, totalDPOYs: 0, totalROTYs: 0,
    activatedBadges: [],   // unique "Player|Category" keys ever activated
    dethronedTargets: [],  // shadow target names ever dethroned (majority cleared)
    unlocked: {},          // { achievementId: true } — sticky once earned
  };
}

function blankAllProgress() {
  return { version: 2, lastMode: DEFAULT_MODE,
           modes: { cap: blankProgress(), classic: blankProgress() } };
}

// Reads the whole envelope, migrating v1 on the way.
//
// MIGRATION: a stored object with no `.modes` is flat pre-split data. All of it
// belongs to Salary Cap Edition — that is the mode that existed first and
// generated the history — so it moves wholesale into modes.cap and Classic
// starts at zero.
//
// The legacy best-score key is folded in ONLY during that migration. Once a v2
// envelope exists the key is never read again: it is kept written (as the max
// across modes) purely so an older reader sees a sane value, and reading it back
// would leak one mode's best into another's.
function loadAllProgress() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(PROGRESS_KEY)); } catch (e) { raw = null; }
  const all = blankAllProgress();
  if (raw && typeof raw === "object" && raw.modes) {
    for (const k of MODE_KEYS) all.modes[k] = Object.assign(blankProgress(), raw.modes[k] || {});
    if (MODE_KEYS.includes(raw.lastMode)) all.lastMode = raw.lastMode;
    return all;
  }
  if (raw && typeof raw === "object") all.modes.cap = Object.assign(blankProgress(), raw);
  const legacy = parseInt(localStorage.getItem(LEGACY_BEST_KEY) || "0", 10);
  if (legacy > all.modes.cap.bestScore) all.modes.cap.bestScore = legacy;
  return all;
}

function saveAllProgress(all) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(all)); } catch (e) { /* storage full/blocked — non-fatal */ }
}

// One mode's accumulator.
function loadProgress(mode = DEFAULT_MODE) {
  return loadAllProgress().modes[normMode(mode)];
}

function saveProgress(mode, p) {
  const all = loadAllProgress();
  all.modes[normMode(mode)] = p;
  saveAllProgress(all);
}

// The 18 achievements. Each check() sees the just-finished run and the lifetime
// object AFTER this run's stats were folded in, so cumulative milestones read
// the up-to-date totals. Sticky: once true it's never re-evaluated (see below).
const ACHIEVEMENTS = [
  // Progression / tiers
  { id: "hof_first",   name: "Hall of Famer",     desc: "Retire a build into the Hall of Fame.",              check: (r) => r.isHOF },
  { id: "tier_super",  name: "Superstar Status",  desc: "Reach the Superstar tier or higher.",                check: (r) => r.tierIdx >= TIERS.findIndex(t => t.name === "Superstar") },
  { id: "tier_legend", name: "Living Legend",     desc: "Reach the Legend tier or higher.",                   check: (r) => r.tierIdx >= TIERS.findIndex(t => t.name === "Legend") },
  { id: "tier_goat",   name: "The Ceiling",       desc: "Reach the GOAT tier.",                               check: (r) => r.tierName === "GOAT" },
  { id: "careers_5",   name: "Regular",           desc: "Play 5 careers.",                                    check: (r, L) => L.careersPlayed >= 5 },
  { id: "careers_25",  name: "Obsessed",          desc: "Play 25 careers.",                                   check: (r, L) => L.careersPlayed >= 25 },
  // Shadow-chasing
  { id: "dethrone_1",  name: "Out of the Shadow", desc: "Dethrone your first legend (clear the majority of their benchmarks).", check: (r) => !!r.dethroned },
  { id: "dethrone_all",name: "Cast Your Own Shadow", desc: "Dethrone all 14 shadow legends across your careers.", check: (r, L) => L.dethronedTargets.length >= SHADOW_ORDER.length },
  // Extreme builds
  { id: "perfect_spend", name: "Perfect Spend",   desc: "Finish a build spending the cap to the last dollar.", check: (r) => r.budgetExact },
  { id: "draft_bust",  name: "Bust on Purpose",   desc: "Land the Draft Bust tier.",                          check: (r) => r.tierName === "Draft Bust" },
  { id: "full_stack",  name: "Full Stack",        desc: "Activate two trait badges from the same player in one build.", check: (r) => r.fullStack },
  // Career milestones
  { id: "unanimous",   name: "Unanimous",         desc: "Win MVP in a near-perfect season (99-caliber peak).", check: (r) => r.unanimous },
  { id: "two_way",     name: "Two-Way Great",     desc: "Win both MVP and DPOY in one career.",               check: (r) => r.mvps >= 1 && r.dpoys >= 1 },
  { id: "dynasty",     name: "Dynasty",           desc: "Win 4 or more rings in one career.",                 check: (r) => r.rings >= 4 },
  { id: "rushmore",    name: "Mount Rushmore",    desc: "Win 5 or more MVPs in one career.",                  check: (r) => r.mvps >= 5 },
  // Lifetime cumulative
  { id: "life_rings",  name: "Ring Dynasty",      desc: "Win 20 rings across all your careers.",              check: (r, L) => L.totalRings >= 20 },
  { id: "life_mvps",   name: "MVP Machine",       desc: "Win 10 MVPs across all your careers.",               check: (r, L) => L.totalMVPs >= 10 },
  { id: "life_traits", name: "Trait Collector",   desc: "Activate 25 different trait badges across all careers.", check: (r, L) => L.activatedBadges.length >= 25 },
];

// Fold a finished career into lifetime progress and unlock anything newly
// earned. `run` is a plain fact-sheet the UI assembles (kept free of DOM/state
// so this is unit-testable). Returns { progress, newlyUnlocked: [achievement] }.
// Call EXACTLY once per real career (not on shared views, not on re-render).
function recordCareerRun(run) {
  const mode = normMode(run.mode);
  const all = loadAllProgress();
  const p = all.modes[mode];
  p.careersPlayed += 1;
  p.bestScore = Math.max(p.bestScore, run.goatScore);
  p.bestTierIdx = Math.max(p.bestTierIdx, run.tierIdx);
  p.totalRings += run.rings;
  p.totalMVPs += run.mvps;
  p.totalDPOYs += run.dpoys;
  p.totalROTYs += run.rotys;
  for (const key of run.activatedBadgeKeys) {
    if (!p.activatedBadges.includes(key)) p.activatedBadges.push(key);
  }
  if (run.dethroned && !p.dethronedTargets.includes(run.dethroned)) {
    p.dethronedTargets.push(run.dethroned);
  }

  const newlyUnlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (p.unlocked[a.id]) continue;         // sticky — already earned
    if (a.check(run, p)) { p.unlocked[a.id] = true; newlyUnlocked.push(a); }
  }

  all.lastMode = mode; // so the Trophy Case opens on the mode just played
  saveAllProgress(all);
  // Legacy key: written for backward compat only, never read once v2 exists.
  const overallBest = Math.max(...MODE_KEYS.map(k => all.modes[k].bestScore));
  try { localStorage.setItem(LEGACY_BEST_KEY, String(overallBest)); } catch (e) { /* non-fatal */ }
  return { progress: p, mode, newlyUnlocked };
}

if (typeof module !== "undefined") {
  module.exports = {
    state, STEPS, SKILL_ORDER, CATEGORIES, TIERS, wheelCost, budgetRemaining, categoryRating, getRosterOptions,
    seedRng, currentPick, replacePick, getAllRosterOptions, autoAssignPick, lockSkill, lockPhysical, applyModifiers, finalSkills, computeOVR,
    checkPositionFit, TEAM_NEEDS, simSeason, simCareer, generateSeasonStats, tierForScore, tierForCareer, percentileForScore,
    computeBadges, BADGE_INFO, generateHeadline, generateScoutingReport, careerHighlights, playstyleComp, closestComp, topComps, buildProfile, topAttribute, BUDGET_CAP, TEAM_REROLLS, GAMES_PER_SEASON,
    compareToShadow, generateShadowVerdict, SHADOW_METRICS, SHADOW_PILLARS, isDethroned, tierIsLegendPlus,
    TRAIT_BADGES, acquiredBadges, activeBadgeMods, activeBadgeList,
    TIER_AWARD_FLOORS, TIER_ALT_PATHS, hasAltPath, altPathWaivesMvp, meetsAwardFloor, meetsTierFloors, isHallOfFame,
    PROGRESS_KEY, LEGACY_BEST_KEY, blankProgress, loadProgress, saveProgress, recordCareerRun, ACHIEVEMENTS,
    MODE_KEYS, MODE_LABELS, DEFAULT_MODE, loadAllProgress, saveAllProgress,
  };
}
