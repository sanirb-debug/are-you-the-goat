// ===== ARE YOU THE GOAT? — GAME LOGIC =====

const SKILL_ORDER = ["Shooting", "Finishing", "Playmaking", "Defense", "Rebounding"];
const BUDGET_CAP = 100;
const TOTAL_REROLLS = 3;
const COST_MULT = 0.15;

const state = {
  name: "",
  height: null,       // { name, label, rating, cost }
  frame: null,         // { name, label, rating, cost }
  skills: {},          // { Shooting: {name, rating, cost}, ... }
  budgetSpent: 0,
  rerollsUsed: 0,
  position: null,
  positionFit: null,   // true/false
  team: null,
  currentStep: 0,       // 0 name, 1 team, 2 height, 3 frame, 4..8 skills, 9 position, 10 verdict
};

const STEPS = ["name", "team", "height", "frame", ...SKILL_ORDER, "position", "verdict"];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pickRandom(arr) { return arr[randInt(0, arr.length - 1)]; }
function wheelCost(rating) { return Math.round(rating * COST_MULT); }

function budgetRemaining() {
  return BUDGET_CAP - state.budgetSpent;
}

const CANDIDATES_PER_SPIN = 3;

function getCandidates(pool, count = CANDIDATES_PER_SPIN) {
  const remaining = budgetRemaining();
  let affordable = pool.filter(p => wheelCost(p.rating) <= remaining);
  if (affordable.length === 0) affordable = [...BUDGET_BIN];
  const shuffled = [...affordable].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(p => ({ ...p, cost: wheelCost(p.rating) }));
}

function lockSkill(skillName, result) {
  state.skills[skillName] = result;
  state.budgetSpent += result.cost;
}

function lockPhysical(key, result) {
  state[key] = result;
  state.budgetSpent += result.cost;
}

function canReroll() {
  return state.rerollsUsed < TOTAL_REROLLS;
}

function useReroll() {
  state.rerollsUsed += 1;
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

function simCareer(ovr, team) {
  const numSeasons = randInt(8, 18);
  const seasons = [];
  let rings = 0, mvps = 0, finalsMVPs = 0, allNBAs = 0, allStars = 0, careerWins = 0, peakOVR = ovr;
  const varianceRange = state.positionFit ? 4 : 8;

  for (let i = 0; i < numSeasons; i++) {
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
    seasons.push(result);
  }

  const goatScore = Math.round(
    peakOVR * 4 +
    rings * 15 +
    mvps * 12 +
    finalsMVPs * 10 +
    allNBAs * 3 +
    allStars * 1 +
    careerWins / 10
  );

  return { numSeasons, seasons, rings, mvps, finalsMVPs, allNBAs, allStars, careerWins, peakOVR, goatScore };
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
    state, STEPS, SKILL_ORDER, TIERS, wheelCost, budgetRemaining, getCandidates, lockSkill, lockPhysical,
    canReroll, useReroll, applyModifiers, finalSkills, computeOVR,
    checkPositionFit, simSeason, simCareer, tierForScore, percentileForScore,
    computeBadges, generateHeadline, topAttribute, BUDGET_CAP, TOTAL_REROLLS,
  };
}
