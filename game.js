// ===== ARE YOU THE GOAT? — GAME LOGIC =====

const SKILL_ORDER = ["Shooting", "Finishing", "Playmaking", "Handles", "Defense", "Rebounding"];
const CATEGORIES = ["height", "athleticism", ...SKILL_ORDER];
const BUDGET_CAP = 10000; // internal hundredths of $M — displays as the "$100M cap" via fmtSalary
const TEAM_REROLLS = 3; // Salary Cap team-scouting respins, shared across the build (Classic uses its own reduced limit)

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
  spunPlayer: null,    // no-budget mode: the player the current pick's spin landed on
  playerRerollsUsed: 0, // no-budget mode: player-spin re-rolls used, shared across the whole build
  pickOrder: [],       // no-budget mode: slot categories in the order they were locked (Back pops this)
  editingCategory: null, // set while revising an earlier pick from the sidebar
  seed: null,           // RNG seed for the career sim — encoded in share links
  sharedView: false,    // true when viewing someone else's build from a ?build= link
  currentStep: 0,       // index into STEPS
};

const STEPS = ["home", "shadow", "name", "height", "athleticism", ...SKILL_ORDER, "chooseBadges", "position", "careerTeam", "confirm", "simulating", "verdict"];

// Does the trait screen have a real choice to present? Below the cap there is
// nothing to pick, so renderChooseBadges auto-activates and advances. Back has
// to know the same rule, or stepping back onto that screen would bounce the
// player straight forward again.
function badgeChoiceIsPending() {
  if (state.sandbox) return false;          // sandbox stacks every trait
  const cap = state.autoPick ? 3 : 2;
  const autoActivateAt = state.autoPick ? cap : 1;
  return acquiredBadges().length > autoActivateAt;
}

// Which STEPS index Back should land on from `fromIdx`, or -1 when Back should
// not be offered at all. Mode-independent: STEPS is one shared flow and the
// only branch in it is the self-skipping trait screen.
function backTargetStep(fromIdx = state.currentStep) {
  const step = STEPS[fromIdx];
  // The career is already rolling or already recorded — there is no un-simming it.
  if (step === "simulating" || step === "verdict") return -1;
  let i = fromIdx - 1;
  while (i > 0 && STEPS[i] === "chooseBadges" && !badgeChoiceIsPending()) i--;
  // Index 0 is Home. Leaving the run entirely is the Home button's job (it
  // confirms first), so Back simply doesn't render on the first in-flow screen.
  return i <= 0 ? -1 : i;
}

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

// A cost as a share of the FULL cap — never of the remaining space. Dividing by
// the whole $100M keeps shares additive as picks lock in (8% + 5% reads as 13% of
// the budget committed), which a share-of-remaining would not.
//
// Deliberately divides by BUDGET_CAP/100 rather than doing (h / BUDGET_CAP) * 100:
// the latter is a DIFFERENT float expression from fmtSalary's h/100 and disagreed
// with it at the rounding boundary — cost 1785 printed "$17.9M · 17.8%" because
// (1785/10000)*100 is 17.849999999999998 while 1785/100 is 17.85. Reusing the same
// division keeps the pair identical at every cost (under a $100M cap the share and
// the dollar figure are the same number, so any gap is a visible bug).
function capPct(hundredths) {
  return (hundredths / (BUDGET_CAP / 100)).toFixed(1).replace(/\.0$/, "") + "%";
}

// The modes with no salary cap: Classic (autoPick) and Sandbox. Named because
// more than the budget hangs off it — scaleOVR's calibration is only valid when
// a cap is actually constraining the build (see scaleOVR).
function uncappedMode() {
  return !!(state.sandbox || state.autoPick);
}

