// ===== ARE YOU THE GOAT? — GAME LOGIC =====

const SKILL_ORDER = ["Shooting", "Finishing", "Playmaking", "Defense", "Rebounding"];
const CATEGORIES = ["height", "frame", ...SKILL_ORDER];
const BUDGET_CAP = 100;
const COST_MULT = 0.15;
const TEAM_REROLLS = 3; // shared across all 7 scouting spins

const state = {
  name: "",
  height: null,       // { name, label, rating, cost }
  frame: null,         // { name, label, rating, cost }
  skills: {},          // { Shooting: {name, rating, cost}, ... }
  budgetSpent: 0,
  position: null,
  positionFit: null,   // true/false
  team: null,          // career team — drives the season sim
  scoutTeam: null,     // per-pick scouting team — whose roster the current list shows
  teamRerollsUsed: 0,  // scout-spin "Spin Again" uses, shared across the whole build
  editingCategory: null, // set while revising an earlier pick from the sidebar
  currentStep: 0,       // 0 name, 1 height, 2 frame, 3..7 skills, 8 careerTeam, 9 position, 10 verdict
};

const STEPS = ["name", "height", "frame", ...SKILL_ORDER, "careerTeam", "position", "verdict"];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pickRandom(arr) { return arr[randInt(0, arr.length - 1)]; }
function wheelCost(rating) { return Math.round(rating * COST_MULT); }

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
  if (["Playmaking", "Shooting"].includes(statName)) {
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
    f.Shooting * 0.20 +
    f.Finishing * 0.20 +
    f.Playmaking * 0.18 +
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

// ---- Per-season box score ----
// Per-game averages for one season, jittered so no two years look identical.
// f = finalSkills(), h = height rating, fr = frame rating.
function generateSeasonStats(f, h, fr) {
  const jitter = () => 1 + randInt(-8, 8) / 100;
  const scoring = (f.Shooting + f.Finishing) / 2;
  const ppg = clamp((4 + (scoring - 25) * 0.42) * jitter(), 4, 38);
  const apg = clamp((0.5 + (f.Playmaking - 25) * 0.15) * jitter(), 0.5, 12);
  const rpg = clamp((1 + (f.Rebounding - 25) * 0.155 + (h - 50) * 0.05) * jitter(), 1, 16);
  // smaller, leaner builds poke more passing lanes; bigger builds protect the rim
  const spg = clamp((0.2 + (f.Defense - 25) * 0.03 + (60 - h) * 0.008 + (60 - fr) * 0.004) * jitter(), 0.2, 4);
  const bpg = clamp((0.1 + (f.Defense - 25) * 0.022 + (h - 60) * 0.03 + (fr - 60) * 0.008) * jitter(), 0.2, 4);
  // threes come from Shooting alone; very tall or Powerful builds live closer to the rim
  const tallPenalty = h >= 85 ? (h - 85) * 0.03 : 0;
  const bulkPenalty = fr >= 90 ? 0.6 : 0;
  const tpg = clamp(((f.Shooting - 40) * 0.08 - tallPenalty - bulkPenalty) * jitter(), 0, 5.5);
  const r1 = v => Math.round(v * 10) / 10;
  return { ppg: r1(ppg), apg: r1(apg), rpg: r1(rpg), spg: r1(spg), bpg: r1(bpg), tpg: r1(tpg) };
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
        if (Math.random() < gameWinPct) wWins++; else lWins++;
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

  const allStar = ovr >= 75;
  let allNBA = null;
  if (ovr >= 90) allNBA = "1st";
  else if (ovr >= 85) allNBA = "2nd";
  else if (ovr >= 80) allNBA = "3rd";

  let mvp = false;
  if (ovr >= 90 && wins >= 50) mvp = Math.random() < 0.35;

  let finalsMVP = ring && ovr >= 85;

  return { wins, madePlayoffs, ring, finalsMVP, allStar, allNBA, mvp, roundsWon };
}

const GAMES_PER_SEASON = 82;
const INJURY_CHANCE = 0.05; // per season, so long careers compound real risk

function simCareer(ovr, team) {
  const plannedSeasons = randInt(15, 20); // expected full career if nothing goes wrong
  const seasons = [];
  let rings = 0, mvps = 0, finalsMVPs = 0, allNBAs = 0, allStars = 0, careerWins = 0, peakOVR = ovr;
  const varianceRange = state.positionFit ? 4 : 8;
  const f = finalSkills();
  const totals = { pts: 0, ast: 0, reb: 0, stl: 0, blk: 0, threes: 0 };
  let bestSeason = null;
  let injuryEnded = false, injuryYear = null;

  for (let i = 0; i < plannedSeasons; i++) {
    const seasonOVR = clamp(ovr + randInt(-3, 3), 25, 99);
    peakOVR = Math.max(peakOVR, seasonOVR);
    const scrThisYear = clamp(team.scr + randInt(-5, 5), 15, 99);
    const result = simSeason(seasonOVR, scrThisYear, varianceRange);
    careerWins += result.wins;
    if (result.ring) rings++;
    if (result.mvp) mvps++;
    if (result.finalsMVP) finalsMVPs++;
    if (result.allNBA) allNBAs++;
    if (result.allStar) allStars++;

    const stats = generateSeasonStats(f, state.height.rating, state.frame.rating);
    totals.pts += stats.ppg * GAMES_PER_SEASON;
    totals.ast += stats.apg * GAMES_PER_SEASON;
    totals.reb += stats.rpg * GAMES_PER_SEASON;
    totals.stl += stats.spg * GAMES_PER_SEASON;
    totals.blk += stats.bpg * GAMES_PER_SEASON;
    totals.threes += stats.tpg * GAMES_PER_SEASON;
    const peakScore = stats.ppg + stats.apg * 1.5 + stats.rpg;
    if (!bestSeason || peakScore > bestSeason.peakScore) bestSeason = { year: i + 1, peakScore, ...stats };

    seasons.push({ ...result, stats });

    // serious injury can end the career right here — this season still
    // counts, past years keep their stats and awards, but nothing follows
    if (i < plannedSeasons - 1 && Math.random() < INJURY_CHANCE) {
      injuryEnded = true;
      injuryYear = i + 1;
      break;
    }
  }
  const numSeasons = seasons.length;
  Object.keys(totals).forEach(k => { totals[k] = Math.round(totals[k]); });

  const goatScore = Math.round(
    peakOVR * 4 +
    rings * 15 +
    mvps * 12 +
    finalsMVPs * 10 +
    allNBAs * 3 +
    allStars * 1 +
    careerWins / 10
  );

  return { numSeasons, seasons, rings, mvps, finalsMVPs, allNBAs, allStars, careerWins, peakOVR, goatScore, totals, bestSeason, injuryEnded, injuryYear };
}

// ---- Tier ladder ----
const TIERS = [
  { name: "Draft Bust", min: -Infinity },
  { name: "Bench Piece", min: 100 },
  { name: "Starter", min: 150 },
  { name: "All-Star", min: 250 },
  { name: "Superstar", min: 350 },
  { name: "Legend", min: 450 },
  { name: "GOAT", min: 550 },
];

function tierForScore(score) {
  let result = TIERS[0];
  for (const t of TIERS) {
    if (score >= t.min) result = t;
  }
  return result;
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
function computeBadges(ovr, career) {
  const f = finalSkills();
  const badges = [];
  if (state.height.rating >= 85 && f.Shooting >= 85) badges.push("Unicorn Build");
  if (state.height.rating <= 40 && f.Rebounding >= 85) badges.push("Small Ball Terror");
  if (f.Defense >= 88 && (f.Shooting >= 88 || f.Finishing >= 88)) badges.push("Two-Way Monster");
  if (state.budgetSpent >= 97) badges.push("Full Send");
  if (!state.positionFit) badges.push("Positional Anomaly");
  if (career.goatScore < 100) badges.push("Certified Bust");
  return badges;
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
    currentPick, replacePick, lockSkill, lockPhysical, applyModifiers, finalSkills, computeOVR,
    checkPositionFit, simSeason, simCareer, generateSeasonStats, tierForScore, percentileForScore,
    computeBadges, generateHeadline, topAttribute, BUDGET_CAP, TEAM_REROLLS,
  };
}
