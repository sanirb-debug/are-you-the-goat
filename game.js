// ===== ARE YOU THE GOAT? — GAME LOGIC =====

const SKILL_ORDER = ["Shooting", "Finishing", "Playmaking", "Handles", "Defense", "Rebounding"];
const CATEGORIES = ["height", "frame", ...SKILL_ORDER];
const BUDGET_CAP = 10000; // internal hundredths of $M — displays as the "$100M cap" via fmtSalary
const TEAM_REROLLS = 3; // shared across all 7 scouting spins

const state = {
  name: "",
  height: null,       // { name, label, rating, cost }
  frame: null,         // { name, label, rating, cost }
  skills: {},          // { Shooting: {name, rating, cost}, ... }
  budgetSpent: 0,
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

const STEPS = ["name", "height", "frame", ...SKILL_ORDER, "position", "careerTeam", "confirm", "simulating", "verdict"];

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
  return BUDGET_CAP - state.budgetSpent;
}

function categoryRating(player, category) {
  if (category === "height") return player.height.rating;
  if (category === "frame") return player.frame.rating;
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
      : category === "frame" ? p.frame.label
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
  if (category === "height" || category === "frame") return state[category];
  return state.skills[category];
}

// Swap an already-locked pick: refund the old cost, charge the new one.
function replacePick(category, newPick) {
  const old = currentPick(category);
  state.budgetSpent += newPick.cost - old.cost;
  if (category === "height" || category === "frame") state[category] = newPick;
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

// ---- Modifiers ----
function applyModifiers(baseRating, statName) {
  const h = state.height.rating;
  const f = state.frame.rating;
  let mod = 0;
  if (["Rebounding", "Defense"].includes(statName)) mod += (h - 70) * 0.15;
  if (["Finishing", "Rebounding", "Defense"].includes(statName)) mod += (f - 70) * 0.15;
  if (["Playmaking", "Shooting", "Handles"].includes(statName)) {
    if (h >= 90) mod -= (h - 70) * 0.15;
    if (f >= 90) mod -= (f - 70) * 0.15;
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
    state.frame.rating * 0.05;
  let bonus = state.positionFit ? 3 : 0;
  return clamp(Math.round(ovr + bonus), 25, 99);
}

function checkPositionFit(posKey) {
  const pos = POSITIONS[posKey];
  const h = state.height.rating;
  const f = state.frame.rating;
  let fits = h >= pos.hMin && h <= pos.hMax;
  if (pos.frameMin) fits = fits && f >= pos.frameMin;
  return fits;
}

// ---- Team positional needs (for the Career Team pick) ----
// Each team's "need" is the position where its roster is weakest RELATIVE to
// the rest of the league. Per position, score a team by the top skill-total
// among players who physically fit it (height in range, +frame for C), then
// z-score that against all 30 teams so a position's inherent difficulty (e.g.
// C is hard to fill everywhere) doesn't bias every team toward the same need.
// The need is the position with the lowest z-score. Data-driven; spreads
// needs across all five positions.
function bestFitScore(abbr, posKey) {
  const pos = POSITIONS[posKey];
  let best = 0;
  (TEAM_ROSTERS[abbr] || []).forEach(p => {
    const fits = p.height.rating >= pos.hMin && p.height.rating <= pos.hMax && (!pos.frameMin || p.frame.rating >= pos.frameMin);
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
// ovr = that season's overall, f = finalSkills(), h = height, fr = frame.
// OVR is a global governor on the whole line: skills set the SHAPE of the
// box score (which stats dominate), but OVR gates the MAGNITUDE, so an elite
// individual skill on a mediocre build can't post all-time counting stats.
// The factor runs ~0.35 at OVR 40 up to 1.0 at OVR 96+, so only 90+ builds
// approach 30 PPG and only maxed 95+ builds reach the historical outliers.
function generateSeasonStats(ovr, f, h, fr) {
  const jitter = () => 1 + randInt(-8, 8) / 100;
  const ovrFactor = clamp((ovr - 48) / 50, 0.35, 1);
  // Scoring output tracks the scoring SKILLS, not overall OVR. ovrFactor
  // used to multiply ppg directly, so an elite Shooting/Finishing specialist
  // with weak unrelated categories (94 Finishing but OVR 68) was crushed to
  // ~11 PPG. Scoring stats (ppg, tpg) now use only a light opportunity
  // dampener derived from OVR (x0.85-1.0); non-scoring stats keep ovrFactor.
  const scoringOpp = 0.85 + 0.15 * ovrFactor;
  const scoring = (f.Shooting + f.Finishing) / 2;
  // PPG is anchored directly to the scoring skills with a proper ceiling: the
  // 0.63 slope off a rating-45 baseline gives decent (scoring ~75) builds
  // ~19 PPG, strong (~82) ~23, and reserves 28+ all-time volume for genuinely
  // elite (~90+) Shooting/Finishing. Earlier `4 + (scoring-25)*0.42` was too
  // hot in the middle — a scoring-75 build hit ~25 PPG, all-star-averages for
  // a merely-good scorer — so it's re-anchored to make the top end mean
  // something. scoringOpp (0.85-1.0) is a light team-role dampener only.
  const ppg = clamp(0.63 * (scoring - 45) * scoringOpp * jitter(), 3, 35);
  const apg = clamp((0.5 + (f.Playmaking - 25) * 0.15) * ovrFactor * jitter(), 0.5, 11.5);
  const rpg = clamp((1 + (f.Rebounding - 25) * 0.155 + (h - 50) * 0.05) * ovrFactor * jitter(), 1, 15);
  // smaller, leaner builds poke more passing lanes; bigger builds protect the rim
  const spg = clamp((0.2 + (f.Defense - 25) * 0.03 + (60 - h) * 0.008 + (60 - fr) * 0.004) * ovrFactor * jitter(), 0.2, 3.6);
  const bpg = clamp((0.1 + (f.Defense - 25) * 0.022 + (h - 60) * 0.03 + (fr - 60) * 0.008) * ovrFactor * jitter(), 0.2, 3.6);
  // threes come from Shooting alone; very tall or Powerful builds live closer to the rim
  const tallPenalty = h >= 85 ? (h - 85) * 0.03 : 0;
  const bulkPenalty = fr >= 90 ? 0.6 : 0;
  const tpg = clamp(((f.Shooting - 40) * 0.08 - tallPenalty - bulkPenalty) * scoringOpp * jitter(), 0, 5.2);
  // Shooting percentages are efficiency, not volume — derived from the scoring
  // skills, NOT scaled by ovrFactor, with a small per-season wobble.
  const jPct = () => randInt(-2, 2);
  const fgPct = clamp(45 + (scoring - 25) * 0.27 + jPct(), 42, 66);
  const tptPct = clamp(30 + (f.Shooting - 40) * 0.254 + jPct(), 28, 47);
  const r1 = v => Math.round(v * 10) / 10;
  return { ppg: r1(ppg), apg: r1(apg), rpg: r1(rpg), spg: r1(spg), bpg: r1(bpg), tpg: r1(tpg), fgPct: r1(fgPct), tptPct: r1(tptPct) };
}

// ---- Season / career sim ----
function simSeason(ovr, scr, varianceRange) {
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

  // Award gates scaled to the integer cost curve's OVR ceiling (max peak
  // ~83): the old 90/85/80 gates would make All-NBA 1st and MVP extinct.
  // All-NBA 3rd sits just 1 pt above the All-Star line so a consistent
  // All-Star converts to All-NBA in most (not all) of those seasons —
  // matching real careers where perennial All-Stars are near-perennial
  // All-NBA too. Was 72/76/80 (a 2-pt gap to 3rd), which stranded a base-69
  // fringe All-Star at ~35% conversion; 71/75/80 lifts that to ~68% while
  // 1st team stays elite at 80 (aligned with the MVP gate).
  const allStar = ovr >= 70;
  let allNBA = null;
  if (ovr >= 80) allNBA = "1st";
  else if (ovr >= 75) allNBA = "2nd";
  else if (ovr >= 71) allNBA = "3rd";

  let mvp = false;
  if (ovr >= 80 && wins >= 50) mvp = rng() < 0.35;

  let finalsMVP = ring && ovr >= 78;

  return { wins, madePlayoffs, ring, finalsMVP, allStar, allNBA, mvp, roundsWon };
}

const GAMES_PER_SEASON = 82;

function simCareer(ovr, team) {
  const numSeasons = randInt(15, 20); // full career, always runs to completion
  const seasons = [];
  let rings = 0, mvps = 0, finalsMVPs = 0, allNBAs = 0, allStars = 0, careerWins = 0, peakOVR = ovr;
  let bestMVPOVR = 0; // OVR of the strongest MVP-winning season (0 if none)
  const varianceRange = state.positionFit ? 4 : 8;
  const f = finalSkills();
  const totals = { pts: 0, ast: 0, reb: 0, stl: 0, blk: 0, threes: 0 };
  let fgSum = 0, tptSum = 0; // percentages are averaged, not summed
  let bestSeason = null;

  for (let i = 0; i < numSeasons; i++) {
    const seasonOVR = clamp(ovr + randInt(-3, 3), 25, 99);
    peakOVR = Math.max(peakOVR, seasonOVR);
    // Filling the team's positional need lifts the supporting cast a touch.
    const teamScr = team.scr + (state.teamNeedMet ? 5 : 0);
    const scrThisYear = clamp(teamScr + randInt(-5, 5), 15, 99);
    const result = simSeason(seasonOVR, scrThisYear, varianceRange);
    careerWins += result.wins;
    if (result.ring) rings++;
    if (result.mvp) { mvps++; bestMVPOVR = Math.max(bestMVPOVR, seasonOVR); }
    if (result.finalsMVP) finalsMVPs++;
    if (result.allNBA) allNBAs++;
    if (result.allStar) allStars++;

    const stats = generateSeasonStats(seasonOVR, f, state.height.rating, state.frame.rating);
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
  const goatScore = Math.round(
    peakOVR * 4 +
    rings * 15 +
    mvps * 12 + Math.max(0, mvps - 1) * 15 +
    finalsMVPs * 10 +
    allNBAs * 3 +
    allStars * 1 +
    careerWins / 10
  );

  const avgFgPct = Math.round(fgSum / numSeasons * 10) / 10;
  const avgTptPct = Math.round(tptSum / numSeasons * 10) / 10;
  return { numSeasons, seasons, rings, mvps, finalsMVPs, allNBAs, allStars, careerWins, peakOVR, bestMVPOVR, goatScore, totals, avgFgPct, avgTptPct, bestSeason };
}

// ---- Tier ladder ----
// Score mins calibrated to the salary curve + rescaled award gates (which
// award MVPs/All-NBA/rings at lower OVRs, inflating scores): set from
// 5000-run percentiles on the best team — GOAT 755 = ~p96 of the PERFECT
// (base-80) build (~3-5% GOAT for perfect play; re-anchored from 690 when
// the escalating MVP bonus lifted the top tail), Legend 600 = ~p50 of that
// build, Superstar 465 = ~p50 of a strong maxed-out (base-73) build.
const TIERS = [
  { name: "Draft Bust", min: -Infinity },
  { name: "Bench Piece", min: 100 },
  { name: "Starter", min: 150 },
  { name: "All-Star", min: 250 },
  { name: "Superstar", min: 465 },
  { name: "Legend", min: 600 },
  { name: "GOAT", min: 755 },
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
const TIER_OVR_FLOORS = { GOAT: 82, Legend: 80, Superstar: 76 };

// A tier's OVR floor is satisfied by EITHER the tracked career peak OR the
// best MVP-winning season's OVR: winning MVP is proof of a floor-worthy
// season, so a technicality in peak tracking can never cap an MVP winner.
// (Today this is a safety invariant rather than a live branch — peakOVR is
// the max over all seasons so it always >= bestMVPOVR, and the MVP gate (80)
// equals the Legend floor — but it guards any future retune where the MVP
// gate drops below a floor or peak tracking changes.)
function tierForCareer(score, peakOVR, bestMVPOVR = 0) {
  const effectivePeak = Math.max(peakOVR, bestMVPOVR);
  let idx = TIERS.indexOf(tierForScore(score));
  while (idx > 0) {
    const floor = TIER_OVR_FLOORS[TIERS[idx].name];
    if (!floor || effectivePeak >= floor) break;
    idx--;
  }
  return TIERS[idx];
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
  "3-Point Sniper": "88+ Shooting on a slight or lean frame — a pure perimeter marksman",
  "Stretch Big": "A 6'11\"+ big with 82+ Shooting — spaces the floor from the frontcourt",
  "Mid-Range Maestro": "Elite shot creation: 84+ Shooting, 82+ Handles, and 80+ Finishing",
  "Post-Up Punisher": "88+ Finishing on a bulky or powerful frame — bullies the post",
  "Slasher": "88+ Finishing and 82+ Handles on a guard or wing — lives at the rim",
  "Rim Protector": "88+ Defense at 6'11\"+ — anchors the paint",
  "Perimeter Lockdown": "88+ Defense on a 6'7\" or smaller frame — smothers ball-handlers",
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
  const h = state.height.rating, fr = state.frame.rating;
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
  if (state.budgetSpent >= 9700) add("Full Send", 42);
  if (!state.positionFit) add("Positional Anomaly", 56);
  if (career.goatScore < 100) add("Certified Bust", 45);

  // ---- skill / physical archetypes ----
  if (SH >= 88 && fr <= 52) add("3-Point Sniper", SH);
  if (h >= 82 && SH >= 82) add("Stretch Big", (SH + h) / 2);
  if (SH >= 84 && HA >= 82 && FI >= 80) add("Mid-Range Maestro", (SH + HA + FI) / 3);
  if (FI >= 88 && fr >= 80) add("Post-Up Punisher", FI);
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
  if (ovr >= 80 && state.budgetSpent <= 8000) add("Bargain Hunter", 80 + (ovr - 80));
  if (state.teamNeedMet) add("Need Filler", 52);

  return badges.sort((a, b) => b.score - a.score);
}

// ---- Career highlight reel (sim loading screen) ----
// A handful of real moments pulled from the just-computed season-by-season
// data: firsts, every early ring/MVP, retirement.
function careerHighlights(career) {
  const h = [];
  let firstAllStar = false, firstAllNBA = false, mvps = 0, rings = 0;
  career.seasons.forEach((s, i) => {
    const y = "Year " + (i + 1);
    if (s.allStar && !firstAllStar) { h.push(y + ": First All-Star selection"); firstAllStar = true; }
    if (s.allNBA && !firstAllNBA) { h.push(y + ": Named All-NBA " + s.allNBA + " Team"); firstAllNBA = true; }
    if (s.mvp && mvps < 2) { h.push(y + ": Wins MVP"); mvps++; }
    if (s.ring && rings < 2) { h.push(y + ": Wins the NBA Championship" + (s.finalsMVP ? " and Finals MVP" : "")); rings++; }
  });
  if (!h.length) {
    const b = career.bestSeason;
    h.push("Year " + b.year + ": Career-best " + b.ppg + " points per game");
  }
  h.push("Retires after " + career.numSeasons + " season" + (career.numSeasons === 1 ? "" : "s"));
  return h.slice(0, 7);
}

// ---- Scouting report (verdict narrative) ----
const FRAME_ADJ = {
  Slight: "wiry", Lean: "lean", Athletic: "athletic",
  Strong: "sturdy", Bulky: "bruising", Powerful: "overpowering",
};

// ---- Playstyle comp ----
// The finished build's 8-D on-court profile: physicals raw, skills post-modifier.
const COMP_DIMS = ["height", "frame", ...SKILL_ORDER];
// Height and frame are physically defining, so they carry more weight than any
// single skill — without this a short body with forward-like skills could be
// outvoted across the 6 skill dims and match a much taller player.
const COMP_WEIGHTS = { height: 4, frame: 1.5, Shooting: 1, Finishing: 1, Playmaking: 1, Handles: 1, Defense: 1, Rebounding: 1 };
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
  const p = { height: state.height.rating, frame: state.frame.rating };
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
function closestComp(profile, career = null) {
  let best = null, bestDist = Infinity;
  for (const ref of COMP_PLAYERS) {
    const dist = compDistance(profile, ref) + ACCOMP_MATCH_WEIGHT * accompDistance(career, accompOf(ref));
    if (dist < bestDist || (dist === bestDist && (!best || ref.name < best.name))) {
      bestDist = dist; best = ref;
    }
  }
  return best;
}

// Convenience for the verdict screen: returns { name, pos, reason }. Pass the
// career so a decorated build prefers a comp with matching real-life hardware.
function playstyleComp(career = null) {
  const profile = buildProfile();
  const ref = closestComp(profile, career);
  // Reasoning is the hand-written per-player text stored on the comp record.
  return { name: ref.name, pos: ref.pos, reason: ref.reasoning };
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
  const adj = FRAME_ADJ[state.frame.label] || "unorthodox";
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

if (typeof module !== "undefined") {
  module.exports = {
    state, STEPS, SKILL_ORDER, CATEGORIES, TIERS, wheelCost, budgetRemaining, categoryRating, getRosterOptions,
    seedRng, currentPick, replacePick, lockSkill, lockPhysical, applyModifiers, finalSkills, computeOVR,
    checkPositionFit, TEAM_NEEDS, simSeason, simCareer, generateSeasonStats, tierForScore, tierForCareer, percentileForScore,
    computeBadges, BADGE_INFO, generateHeadline, generateScoutingReport, careerHighlights, playstyleComp, closestComp, buildProfile, topAttribute, BUDGET_CAP, TEAM_REROLLS, GAMES_PER_SEASON,
  };
}