function budgetRemaining() {
  // Sandbox lifts the cap entirely. Returning Infinity is deliberately the ONLY
  // budget change needed: getRosterOptions gates purely on `cost <= remaining`,
  // so every roster player becomes affordable and the budget-bin fallback (which
  // only exists to prevent a soft-lock when nothing is affordable) never fires.
  if (uncappedMode()) return Infinity;
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

// Un-make a pick: refund its cost and empty the slot. This is what stepping
// BACK into an attribute screen does, and it is what keeps the budget honest —
// lockSkill/lockPhysical always ADD a cost, so re-picking a slot that still
// held its old pick would charge both. Returns the removed pick, or null if the
// slot was already empty (Back pressed twice, a mode that never filled it).
function unlockPick(category) {
  const old = currentPick(category);
  if (!old) return null;
  state.budgetSpent -= old.cost;
  if (category === "height" || category === "athleticism") state[category] = null;
  else delete state.skills[category];
  // Dropping the pick drops any trait it carried, so an activation referring to
  // it is now dead. activeBadgeMods() already ignores unacquired keys and
  // chooseBadges re-filters on the way forward, so nothing downstream breaks —
  // but leaving a dangling key in state is a trap, and the pick going away is
  // exactly the moment it stops being valid.
  state.activeBadges = state.activeBadges.filter(k => k !== old.name + "|" + category);
  return old;
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

// Names already locked into the build, across categories (optionally excluding
// one — the category being (re)picked right now, whose own slot must not count
// against itself). The no-budget team-spin mode forbids reusing a player, so
// its roster list filters against this. Salary Cap and Sandbox allow repeats
// and never call it.
function usedPickNames(exceptCategory = null) {
  return CATEGORIES
    .filter(c => c !== exceptCategory)
    .map(c => currentPick(c))
    .filter(Boolean)
    .map(p => p.name);
}

// Team abbrs already locked into the build (each pick carries its .team), minus
// the category being (re)picked. The no-budget wheel forbids landing on a team
// twice, so it draws from the teams NOT in here. Derived, not stored: unlocking
// a pick (Back) or resetting frees its team automatically. Only this mode calls
// it — Salary Cap and Sandbox allow team repeats.
function usedTeamAbbrs(exceptCategory = null) {
  const set = new Set();
  for (const c of CATEGORIES) {
    if (c === exceptCategory) continue;
    const p = currentPick(c);
    if (p && p.team) set.add(p.team.abbr);
  }
  return [...set];
}

// The teams the no-budget wheel can still land on: all 30 minus those already
// locked in other picks. 30 on pick 1, down to 23 by pick 8 (7 distinct teams
// locked before it).
function availableTeams(exceptCategory = null) {
  const used = new Set(usedTeamAbbrs(exceptCategory));
  return TEAMS.filter(t => !used.has(t.abbr));
}

// ---- No-budget player spinner: free stat choice ----
// The physical attributes are stored as {rating, label} bands on each player
// (height 90 -> "7'1\"", athleticism 90 -> "Elite"). Derive the band tables ONCE
// from the roster data so they can never drift from it, keyed by rating.
function deriveBands(key) {
  const m = new Map();
  for (const abbr of Object.keys(TEAM_ROSTERS))
    for (const p of TEAM_ROSTERS[abbr]) m.set(p[key].rating, p[key].label);
  return [...m.entries()].map(([rating, label]) => ({ rating, label }))
    .sort((a, b) => a.rating - b.rating);
}
const HEIGHT_BANDS = deriveBands("height");
const ATHLETICISM_BANDS = deriveBands("athleticism");

// The band label for a rating on a physical scale. Used when a freely-chosen
// stat rating fills the Height or Athleticism slot, so the physical descriptor
// on the verdict matches the NUMBER that actually went into the slot (e.g. a
// playmaking 95 dropped into Height reads as a 7'2"-ish giant, not a mismatch).
function physicalBandLabel(category, rating) {
  const table = category === "athleticism" ? ATHLETICISM_BANDS : HEIGHT_BANDS;
  let best = table[0];
  for (const b of table) if (Math.abs(b.rating - rating) < Math.abs(best.rating - rating)) best = b;
  return best.label;
}

// The players a fresh spin can land on: the team's roster minus anyone already
// locked into another slot (no player repeats). Teams never repeat, so a
// freshly-landed team is always all-fresh — this filter is belt-and-suspenders.
function spinnablePlayers(team, exceptCategory = null) {
  const used = new Set(usedPickNames(exceptCategory));
  return (TEAM_ROSTERS[team.abbr] || []).filter(p => !used.has(p.name));
}

// Build the pick that a chosen stat fills the current slot with. THE mechanic:
// `chosenStat` may differ from `slotCategory` (free, off-category choice), and
// its rating becomes the slot's rating for all downstream math. Physical slots
// synthesise a band label from that rating; skill slots carry none, exactly as a
// normal skill pick. cost 0 so budgetSpent never moves (no-budget mode).
function buildStatPick(player, team, slotCategory, chosenStat) {
  const rating = categoryRating(player, chosenStat);
  const label = (slotCategory === "height" || slotCategory === "athleticism")
    ? physicalBandLabel(slotCategory, rating) : null;
  return { name: player.name, era: player.era, team, cost: 0, rating, label, chosenStat };
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

// Single source of truth for the weighted-OVR blend: skills carry most of the
// weight (Defense/Shooting/Finishing heaviest), the two physicals least. Shared
// by computeOVR (finished build) and projectedOVR (live estimate) so the number
// the sidebar previews can't drift from the number the sim actually uses.
const OVR_WEIGHTS = {
  Shooting: 0.16, Finishing: 0.16, Playmaking: 0.14, Handles: 0.12,
  Defense: 0.18, Rebounding: 0.14, height: 0.05, athleticism: 0.05,
};

// A weighted average always lies between the min and max of its inputs, so the
// only way OVR can exceed the build's best single rating is something additive on
// top. inputCeiling() enforces that bound, and deliberately measures it against
// the ratings the player actually PICKED (pre-applyModifiers) — those are the
// numbers shown in the sidebar, so an overall above the best of them reads as
// broken no matter how it was derived. The height/athleticism synergy can still
// shift weight toward a build's strengths and push the average up toward that
// ceiling; it just can't manufacture an overall above every rating on the card.
// Both breaches this closes: the +3 position-fit bonus (all-84 build + fit
// reported 87) and synergy-inflated skills (the same build with elite
// athleticism reported 90).
function inputCeiling() {
  let m = -Infinity;
  if (state.height) m = Math.max(m, state.height.rating);
  if (state.athleticism) m = Math.max(m, state.athleticism.rating);
  SKILL_ORDER.forEach(s => { if (state.skills[s]) m = Math.max(m, state.skills[s].rating); });
  return m;
}

function computeOVR() {
  const f = finalSkills();
  const vals = { ...f, height: state.height.rating, athleticism: state.athleticism.rating };
  let ovr = 0;
  for (const k in OVR_WEIGHTS) ovr += vals[k] * OVR_WEIGHTS[k];
  const bonus = state.positionFit ? 3 : 0;
  return clamp(Math.round(Math.min(ovr + bonus, inputCeiling())), 25, 99);
}

// Live WEIGHTED OVR estimate from whatever slots are filled so far, expressed on
// the SAME scaled peak axis the verdict uses (scaleOVR) so it reads as "what this
// build translates to", not the flat unweighted average. Unlike computeOVR it
// tolerates a partial build: it weights only the filled slots and renormalizes,
// so it reflects the picks actually made instead of assuming zeros for the empty
// ones. Skill height/athleticism synergies (applyModifiers) fold in only once
// BOTH physicals are locked — matching finalSkills — and before that the raw
// picked ratings are used. The +3 position-fit bonus joins as soon as a fitting
// position is chosen. At 8/8 with a fitting position this equals
// scaleOVR(computeOVR()) — i.e. the pre-variance Peak the sim starts from.
// Returns null when nothing is filled yet.
function projectedOVR() {
  const bothPhysicals = state.height && state.athleticism;
  let sum = 0, wsum = 0, ceiling = -Infinity;
  for (const cat in OVR_WEIGHTS) {
    const pick = currentPick(cat);
    if (!pick) continue;
    const r = (SKILL_ORDER.includes(cat) && bothPhysicals) ? applyModifiers(pick.rating, cat) : pick.rating;
    sum += r * OVR_WEIGHTS[cat];
    wsum += OVR_WEIGHTS[cat];
    // Same input-ceiling bound computeOVR applies, over the slots filled so far —
    // measured on the PICKED rating, not the synergy-modified one.
    if (pick.rating > ceiling) ceiling = pick.rating;
  }
  if (!wsum) return null;
  const bonus = state.positionFit ? 3 : 0;
  // Bounded before AND after scaling, for the same reason baseOVRDisplay is.
  return Math.min(scaleOVR(clamp(Math.round(Math.min(sum / wsum + bonus, ceiling)), 25, 99)), ceiling);
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

// REMOVED WHEN THE MIGRATION COMPLETED (all 30 teams now have a starting five):
// computeTeamNeeds() / bestFitScore(), which derived each team's positional
// "need" as a z-score over its HISTORICAL roster in TEAM_ROSTERS. That was the
// placeholder while divisions were being migrated one at a time. It answered a
// different question from the one the screen now asks — it said "which position
// has this franchise historically been thin at", not "who is the weak link in
// the lineup you would join" — and once every team had a five it was unreachable.
// weakestSlot() is the answer now. See teamNeedPosition below.

// ---- Starting fives -> Supporting Cast Rating ----
// TEAM_FIVES (data.js) is the player-visible source of team quality, and as of
// the completed migration it covers ALL 30 teams. It does NOT create a second
// team-strength axis: everything downstream still consumes ONE number, SCR, and
// effectiveScr() is the single place a five is converted into it.
//
// THE MAPPING. simSeason pays 0.35 wins per SCR point. Two league-wide anchors:
//   SCR_BASE    64 — the league mean of the ORIGINAL 30 hand-authored SCRs (64.1).
//                    An average five must map to an average supporting cast, so
//                    the pivot is the data's mean, not simSeason's 60 pivot;
//                    using 60 would quietly dock every team ~1.4 wins.
//   FIVE_ANCHOR 79 — the rating an average NBA starting five averages on this
//                    scale. Measured across all 30 authored fives: 79.20. Good.
//   SCR_SLOPE  4.4 — chosen when only 5 teams existed, assuming five-averages
//                    would spread about sd 4.0 (SCR's own spread, 17.5, over 4).
//
// KNOWN AND DELIBERATE, NOT A BUG — read before touching SCR_SLOPE. That sd 4.0
// assumption was wrong. All 30 fives measure sd 2.69 and span only 74-84, because
// no real NBA team fields a starting five below ~74. So the mapping compresses:
// SCR now spans 42-86 (sd 11.9) against the legacy 25-90 (sd 17.5), i.e. team
// choice is worth ~15 wins end to end instead of ~23, and nothing reaches the
// clamps. Restoring the legacy spread needs SCR_SLOPE ~6.5. That is a live
// product decision, deliberately NOT taken unilaterally, because it re-tunes all
// 30 teams at once. The per-team before/after tables are in the phase 1-6 commits.
const SCR_BASE = 64;
const FIVE_ANCHOR = 79;
const SCR_SLOPE = 4.4;

const TEAMS_BY_ABBR = {};
TEAMS.forEach(t => { TEAMS_BY_ABBR[t.abbr] = t; });

const POSITION_ORDER = Object.keys(POSITIONS); // PG..C

function hasStartingFive(abbr) {
  return Array.isArray(TEAM_FIVES[abbr]) && TEAM_FIVES[abbr].length === POSITION_ORDER.length;
}

// THE INVARIANT THAT REPLACED THE FALLBACK PATH. Every function below assumes a
// team has a five, because every team does. That assumption is only safe if it is
// enforced, so it is enforced HERE, loudly, at load — not re-checked in six
// callers that would each have to invent a sensible answer for a team without a
// lineup. test-tiers.js is a pre-commit gate, so a malformed TEAM_FIVES fails the
// commit rather than reaching a player.
(function assertEveryTeamHasAFive() {
  const bad = TEAMS.filter(t => !hasStartingFive(t.abbr)).map(t => t.abbr);
  if (bad.length) {
    throw new Error(
      `TEAM_FIVES is incomplete: ${bad.join(", ")} have no starting five. ` +
      `Every team in TEAMS needs exactly ${POSITION_ORDER.length} rows (PG..C) in data.js.`);
  }
})();

function teamFive(abbr) {
  return TEAM_FIVES[abbr];
}
// Plain mean, rounded — the player can verify it by eye off the five rows on
// screen. A positional weighting would be defensible but not checkable, and the
// whole point of this screen is that the number is legible.
//
// The cost of that choice, measured once all 30 existed: a plain mean cannot tell
// a star-plus-holes team from a balanced-but-starless one. Milwaukee (Giannis 95
// alongside four 73-80s) reads 79; Toronto (five 75-80s, no star) reads 78.
// Best-starter-minus-mean runs +16 (MIL) down to +2 (TOR). Flagged, not fixed.
function teamRatingFromFive(abbr) {
  const five = teamFive(abbr);
  return Math.round(five.reduce((a, p) => a + p.rating, 0) / five.length);
}
// The slot a signing would most obviously improve: lowest-rated starter.
// Ties resolve to the earlier position (PG..C).
function weakestSlot(abbr) {
  const five = teamFive(abbr);
  let best = null;
  POSITION_ORDER.forEach(pos => {
    const p = five.find(s => s.pos === pos);
    if (p && (best === null || p.rating < best.rating)) best = p;
  });
  return best.pos;
}
function starterAt(abbr, pos) {
  return teamFive(abbr).find(p => p.pos === pos) || null;
}
// Team rating if buildRating replaced the current starter at `pos`. Only that
// slot changes; the other four are the cast the build actually plays alongside.
function projectedRatingWith(abbr, pos, buildRating) {
  const swapped = teamFive(abbr).map(p => (p.pos === pos ? buildRating : p.rating));
  return Math.round(swapped.reduce((a, r) => a + r, 0) / swapped.length);
}
// The ORIGINAL five, never the projected-with-you version: SCR is the cast
// AROUND the build, and simSeason already adds the build's own OVR separately.
function effectiveScr(abbr) {
  return clamp(Math.round(SCR_BASE + (teamRatingFromFive(abbr) - FIVE_ANCHOR) * SCR_SLOPE), 25, 90);
}
// The position a team most needs filled, answered from the visible lineup.
// Kept as a named function rather than inlining weakestSlot at every call site:
// callers mean "what does this team need", which is a question the UI, the sim
// harness and the share decoder all ask, and only this file should decide that
// the answer happens to be "its worst starter". Same +5 SCR semantics as before.
function teamNeedPosition(abbr) {
  return weakestSlot(abbr);
}

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

// ---- Award tuning ----
// EVERY number that decides an award lives here, and both the roll and the
// verdict screen's plain-English explanation (awardReasons) read these same
// bindings. That is the point: this project has retuned award logic repeatedly,
// and a hand-written blurb saying "cleared the 80-OVR bar" would silently start
// lying the first time someone edited the gate. Retune here and the explanation
// on screen follows automatically.
const MVP_OVR_GATE = 80, MVP_WIN_GATE = 50;
const MVP_OVR_SPAN = 14, MVP_WIN_SPAN = 18;   // how far past the gate counts as "by a mile"
const MVP_BASE_ODDS = 0.08, MVP_RAMP = 0.82, MVP_OVR_SHARE = 0.65;
const FINALS_MVP_OVR = 78;
const ALLDEF_1ST = 93, ALLDEF_2ND = 85;
const ALLNBA_1ST_SCORE = 38, ALLNBA_2ND_SCORE = 31;
const ALLNBA_Q_FLOOR = 18, ALLNBA_Q_SPAN = 17;
const ALLSTAR_Q_FLOOR = 15, ALLSTAR_Q_SPAN = 12;
const ROTY_PPG = { floor: 14, span: 8 }, ROTY_APG = { floor: 7.5, span: 3.5 }, ROTY_RPG = { floor: 9.5, span: 3.5 };
const ROTY_BASE_ODDS = 0.05, ROTY_RAMP = 0.82;
const DPOY_BPG = { floor: 2.0, span: 1.8, w: 0.45 };
const DPOY_SPG = { floor: 1.2, span: 1.3, w: 0.30 };
const DPOY_RPG = { floor: 9.0, span: 5.0, w: 0.25 };
const DPOY_BASE_ODDS = 0.09, DPOY_RAMP = 0.30, DPOY_STREAK_BONUS = 0.06, DPOY_MAX_ODDS = 0.5;

function mvpOdds(ovr, wins) {
  const ovrEdge = Math.min(1, (ovr - MVP_OVR_GATE) / MVP_OVR_SPAN);
  const winEdge = Math.min(1, (wins - MVP_WIN_GATE) / MVP_WIN_SPAN);
  return MVP_BASE_ODDS + MVP_RAMP * (MVP_OVR_SHARE * ovrEdge + (1 - MVP_OVR_SHARE) * winEdge);
}
// The shared OFFENSIVE case behind both All-NBA and All-Star. Extracted so the
// two rolls and the explanation cannot compute it three different ways.
function offensiveCase(stats, wins) {
  const off =
    stats.ppg +                                   // scoring volume is the spine
    Math.max(0, stats.apg - 4) * 0.8 +            // playmaking is the clear #2
    Math.max(0, stats.fgPct - 50) * 0.20 +        // efficiency, lightly
    Math.max(0, stats.tptPct - 34) * 0.12;
  const winBonus = Math.max(0, wins - 45) * 0.15; // team success helps the case
  return { off, winBonus, score: off + winBonus };
}
function dpoyDominance(stats) {
  return clamp(
    (stats.bpg - DPOY_BPG.floor) / DPOY_BPG.span * DPOY_BPG.w +
    (stats.spg - DPOY_SPG.floor) / DPOY_SPG.span * DPOY_SPG.w +
    (stats.rpg - DPOY_RPG.floor) / DPOY_RPG.span * DPOY_RPG.w, 0, 1);
}

// ---- Season / career sim ----
function simSeason(ovr, scr, varianceRange, defRating = 0) {
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

  // All-Star, All-NBA and ROTY are all resolved later in simCareer, once the
  // season's real box score exists — see allStarSelection / allNbaSelection /
  // rotyRoll. None of them can be decided here: a raw-OVR gate cannot tell a
  // 24-PPG scorer from a 9-PPG build with the same overall rating.

  // MVP odds SCALE with how dominant the season was, rather than a flat roll at
  // the qualifying line. A flat 35% meant a merely-eligible 80-OVR/50-win year
  // and a historically unprecedented 99-OVR/70-win year were equally likely to
  // win it — so a build posting an all-time statline every season still lost
  // the award roughly two years in three. Now clearing the bar barely is a long
  // shot (~8%), while a season that clears it by a wide margin on a winning
  // team takes it the large majority of the time.
  let mvp = false;
  if (ovr >= MVP_OVR_GATE && wins >= MVP_WIN_GATE) {
    mvp = rng() < mvpOdds(ovr, wins);
  }

  let finalsMVP = ring && ovr >= FINALS_MVP_OVR;

  // Defensive Player of the Year is resolved in simCareer (dpoyRoll), NOT here:
  // it scales with the season's actual defensive BOX SCORE and compounds over
  // consecutive elite-defensive seasons, and those aren't known until the stats
  // are generated. A flat per-season roll on the constant Defense rating (the old
  // approach) left a build with 14 straight dominant defensive seasons winning 0.

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
  if (seasonDef >= ALLDEF_1ST) allDefensive = "1st";
  else if (seasonDef >= ALLDEF_2ND) allDefensive = "2nd";

  // allStar / allNBA / roty are attached by simCareer once the box score exists.
  // seasonDef rides along so the verdict screen can EXPLAIN the All-Defensive
  // selection with the number that actually decided it (see awardReasons).
  return { wins, madePlayoffs, ring, finalsMVP, mvp, allDefensive, roundsWon, seasonDef };
}

// All-NBA selection AND 1st/2nd/3rd tier, called from simCareer once the box
// score and hardware are known. All-NBA is an OFFENSE-first honor: scoring volume
// is the spine, with credit for playmaking and efficiency plus team success
// (wins). Defense/Rebounding deliberately DO NOT feed it — that is what the
// All-Defensive Team recognizes — so a low-scoring defensive anchor lands
// All-Defensive every year but All-NBA only rarely (the capped 3rd-team path at
// the bottom), while a genuine scorer earns it at a normal high rate. The old
// version qualified on overall OVR, which bakes in Defense (0.18) and Rebounding
// (0.14), so a 5.5-PPG rim protector made All-NBA nearly every season — the bug.
function allNbaSelection(stats, wins, mvp, allDefensive) {
  const { score } = offensiveCase(stats, wins);
  // Selection is a PROBABILITY RAMP on the offensive case (same shape as the MVP
  // and DPOY rolls), not a hard cutoff: a season's odds grade with how much it
  // scores, so a build's career All-NBA count scales smoothly with its scoring
  // instead of being all-or-nothing at a line (which made the count bimodal and
  // swung the tier distribution). Calibrated so a strong ~24-PPG scorer averages
  // the same ~7-8 selections it did under the old OVR gate, an elite scorer makes
  // it nearly every year, and a low-scoring season almost never qualifies here.
  const q = clamp((score - ALLNBA_Q_FLOOR) / ALLNBA_Q_SPAN, 0, 1); // ~18 -> 0%, ~35+ -> ~100%
  if (mvp || rng() < q) {
    if (mvp || score >= ALLNBA_1ST_SCORE) return "1st";
    if (score >= ALLNBA_2ND_SCORE) return "2nd";
    return "3rd";
  }
  // Generational two-way defender: a capped, occasional 3rd-team nod scaled by how
  // dominant the defense was, gated on a 1st-team All-Defensive season. Never
  // higher than 3rd on defense alone — this is what keeps a defense-first star at
  // ~2-4 All-NBA across a career instead of 12-14.
  if (allDefensive === "1st") {
    const domD = clamp((stats.bpg - 2.5) / 1.5 * 0.5 + (stats.spg - 1.5) / 1.0 * 0.3 + (stats.rpg - 10) / 4 * 0.2, 0, 1);
    if (rng() < 0.08 + 0.28 * domD) return "3rd";
  }
  return null;
}

// All-Star selection for one season, resolved in simCareer once the box score is
// known. This used to be a bare `ovr >= 70` gate, which is why a 9.3-PPG /
// 8.7-RPG / 7-APG build at raw OVR 73 made All-Star in EVERY season of a 15-year
// career: overall OVR bakes in Defense (0.18) and Rebounding (0.14), so being good
// everywhere and great nowhere cleared the line permanently — the same flaw that
// All-NBA had before it moved to a box-score case.
//
// Real All-Stars are either high-volume scorers or carry one genuine signature
// strength, so this takes the BETTER of two cases:
//   - the OFFENSIVE case: the same spine All-NBA uses, on a lower bar (~24-30
//     All-Stars are named a year against 15 All-NBA slots)
//   - the SIGNATURE case: an anchor defender, a lead playmaker at star volume, or
//     a dominant rebounder can make the team without scoring — that's how the
//     Mutombo/Rodman/Ben-Wallace type of All-Star happened. Capped well below the
//     scoring path so it grants a few nods across a career, not a permanent seat.
// allStarCase exposes BOTH paths and which one is carrying the season, so the
// explanation on the verdict screen names the real reason ("13.1 RPG signature
// case") instead of always claiming it was scoring.
function allStarCase(stats, wins, allDefensive) {
  const { score } = offensiveCase(stats, wins);
  const scoringCase = clamp((score - ALLSTAR_Q_FLOOR) / ALLSTAR_Q_SPAN, 0, 1); // ~15 -> 0%, ~27+ -> ~100%
  const defCase = allDefensive === "1st" ? 0.45 : allDefensive === "2nd" ? 0.18 : 0;
  const passCase = clamp((stats.apg - 7.5) / 3, 0, 1) * 0.6;
  const rebCase = clamp((stats.rpg - 12) / 3, 0, 1) * 0.45;
  const signature = Math.max(defCase, passCase, rebCase);
  const sigDriver = signature === 0 ? null
    : signature === defCase ? "defense" : signature === passCase ? "passing" : "rebounding";
  return { score, scoringCase, signature, sigDriver, odds: Math.max(scoringCase, signature) };
}
function allStarSelection(stats, wins, allDefensive) {
  return rng() < allStarCase(stats, wins, allDefensive).odds;
}

// Rookie of the Year, resolved in simCareer for the debut season only. ROTY is
// contested inside a single draft class, so a genuinely strong debut still wins it
// often — but the season has to SHOW something. The old version rolled on raw OVR
// alone (~93% for anything not a bust), which handed the award to a 9.7-PPG rookie
// with no standout category. Eligibility is now the best of the rookie's actual
// claims, and a debut that is merely respectable everywhere wins nothing.
function rotyCase(stats, allDefensive) {
  const scoring = clamp((stats.ppg - ROTY_PPG.floor) / ROTY_PPG.span, 0, 1);   // 14 -> 0, 22+ -> 1
  const passing = clamp((stats.apg - ROTY_APG.floor) / ROTY_APG.span, 0, 1);
  const boards  = clamp((stats.rpg - ROTY_RPG.floor) / ROTY_RPG.span, 0, 1);
  const defense = allDefensive === "1st" ? 0.7 : allDefensive === "2nd" ? 0.3 : 0;
  const best = Math.max(scoring, passing, boards, defense);
  const driver = best <= 0 ? null
    : best === scoring ? "scoring" : best === passing ? "passing" : best === boards ? "rebounding" : "defense";
  return { scoring, passing, boards, defense, best, driver, odds: best <= 0 ? 0 : ROTY_BASE_ODDS + ROTY_RAMP * best };
}
function rotyRoll(stats, allDefensive) {
  const c = rotyCase(stats, allDefensive);
  if (c.best <= 0) return false; // nothing notable in any category -> never ROTY
  return rng() < c.odds;
}

// Defensive Player of the Year roll for one season. Unlike the old flat per-season
// chance on the constant Defense rating, this scales with the season's actual
// defensive BOX SCORE (blocks/steals/boards) relative to a dominant line, is gated
// on a 1st-team All-Defensive season, and COMPOUNDS over consecutive elite
// defensive years (`streak` = prior back-to-back 1st-team All-D seasons). A career
// of sustained, generational defense now lands ~4-8 DPOYs instead of frequently 0.
function dpoyOdds(stats, streak) {
  let p = DPOY_BASE_ODDS + DPOY_RAMP * dpoyDominance(stats); // barely-1st-team ~0.09, dominant ~0.39
  p *= 1 + DPOY_STREAK_BONUS * streak;  // each consecutive elite-D season compounds the odds
  return Math.min(p, DPOY_MAX_ODDS);
}
function dpoyRoll(allDefensive, stats, streak) {
  if (allDefensive !== "1st") return false;
  return rng() < dpoyOdds(stats, streak);
}

// ---- Why did this season win that award? ----
// One short line per honor for the Career Stats by Year list, so a tag is not
// just an unexplained badge. Every number quoted is RECOMPUTED from the same
// constants and helpers the rolls used (mvpOdds, offensiveCase, allStarCase,
// rotyCase, dpoyOdds, ALLDEF_*, ALLNBA_*) — nothing here is a static blurb, so
// retuning an award updates its explanation with it.
//
// The rolls are probabilistic, so the honest answer to "why" is the CASE that
// made the roll likely, not a claim of certainty. Where a roll has competing
// paths (All-Star scoring vs signature, ROTY's four categories) the explanation
// names whichever one was actually carrying the season.
function pct(p) { return Math.round(p * 100) + "%"; }
function awardReasons(season) {
  const s = season.stats;
  const out = {};
  if (!s) return out;

  if (season.mvp) {
    out.mvp = `${season.seasonOVR} OVR on ${season.wins} wins — past the ${MVP_OVR_GATE} OVR / ${MVP_WIN_GATE} win gate, ${pct(mvpOdds(season.seasonOVR, season.wins))} odds`;
  }
  if (season.finalsMVP) {
    out.finalsMVP = `title season at ${season.seasonOVR} OVR — Finals MVP needs ${FINALS_MVP_OVR}+`;
  }
  if (season.allDefensive) {
    const line = `${ALLDEF_1ST}+ is 1st team, ${ALLDEF_2ND}+ is 2nd`;
    out.allDefensive = `${season.seasonDef} defensive rating this season — ${line}`;
  }
  if (season.dpoy) {
    const streak = season.dStreak > 0 ? `, ×${(1 + DPOY_STREAK_BONUS * season.dStreak).toFixed(2)} from ${season.dStreak} straight elite-D year${season.dStreak > 1 ? "s" : ""}` : "";
    out.dpoy = `${s.bpg} BPG · ${s.spg} SPG · ${s.rpg} RPG off a 1st-team defensive season — ${pct(dpoyOdds(s, season.dStreak))} odds${streak}`;
  }
  if (season.allNBA) {
    const { off, winBonus, score } = offensiveCase(s, season.wins);
    // q is 0 at or below the floor, so a 3rd-team nod there can ONLY have come
    // through the capped defensive path — that is deterministic, not a guess.
    const viaDefense = season.allNBA === "3rd" && score <= ALLNBA_Q_FLOOR;
    if (viaDefense) {
      out.allNBA = `defensive path — 1st-team All-D at ${s.bpg} BPG · ${s.spg} SPG, which caps at 3rd team`;
    } else if (season.mvp) {
      out.allNBA = `MVP season — an MVP is 1st team automatically`;
    } else {
      const bar = season.allNBA === "1st" ? `${ALLNBA_1ST_SCORE}+ makes 1st`
        : season.allNBA === "2nd" ? `${ALLNBA_2ND_SCORE}+ makes 2nd, ${ALLNBA_1ST_SCORE}+ makes 1st`
        : `below the ${ALLNBA_2ND_SCORE} line for 2nd team`;
      out.allNBA = `${score.toFixed(1)} offensive score (${off.toFixed(1)} box score + ${winBonus.toFixed(1)} for ${season.wins} wins) — ${bar}`;
    }
  }
  if (season.allStar) {
    const c = allStarCase(s, season.wins, season.allDefensive);
    if (c.signature > c.scoringCase && c.sigDriver) {
      const stat = c.sigDriver === "passing" ? `${s.apg} APG` : c.sigDriver === "rebounding" ? `${s.rpg} RPG` : `1st-team All-Defensive`;
      out.allStar = `${stat} — made it on the ${c.sigDriver} case, not scoring (${pct(c.signature)} odds)`;
    } else {
      out.allStar = `${s.ppg} PPG on a ${season.wins}-win team — ${c.score.toFixed(1)} scoring case, ${pct(c.scoringCase)} odds`;
    }
  }
  if (season.roty) {
    const c = rotyCase(s, season.allDefensive);
    const stat = c.driver === "scoring" ? `${s.ppg} PPG` : c.driver === "passing" ? `${s.apg} APG`
      : c.driver === "rebounding" ? `${s.rpg} RPG` : `1st-team All-Defensive`;
    const floor = c.driver === "scoring" ? `${ROTY_PPG.floor} PPG` : c.driver === "passing" ? `${ROTY_APG.floor} APG`
      : c.driver === "rebounding" ? `${ROTY_RPG.floor} RPG` : "an All-Defensive nod";
    out.roty = `${stat} debut — cleared the ${floor} rookie bar on ${c.driver}, ${pct(c.odds)} odds`;
  }
  return out;
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
//
// CRITICAL: that 25..83 premise only holds while a cap is actually constraining
// the build. The no-cap modes (Classic, Sandbox) can buy elite ratings in every
// slot and reach raw 94+ on their own, so applying the 1.276x expansion there
// stretched an already-full axis: a legitimate raw 81 build was displayed as
// Base OVR 96, and Classic's top tiers became far too easy (51.8% Legend-or-
// better at optimal play). Uncapped modes therefore report the raw axis as-is —
// they already span the published ladder without help.
function scaleOVR(raw) {
  if (uncappedMode()) return clamp(Math.round(raw), 25, 99);
  return clamp(Math.round((raw - 25) * (74 / 58) + 25), 25, 99);
}

// The Base OVR the verdict displays: the finished build on the same scaled axis
// as Peak, but never above the best rating actually picked. Under the cap the
// scaleOVR expansion can still nudge a point past that ceiling (measured: 0.1% of
// greedy builds, by at most +1), so the bound is re-applied after scaling. Display
// only — simCareer, the award gates and the tier floors all stay on the raw axis.
function baseOVRDisplay() {
  return Math.min(scaleOVR(computeOVR()), inputCeiling());
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
  let dStreak = 0;         // consecutive prior 1st-team All-Defensive seasons (compounds DPOY odds)
  const varianceRange = state.positionFit ? 4 : 8;
  const f = finalSkills();
  const totals = { pts: 0, ast: 0, reb: 0, stl: 0, blk: 0, threes: 0 };
  let fgSum = 0, tptSum = 0; // percentages are averaged, not summed
  let bestSeason = null;

  for (let i = 0; i < numSeasons; i++) {
    const seasonOVR = clamp(ovr + randInt(-3, 3), 25, 99);
    peakOVR = Math.max(peakOVR, scaleOVR(seasonOVR)); // seasonOVR itself stays raw for the award gates
    // Filling the team's positional need lifts the supporting cast a touch.
    const teamScr = effectiveScr(team.abbr) + (state.teamNeedMet ? 5 : 0);
    const scrThisYear = clamp(teamScr + randInt(-5, 5), 15, 99);
    const result = simSeason(seasonOVR, scrThisYear, varianceRange, f.Defense);
    careerWins += result.wins;
    if (result.ring) rings++;
    if (result.mvp) { mvps++; bestMVPOVR = Math.max(bestMVPOVR, scaleOVR(seasonOVR)); }
    if (result.finalsMVP) finalsMVPs++;
    if (result.allDefensive) allDefensives++;

    const stats = generateSeasonStats(seasonOVR, f, state.height.rating, state.athleticism.rating, mods);
    // All-Star needs the box score for the same reason All-NBA does: overall OVR
    // can't tell a 24-PPG scorer from a 9-PPG build rated the same.
    result.allStar = allStarSelection(stats, result.wins, result.allDefensive);
    if (result.allStar) allStars++;
    // ROTY is the debut season only, and now keys on what the rookie actually did.
    result.roty = i === 0 && rotyRoll(stats, result.allDefensive);
    if (result.roty) roty = 1;
    // DPOY scales with the season's real defensive box score and compounds over
    // consecutive elite-defensive seasons (dStreak), so it's resolved here — after
    // the stats exist — not on the flat constant rating inside simSeason.
    result.dpoy = dpoyRoll(result.allDefensive, stats, dStreak);
    if (result.dpoy) dpoys++;
    // Kept on the season so awardReasons can quote the compounding factor that
    // actually applied to THIS roll — dStreak advances immediately below.
    result.dStreak = dStreak;
    result.seasonOVR = seasonOVR;
    result.isRookie = i === 0;
    dStreak = result.allDefensive === "1st" ? dStreak + 1 : 0;
    // All-NBA needs the season's box score + hardware, so it's resolved here.
    // It's OFFENSE-driven (see allNbaSelection) — defense no longer inflates it.
    result.allNBA = allNbaSelection(stats, result.wins, result.mvp, result.allDefensive);
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
//   Superstar 85-90 | Legend 90-98 | GOAT 98-99
const TIER_OVR_FLOORS = {
  "Bench Piece": 60, "Starter": 70, "All-Star": 80,
  "Superstar": 85, "Legend": 90, "GOAT": 98,
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
//
// THE PEAK-OVR FLOOR IS ABSOLUTE. No alternate path, award record, longevity
// total or MVP season may bypass it. This line previously read
//     if (ovrFloor && effectivePeak < ovrFloor && !hasAltPath(...)) return false;
// and that `!hasAltPath` clause is the single defect behind this bug class, which
// resurfaced 5-6 times: it let any tier's alt path waive the OVR band entirely, so
// a Peak-OVR-83 career with 15 All-NBA (or 2 DPOY, or the volume path) was granted
// LEGEND, whose floor is 90. Alt paths now do only what meetsAwardFloor documents:
// stand in for the MVP requirement. See also clampTierToPeak, a second, structural
// guarantee applied to every value tierForCareer returns.
function meetsTierFloors(tierName, effectivePeak, career) {
  const ovrFloor = TIER_OVR_FLOORS[tierName];
  if (ovrFloor && effectivePeak < ovrFloor) return false;
  return meetsAwardFloor(tierName, career, altPathWaivesMvp(tierName, career));
}

// ---- STRUCTURAL INVARIANT: the published band is the ceiling, always ----
// The recurring failure was never one bad comparison; it was that tier assignment
// had several routes and each new route had to remember the floor. So the rule is
// enforced ONCE more at the exit, independently of how a tier was chosen: whatever
// any path decides, the result is clamped to the highest tier the career's peak OVR
// actually permits. A future alt path, award tweak or new code path cannot lift a
// career above its band without deleting this function.
//   Draft Bust <60 | Bench 60 | Starter 70 | All-Star 80 | Superstar 85
//   Legend 90 | GOAT 98        (TIER_OVR_FLOORS is the single source of truth)
function highestTierIndexForPeak(effectivePeak) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    const floor = TIER_OVR_FLOORS[TIERS[i].name];
    if (!floor || effectivePeak >= floor) return i;
  }
  return 0;
}

function clampTierToPeak(tier, effectivePeak) {
  const cap = highestTierIndexForPeak(effectivePeak);
  const idx = TIERS.indexOf(tier);
  return idx > cap ? TIERS[cap] : tier;
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
  // EVERY return below goes through clampTierToPeak, so the published band holds
  // no matter which route produced the tier. Belt and braces on purpose: this bug
  // came back repeatedly because each new route re-implemented the floor check.
  const firstFloorTier = TIERS.findIndex(t => TIER_AWARD_FLOORS[t.name]);
  for (let i = TIERS.length - 1; i >= firstFloorTier; i--) {
    if (meetsTierFloors(TIERS[i].name, effectivePeak, c)) return clampTierToPeak(TIERS[i], effectivePeak);
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
  return clampTierToPeak(TIERS[Math.max(0, Math.min(byOvr, byScore))], effectivePeak);
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
// A comp player's career CALIBER on the same 0-6 rank scale as the tiers
// (0 Draft Bust .. 6 GOAT), derived from real accolades. Every comp is a real
// NBA player, so even a decorated-nothing journeyman floors at 1 (Bench/Starter),
// never 0. Hardware weighs most, All-NBA/All-Star least.
function compCaliber(acc) {
  const s = acc.rings * 3 + acc.mvps * 4 + acc.finalsMVPs * 2 + acc.allNBA * 0.6 + acc.allStar * 0.4;
  let band = s >= 26 ? 6   // GOAT resume
    : s >= 15 ? 5          // Legend
    : s >= 8 ? 4           // Superstar
    : s >= 3.5 ? 3         // All-Star
    : s >= 1 ? 2           // solid Starter
    : 1;                   // journeyman / role player
  // SELECTION FLOORS — the fix for a reported bug where a Bench-Piece build's #1
  // comp was Karl-Anthony Towns. The weighted score above is HARDWARE-first
  // (rings 3, MVP 4) and prices a selection at 0.4, so a perennial All-Star with
  // an empty trophy case scored below the 3.5 All-Star line and came out caliber
  // 2 — indistinguishable from a journeyman starter. Towns (4 All-Star, 1
  // All-NBA, no rings) scored 2.2. The caliber GATE therefore never fired for
  // him: at build rank 1 with a one-tier grace he cost nothing, so he won on raw
  // attribute proximity. Booker, Beal and Trae Young had the same hole.
  //
  // Being selected repeatedly IS an All-Star-caliber career, whatever else the
  // case holds. Applied as a floor rather than by re-weighting the score, so the
  // upper bands are untouched — raising the selection weights instead pushed
  // ring-less high-volume careers like Karl Malone from Legend to GOAT caliber.
  if (acc.allStar >= 3) band = Math.max(band, 3);
  if (acc.allStar >= 1 || acc.allNBA >= 1) band = Math.max(band, 2);
  return band;
}

// ARCHETYPE GATE. compDistance already emphasises extreme dimensions via
// sigEmphasis, but that is symmetric point-distance: it cannot express "this
// player is DEFINED by a skill the build does not have". A rebounding-first
// centre sits close to Towns on height and rebounding, and the shooting gap
// alone did not outvote that. This adds an explicit term: when a comp has a
// distinctive signature skill (clears its runner-up by SIGNATURE_MARGIN, the
// same rule signatureAttribute() uses for the build) and the build is well
// short of it, the comp is a worse archetype match than the raw geometry says.
// Symmetric — it also fires when the BUILD's signature is a skill the comp
// lacks, which is the reported case in the other direction.
const ARCHETYPE_MATCH_WEIGHT = 0.9;
function signatureOfDims(dims) {
  let attr = SKILL_ORDER[0];
  SKILL_ORDER.forEach(s => { if (dims[s] > dims[attr]) attr = s; });
  const runnerUp = Math.max(...SKILL_ORDER.filter(s => s !== attr).map(s => dims[s]));
  return { attr, distinctive: dims[attr] - runnerUp >= SIGNATURE_MARGIN };
}
function archetypePenalty(profile, ref) {
  let gap = 0;
  const compSig = signatureOfDims(ref.dims);
  if (compSig.distinctive) gap += Math.max(0, ref.dims[compSig.attr] - profile[compSig.attr]);
  const buildSig = signatureOfDims(profile);
  if (buildSig.distinctive) gap += Math.max(0, profile[buildSig.attr] - ref.dims[buildSig.attr]);
  return ARCHETYPE_MATCH_WEIGHT * gap;
}
// How much a build's OWN career tier gates the comp: a Bench-Piece or Draft-Bust
// build shouldn't match a multi-time All-Star just because the raw attributes
// line up (the free-stat mechanic makes lopsided low-tier builds — one huge stat,
// the rest floored — read attribute-close to athletic stars: an athletic-finisher
// Draft-Bust build sits only ~26 attribute-units from Amar'e Stoudemire but ~85
// from any true journeyman, so a gentle nudge can't override it). The penalty
// only fires when a comp is HIGHER caliber than the build (one-directional) and
// tolerates a ONE-tier difference for free — only a comp 2+ tiers too good is
// pushed down, steeply enough to beat that raw-distance head start. A decorated
// build matching a lesser comp is already handled by accompDistance.
const CALIBER_MATCH_WEIGHT = 14;
function tierRank(career) {
  if (!career) return null;
  const t = tierForCareer(career);
  return t ? TIERS.findIndex(x => x.name === t.name) : null;
}

// Full comp pool ranked closest-first: skill distance + accolade proximity +
// archetype alignment, with the caliber gate as a HARD PARTITION rather than a
// weight. Ties broken alphabetically so the ordering is deterministic.
//
// WHY A PARTITION AND NOT A BIGGER PENALTY. The additive penalty was the reported
// bug's second cause: at CALIBER_MATCH_WEIGHT 14 it added 14 units against
// attribute distances of 80-110, i.e. noise. Raising it does not converge —
// measured over 300 low-tier careers, tier-inappropriate primaries only fell
// 95% -> 28% between weight 14 and 56, because the low-caliber end of the pool is
// deliberately flat (every comp at caliber <=2 sits at 45-55 across the board,
// the best rebounder among them being 55). A Rebounding-95 build is therefore
// ~40 points from every appropriate comp on its defining skill but only ~13 from
// Gobert, so no finite weight orders them correctly for every build.
//
// The level of a career is a CONSTRAINT, not a preference: a Bench Piece build's
// comp should not be an All-Star at any attribute distance. So admissible comps
// (within CALIBER_GRACE tiers) are ranked ahead of the rest as a group, and the
// full distance still orders them within each group. Comps beyond the grace are
// kept, not dropped, so the list degrades gracefully rather than emptying if a
// build's tier has nothing near it. The weight survives as a gradient among the
// inadmissible tail.
//
// This partition applies to the WHOLE ranked list, which is the other half of the
// report: the primary and the "Shades of" pair were never scored differently —
// playstyleComp takes [0] and slice(1) of THIS list — but the shades only looked
// right by luck. The same run that produced Towns as primary also produced Yao
// Ming (8x All-Star) as a shade.
const CALIBER_GRACE = 1;  // a comp one tier above the build is still fair game
function topComps(profile, career = null, n = 3) {
  const bRank = tierRank(career);
  const overBy = ref => (bRank == null ? 0 : Math.max(0, compCaliber(accompOf(ref)) - bRank - CALIBER_GRACE));
  return COMP_PLAYERS
    .map(ref => {
      const over = overBy(ref);
      return {
        ref,
        over,
        dist: compDistance(profile, ref)
            + ACCOMP_MATCH_WEIGHT * accompDistance(career, accompOf(ref))
            + CALIBER_MATCH_WEIGHT * over * over
            + archetypePenalty(profile, ref),
      };
    })
    .sort((a, b) => (a.over > 0) - (b.over > 0) || a.dist - b.dist || (a.ref.name < b.ref.name ? -1 : 1))
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
  const sig = signatureAttribute();
  const b = career.bestSeason;
  const team = state.team.name;

  const buildArticle = /^[aeiou]/i.test(adj) ? "an" : "a";
  // Same rule as the headline: don't claim a game "ran through" one skill unless
  // that skill actually separates from the rest.
  const s1 = sig.distinctive
    ? `${name} was ${buildArticle} ${adj} ${state.height.label} ${pos} whose game ran through his ${sig.attr.toLowerCase()}.`
    : `${name} was ${buildArticle} ${adj} ${state.height.label} ${pos} whose game was built on balance rather than one standout skill.`;

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

// A build's signature skill AND whether that skill is actually distinctive.
//
// topAttribute() is a bare argmax, which OVERCLAIMS. A two-way big at Finishing 87
// / Defense 85 / Rebounding 85 got the headline "CARRIES ... ON FINISHING ALONE"
// because Finishing won by TWO points — while the comp system, which reads the
// whole profile shape rather than one argmax, correctly matched a defensive anchor
// (Alonzo Mourning, shades Gobert/Ewing). That read as the comp being broken when
// in fact the NARRATIVE was: nothing was drifting, since topAttribute() and
// buildProfile() both read the same finalSkills() values.
//
// So a skill only counts as the signature when it clears the next-best skill by
// SIGNATURE_MARGIN. Below that the build genuinely has no one standout, and the
// headline/report say so instead of inventing one. `attr` reuses topAttribute() so
// the two can never disagree on which skill is highest.
const SIGNATURE_MARGIN = 6;
function signatureAttribute() {
  const f = finalSkills();
  const attr = topAttribute();
  const runnerUp = Math.max(...SKILL_ORDER.filter(s => s !== attr).map(s => f[s]));
  const margin = f[attr] - runnerUp;
  return { attr, margin, distinctive: margin >= SIGNATURE_MARGIN };
}

function generateHeadline(career, tier) {
  const name = state.name || "The Mystery Player";
  const team = state.team.name;
  // Only name a single skill when it is genuinely the build's standout; a build
  // that is evenly strong across several gets balance phrasing instead of a
  // fabricated "on X alone" claim that the comp system would then contradict.
  const sig = signatureAttribute();
  if (career.rings > 0) {
    const engine = sig.distinctive ? `ELITE ${sig.attr.toUpperCase()}` : "A COMPLETE TWO-WAY GAME";
    return `${name.toUpperCase()} STUNS THE LEAGUE: ${team.toUpperCase()} RIDE ${engine} TO ${career.rings > 1 ? `${career.rings} RINGS` : "A RING"}`;
  }
  if (tier.name === "Draft Bust") {
    return `${name.toUpperCase()} FLAMES OUT IN ${team.toUpperCase()}: A CAUTIONARY TALE`;
  }
  return sig.distinctive
    ? `${name.toUpperCase()} CARRIES ${team.toUpperCase()} ON ${sig.attr.toUpperCase()} ALONE, FALLS SHORT OF A RING`
    : `${name.toUpperCase()} DOES EVERYTHING FOR ${team.toUpperCase()}, FALLS SHORT OF A RING`;
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
// weight tiers: 3 = the résumé pillars (rings/MVPs/All-NBA), the hard-to-earn
// prestige metrics; 1 = everything secondary (awards, peak seasons, and the
// career VOLUME totals below). Career totals are deliberately weight 1 and
// `big`/`volume` — easy to rack up over a long career, so they inform the grid
// and the majority read but never outweigh the pillars in the outcome.
const SHADOW_METRICS = [
  { key: "rings",  label: "Rings",     get: c => c.rings,           tgt: t => t.rings,   decimals: 0, weight: 3, phrase: "the rings" },
  { key: "mvps",   label: "MVPs",      get: c => c.mvps,            tgt: t => t.mvps,    decimals: 0, weight: 3, phrase: "the MVPs" },
  { key: "allNBA", label: "All-NBA",   get: c => c.allNBAs,         tgt: t => t.allNBA,  decimals: 0, weight: 3, phrase: "the All-NBA nods" },
  { key: "roty",   label: "ROTY",      get: c => c.roty || 0,       tgt: t => t.roty,    decimals: 0, weight: 1, phrase: "Rookie of the Year" },
  { key: "dpoy",   label: "DPOY",      get: c => c.dpoys || 0,      tgt: t => t.dpoys,   decimals: 0, weight: 1, phrase: "Defensive Player of the Year" },
  { key: "ppg",    label: "Peak PPG",  get: c => c.bestSeason.ppg,  tgt: t => t.peakPPG, decimals: 1, weight: 1, phrase: "peak scoring" },
  { key: "apg",    label: "Peak APG",  get: c => c.bestSeason.apg,  tgt: t => t.peakAPG, decimals: 1, weight: 1, phrase: "peak playmaking" },
  { key: "rpg",    label: "Peak RPG",  get: c => c.bestSeason.rpg,  tgt: t => t.peakRPG, decimals: 1, weight: 1, phrase: "peak rebounding" },
  // Career totals — secondary volume metrics. `big` = format with thousands
  // separators; `era` = zeroed for pre-tracking legends (see preTracking below).
  { key: "pts",    label: "Points",    get: c => c.totals.pts,      tgt: t => t.totalPTS, decimals: 0, weight: 1, big: true, phrase: "the scoring volume" },
  { key: "ast",    label: "Assists",   get: c => c.totals.ast,      tgt: t => t.totalAST, decimals: 0, weight: 1, big: true, phrase: "the assist total" },
  { key: "reb",    label: "Rebounds",  get: c => c.totals.reb,      tgt: t => t.totalREB, decimals: 0, weight: 1, big: true, phrase: "the rebounding total" },
  { key: "blk",    label: "Blocks",    get: c => c.totals.blk,      tgt: t => t.totalBLK, decimals: 0, weight: 1, big: true, era: true, phrase: "the block total" },
  { key: "tpm",    label: "3PM",       get: c => c.totals.threes,   tgt: t => t.total3PM, decimals: 0, weight: 1, big: true, era: true, phrase: "the threes made" },
  { key: "stl",    label: "Steals",    get: c => c.totals.stl,      tgt: t => t.totalSTL, decimals: 0, weight: 1, big: true, era: true, phrase: "the steal total" },
];
// The résumé pillars that gate a true "dethroning": you must match ALL THREE.
const SHADOW_PILLARS = ["rings", "mvps", "allNBA"];
// Prose enumeration skips awards (they get their own aside) AND the career
// volume totals — the narrative is about pillars + peak greatness, not who piled
// up more counting stats; the totals still show in the grid and count toward
// beatCount. `era`-flagged metrics are the ones blanked for pre-tracking legends.
const SHADOW_PROSE_SKIP = new Set(["roty", "dpoy", "pts", "ast", "reb", "blk", "tpm", "stl"]);

// { targetName, targetLabel, target, rows, beatCount, total, weightedBeat,
//   weightedTotal, resumeCleared, majority }
function compareToShadow(career) {
  const targetName = state.shadowTarget;
  const target = SHADOW_TARGETS[targetName];
  if (!target) return null;
  const rows = SHADOW_METRICS.map(m => {
    const build = m.get(career);
    const tv = m.tgt(target);
    // Russell/Wilt (preTracking) never had blocks/steals/3PM tracked — their 0
    // there is historical, not a real mark. Such a row is "untracked": it does
    // not count as a beat and is excluded from the scoring, and the UI tags it
    // rather than showing a hollow ✓ for clearing a zero.
    const untracked = !!target.preTracking && !!m.era && tv === 0;
    return {
      key: m.key, label: m.label, phrase: m.phrase, decimals: m.decimals,
      weight: m.weight, big: !!m.big, build, target: tv,
      beat: !untracked && build >= tv, untracked,
    };
  });
  const scored = rows.filter(r => !r.untracked); // untracked rows are out of the tally
  const beatCount = scored.filter(r => r.beat).length;
  const weightedBeat = scored.filter(r => r.beat).reduce((s, r) => s + r.weight, 0);
  const weightedTotal = scored.reduce((s, r) => s + r.weight, 0);
  // The prestige gate: all three résumé pillars (rings, MVPs, All-NBA) beaten.
  const resumeCleared = SHADOW_PILLARS.every(k => rows.find(r => r.key === k).beat);
  return {
    targetName, targetLabel: target.label, target, rows, beatCount, total: scored.length,
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
  const short = cmp.rows.filter(r => !r.beat && !r.untracked);
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
  const beatP = beat.filter(r => !SHADOW_PROSE_SKIP.has(r.key));
  const shortP = short.filter(r => !SHADOW_PROSE_SKIP.has(r.key));

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

// ===== PLAYER-NAME FILTER =====
// A small hardcoded list rather than an npm dependency on purpose: the game ships
// as three plain <script> tags with no build step and no package.json (see
// CLAUDE.md), so a filter library would have to be vendored as a UMD bundle for no
// real gain over the list below.
//
// Matching is TOKEN-BASED and never substring, because substring matching is what
// produces the classic false positives — this game's own rosters contain "Sam
// Cassell", and "assassin", "class", "bass", "Scunthorpe" and "Cockburn" all
// embed blocked strings. A token counts as a hit when it EQUALS a blocked word or
// is that word plus at most 3 trailing characters, so "fucking" and "bitches" are
// caught while "assassin" (5 extra chars) and "classic" are not. Compounds that
// don't share a prefix with their root ("dumbass") are listed explicitly.
//
// Scope is deliberately modest per the brief: obvious/common cases only. It does
// not chase spacing tricks or exotic homoglyphs, though a light leet map catches
// the everyday "sh1t"/"a55" substitutions.
//
// TWO lists, because one rule can't serve both. Long unambiguous roots are safe to
// match with a short suffix ("fuck" -> "fucking"); short or name-like roots are
// matched EXACTLY, since suffixing them produced real false positives caught in
// testing: "tit"+an = Titan, "cock"+ing = the surname Cocking, "spic"+y = Spicy,
// "nazi"+r = the given name Nazir.
const NAME_BLOCK_STEM = [
  // profanity with unambiguous roots — "+ s/ed/ing/er" stays profane
  "fuck", "fuk", "fck", "shit", "shite", "bitch", "bastard", "cunt", "twat",
  "wank", "prick", "bollock", "arsehole", "asshole", "dumbass", "jackass",
  "dickhead", "shithead", "fuckface", "motherfucker", "bullshit", "piss",
  "goddamn", "damnit",
  // sexual / explicit
  "penis", "vagina", "pussy", "boob", "titty", "nutsack", "ballsack", "jizz",
  "handjob", "blowjob", "whore", "slut", "hooker", "porn", "hentai",
  "rape", "rapist", "molest", "pedophile", "paedo",
  // slurs
  "nigger", "nigga", "faggot", "dyke", "tranny", "shemale",
  "wetback", "beaner", "raghead", "towelhead", "sandnigger", "jigaboo",
  "zipperhead", "retard", "spastic", "mongoloid", "cripple",
  // hate / extremist
  "hitler", "klansman", "genocide", "holocaust", "terrorist",
  // scatological
  "douche", "skank",
];
// Matched only as a whole token. Short, or plausible as part of a real name.
const NAME_BLOCK_EXACT = [
  "ass", "tit", "tits", "cock", "cocks", "dick", "hoe", "hoes", "fag", "fags",
  "crap", "cum", "anus", "rectum", "turd", "milf", "porno",
  "coon", "jap", "abo", "coolie", "chink", "gook", "spic", "paki",
  "kike", "heeb", "yid", "hymie", "muzzie",
  "cracker", "honky", "whitey", "gringo",
  "nazi", "nazis", "heil", "kkk", "pedo",
];
// Multi-word entries, checked against the re-joined token string.
const NAME_BLOCK_PHRASES = ["curry muncher"];
// Deliberately NOT blocked, after testing against real names:
//   "negro"  — Vinny Del Negro is a real player in TEAM_ROSTERS
//   "lynch"  — a common surname (George Lynch, Kevin Lynch played in the NBA)
//   "haji"   — a legitimate given name and honorific
//   "isis"   — a legitimate given name
//   "queer"  — widely reclaimed as an identity term
//   "spade", "slant", "greaser" — weak slurs with real-surname collisions
// Everyday character swaps only — enough for "sh1t"/"a55", not a homoglyph engine.
const NAME_LEET_MAP = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i" };

// Lowercase, undo the light leet swaps, then split on anything that isn't a
// letter — so punctuation, digits and spacing all act as token separators.
function nameTokens(raw) {
  const norm = String(raw || "").toLowerCase()
    .replace(/[0134578@$!]/g, ch => NAME_LEET_MAP[ch] || ch);
  return norm.split(/[^a-z]+/).filter(Boolean);
}

function isNameBlocked(raw) {
  const tokens = nameTokens(raw);
  if (!tokens.length) return false;               // empty -> caller's placeholder
  const joined = tokens.join(" ");
  if (NAME_BLOCK_PHRASES.some(p => joined.includes(p))) return true;
  return tokens.some(t =>
    NAME_BLOCK_EXACT.includes(t) ||
    NAME_BLOCK_STEM.some(w => t === w || (t.startsWith(w) && t.length - w.length <= 3)));
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
// New fields are backfilled for existing saves by the Object.assign in
// loadAllProgress(), so adding an accumulator here needs no version bump.
function blankProgress() {
  return {
    careersPlayed: 0,
    bestScore: 0,
    bestTierIdx: -1,       // index into TIERS; -1 = no career yet
    totalRings: 0, totalMVPs: 0, totalDPOYs: 0, totalROTYs: 0,
    totalAllStars: 0, totalAllNBAs: 0,
    activatedBadges: [],   // unique "Player|Category" keys ever activated
    dethronedTargets: [],  // shadow target names ever dethroned (majority cleared)
    positionsPlayed: [],   // unique position keys ever taken to a verdict
    teamsPlayed: [],       // unique career-team abbrs ever taken to a verdict
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
  // Description is built from SHADOW_ORDER so it can't drift when legends are added.
  { id: "dethrone_all",name: "Cast Your Own Shadow", desc: `Dethrone all ${SHADOW_ORDER.length} shadow legends across your careers.`, check: (r, L) => L.dethronedTargets.length >= SHADOW_ORDER.length },
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

  // ===== EXPANSION =====
  // Every entry below follows the same contract as the originals: check(run,
  // lifetime) against facts the run fact-sheet already carries, sticky once
  // earned, and stored per mode (unlock state lives in modes[mode].unlocked), so
  // the Salary Cap / Classic split applies to these automatically. Sandbox never
  // reaches recordCareerRun, so it is excluded here as everywhere else.

  // ---- Shadow-chasing granularity ----
  { id: "dethrone_first", name: "Prodigy",         desc: "Dethrone a legend on your very first career in this mode.", check: (r, L) => !!r.dethroned && L.careersPlayed === 1 },
  { id: "dethrone_3",   name: "Shadow Hunter",     desc: "Dethrone 3 different shadow legends.",               check: (r, L) => L.dethronedTargets.length >= 3 },
  { id: "dethrone_8",   name: "Halfway to Immortal", desc: "Dethrone 8 different shadow legends.",             check: (r, L) => L.dethronedTargets.length >= 8 },
  { id: "dethrone_clean", name: "No Contest",      desc: "Dethrone a legend while reaching the Legend tier or higher.", check: (r) => !!r.dethroned && r.tierIdx >= TIERS.findIndex(t => t.name === "Legend") },

  // ---- Mode-specific: Classic (no cap, spin-driven) ----
  { id: "classic_rough",  name: "Diamond in the Rough", desc: "Classic: reach Superstar or higher with a base OVR under 70.", check: (r) => r.mode === "classic" && r.baseOVR < 70 && r.tierIdx >= TIERS.findIndex(t => t.name === "Superstar") },
  { id: "classic_legend", name: "Wheel of Fortune",     desc: "Classic: reach the Legend tier — no-repeat teams and all.", check: (r) => r.mode === "classic" && r.tierIdx >= TIERS.findIndex(t => t.name === "Legend") },
  { id: "classic_purist", name: "Purist",               desc: "Classic: finish a build without using a single re-spin.", check: (r) => r.mode === "classic" && r.rerollsUsed === 0 },
  { id: "classic_trio",   name: "Triple Threat",        desc: "Classic: take all three trait badge slots into one career.", check: (r) => r.mode === "classic" && r.activeBadgeCount >= 3 },

  // ---- Mode-specific: Salary Cap Edition ----
  { id: "cap_thrifty", name: "Cap Wizard",         desc: "Salary Cap: reach Superstar or higher spending under $80M.", check: (r) => r.mode === "cap" && r.budgetSpent < 8000 && r.tierIdx >= TIERS.findIndex(t => t.name === "Superstar") },
  { id: "cap_bargain", name: "Bargain Bin Legend", desc: "Salary Cap: reach Legend or higher spending under $85M.", check: (r) => r.mode === "cap" && r.budgetSpent < 8500 && r.tierIdx >= TIERS.findIndex(t => t.name === "Legend") },
  { id: "cap_minimum", name: "Minimum Deal",       desc: "Salary Cap: reach All-Star or higher spending under $60M.", check: (r) => r.mode === "cap" && r.budgetSpent < 6000 && r.tierIdx >= TIERS.findIndex(t => t.name === "All-Star") },

  // ---- Badge combinations ----
  { id: "badge_same_team", name: "Franchise Chemistry", desc: "Activate badges from two players who really shared a franchise.", check: (r) => r.badgeSameTeam },
  { id: "badge_defense",   name: "Lockdown Duo",        desc: "Activate two Defense trait badges in one build.",     check: (r) => r.badgeDefensivePair },
  { id: "badge_offense",   name: "Bucket Brigade",      desc: "Activate two Shooting or Finishing badges in one build.", check: (r) => r.badgeScoringPair },
  { id: "life_badges_50",  name: "Badge Baron",         desc: "Activate 50 different trait badges across all careers.", check: (r, L) => L.activatedBadges.length >= 50 },

  // ---- Completionist ----
  { id: "all_positions", name: "Positional Chameleon", desc: "Take a career to the verdict at all five positions.", check: (r, L) => L.positionsPlayed.length >= Object.keys(POSITIONS).length },
  { id: "teams_10",      name: "Well Travelled",       desc: "Play career teams for 10 different franchises.",      check: (r, L) => L.teamsPlayed.length >= 10 },
  { id: "all_teams",     name: "League Tour",          desc: "Play a career with all 30 franchises.",               check: (r, L) => L.teamsPlayed.length >= 30 },

  // ---- Flavor / extreme builds ----
  { id: "bust_ring",   name: "Right Place, Right Time", desc: "Win a ring with a Draft Bust build.",                check: (r) => r.tierName === "Draft Bust" && r.rings >= 1 },
  { id: "tall_tale",   name: "Tallest Tale",         desc: "Reach Superstar or higher with a 7'4\" or taller build.", check: (r) => r.heightRating >= 99 && r.tierIdx >= TIERS.findIndex(t => t.name === "Superstar") },
  { id: "small_ball",  name: "Giant Slayer",         desc: "Reach Superstar or higher with a build 5'11\" or shorter.", check: (r) => r.heightRating <= 28 && r.tierIdx >= TIERS.findIndex(t => t.name === "Superstar") },
  { id: "ringless",    name: "The Ringless Great",   desc: "Reach the Legend tier without ever winning a ring.",   check: (r) => r.rings === 0 && r.tierIdx >= TIERS.findIndex(t => t.name === "Legend") },
  { id: "iron_man",    name: "Iron Man",             desc: "Play a full 20-season career.",                        check: (r) => r.numSeasons >= 20 },
  { id: "perfect_fit", name: "Perfect Fit",          desc: "Finish a career fitting your position AND your team's need.", check: (r) => r.positionFit && r.teamNeedMet },

  // ---- Career milestones ----
  { id: "stat_stuffer", name: "Stat Sheet Stuffer", desc: "Post a season averaging 25 points, 10 boards and 5 assists.", check: (r) => r.peakPPG >= 25 && r.peakRPG >= 10 && r.peakAPG >= 5 },
  { id: "triple_dbl",   name: "Averaged a Triple-Double", desc: "Post a season averaging 10+ boards and 10+ assists.", check: (r) => r.peakRPG >= 10 && r.peakAPG >= 10 },
  { id: "def_dynasty",  name: "Defensive Dynasty",  desc: "Win 3 or more DPOYs in one career.",                    check: (r) => r.dpoys >= 3 },
  { id: "rise_rise",    name: "Rise and Rise",      desc: "Win Rookie of the Year and an MVP in the same career.",  check: (r) => r.rotys >= 1 && r.mvps >= 1 },
  { id: "allstar_15",   name: "Perennial",          desc: "Make 15 All-Star teams in one career.",                 check: (r) => r.allStars >= 15 },

  // ---- Lifetime cumulative ----
  { id: "careers_50",   name: "Lifer",              desc: "Play 50 careers.",                                      check: (r, L) => L.careersPlayed >= 50 },
  { id: "life_dpoys",   name: "Defensive Legacy",   desc: "Win 10 DPOYs across all your careers.",                 check: (r, L) => L.totalDPOYs >= 10 },
  { id: "life_allnba",  name: "All-NBA Fixture",    desc: "Collect 50 All-NBA selections across all careers.",      check: (r, L) => L.totalAllNBAs >= 50 },

  // ---- One per shadow legend ----
  // Generated from SHADOW_ORDER so the set can never drift from the legend roster
  // when a target is added or renamed — same reasoning as dethrone_all's desc.
  ...SHADOW_ORDER.map(legend => ({
    id: "dethrone_" + legend.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    name: `Dethroned ${legend}`,
    desc: `Dethrone ${legend} in a career.`,
    check: (r) => r.dethroned === legend,
  })),
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
  p.totalAllStars += run.allStars || 0;
  p.totalAllNBAs += run.allNBAs || 0;
  for (const key of run.activatedBadgeKeys) {
    if (!p.activatedBadges.includes(key)) p.activatedBadges.push(key);
  }
  if (run.dethroned && !p.dethronedTargets.includes(run.dethroned)) {
    p.dethronedTargets.push(run.dethroned);
  }
  if (run.position && !p.positionsPlayed.includes(run.position)) p.positionsPlayed.push(run.position);
  if (run.teamAbbr && !p.teamsPlayed.includes(run.teamAbbr)) p.teamsPlayed.push(run.teamAbbr);

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
    state, STEPS, SKILL_ORDER, CATEGORIES, TIERS, wheelCost, fmtSalary, capPct, budgetRemaining, uncappedMode, inputCeiling, baseOVRDisplay, categoryRating, getRosterOptions,
    seedRng, currentPick, replacePick, getAllRosterOptions, usedPickNames, usedTeamAbbrs, availableTeams, spinnablePlayers, buildStatPick, physicalBandLabel, lockSkill, lockPhysical, applyModifiers, finalSkills, computeOVR, projectedOVR, scaleOVR,
    unlockPick, backTargetStep, badgeChoiceIsPending, acquiredBadges,
    checkPositionFit, teamNeedPosition, simSeason, simCareer,
    awardReasons, offensiveCase, allStarCase, rotyCase, dpoyOdds, mvpOdds, dpoyDominance,
    MVP_OVR_GATE, MVP_WIN_GATE, FINALS_MVP_OVR, ALLDEF_1ST, ALLDEF_2ND,
    ALLNBA_1ST_SCORE, ALLNBA_2ND_SCORE, ALLNBA_Q_FLOOR, ALLSTAR_Q_FLOOR, ROTY_PPG,
    hasStartingFive, teamFive, teamRatingFromFive, weakestSlot, starterAt, projectedRatingWith, effectiveScr,
    SCR_BASE, FIVE_ANCHOR, SCR_SLOPE, TEAMS_BY_ABBR, allStarSelection, rotyRoll, generateSeasonStats, tierForScore, tierForCareer, percentileForScore,
    computeBadges, BADGE_INFO, generateHeadline, generateScoutingReport, careerHighlights, playstyleComp, closestComp, topComps, buildProfile, topAttribute, signatureAttribute, BUDGET_CAP, TEAM_REROLLS, GAMES_PER_SEASON,
    compDistance, accompDistance, accompOf, compCaliber, archetypePenalty, signatureOfDims, tierRank,
    CALIBER_MATCH_WEIGHT, ACCOMP_MATCH_WEIGHT, ARCHETYPE_MATCH_WEIGHT,
    compareToShadow, generateShadowVerdict, SHADOW_METRICS, SHADOW_PILLARS, isDethroned, tierIsLegendPlus,
    TRAIT_BADGES, acquiredBadges, activeBadgeMods, activeBadgeList,
    TIER_AWARD_FLOORS, TIER_ALT_PATHS, hasAltPath, altPathWaivesMvp, meetsAwardFloor, meetsTierFloors, clampTierToPeak, highestTierIndexForPeak, TIER_OVR_FLOORS, isHallOfFame,
    isNameBlocked, nameTokens, PROGRESS_KEY, LEGACY_BEST_KEY, blankProgress, loadProgress, saveProgress, recordCareerRun, ACHIEVEMENTS,
    MODE_KEYS, MODE_LABELS, DEFAULT_MODE, loadAllProgress, saveAllProgress,
  };
}
