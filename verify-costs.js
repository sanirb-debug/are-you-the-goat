#!/usr/bin/env node
// verify-costs.js — cost-curve integrity gate. Run: node verify-costs.js
//
// The pre-commit hook (hooks/pre-commit, installed at .git/hooks/pre-commit)
// runs this automatically on every commit that touches data.js or game.js —
// a curve retune cannot be committed without passing it. (A GitHub Actions
// version was attempted but the deploy token lacks `workflow` scope; add
// that scope to the PAT if server-side enforcement is ever wanted.)
// It exists because the duplicate-cost
// bug (different ratings, same price) regressed after multiple difficulty
// tunings: whole-point costs against a 100 cap can never uniquely price the
// ~78 densely-packed ratings in the roster data (pigeonhole), so any curve
// rounded to whole points must tie somewhere. The economy now prices in
// integer tenths of $M (BUDGET_CAP = 1000 tenths = $100M), which has 10x
// the resolution — this script proves, for the CURRENT curve and data:
//   1. no two different ratings in the same team+category share a cost
//      (same rating -> same cost is fine; height ties share ratings by design)
//   2. cost strictly increases with rating across every rating in the data
//   3. every cost is a positive integer number of tenths
//   4. no soft-lock: the cheapest possible 8-pick build fits the cap
// If you retune wheelCost and this fails, fix the curve — do not relax
// these checks.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = vm.createContext({ console, Math, JSON });
for (const f of ["data.js", "game.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), "utf8"), ctx, { filename: f });
}
// top-level consts live in the context's global lexical scope, not on the
// context object — harvest the bindings this script needs with one more eval
const { TEAM_ROSTER_ROWS, BUDGET_BIN, BUDGET_CAP, wheelCost } =
  vm.runInContext("({ TEAM_ROSTER_ROWS, BUDGET_BIN, BUDGET_CAP, wheelCost })", ctx);

const CATS = [["height", 3], ["athleticism", 5], ["Shooting", 6], ["Finishing", 7],
  ["Playmaking", 8], ["Handles", 9], ["Defense", 10], ["Rebounding", 11]];
let failures = 0;
const fail = msg => { failures++; console.error("FAIL: " + msg); };

// 1. per-list uniqueness (including the budget-bin pool, which co-occurs with itself)
let checked = 0;
const lists = Object.entries(TEAM_ROSTER_ROWS).flatMap(([abbr, rows]) =>
  CATS.map(([cat, idx]) => [abbr + " " + cat, rows.map(r => r[idx])]));
lists.push(["BUDGET_BIN", BUDGET_BIN.map(b => b.rating)]);
for (const [where, ratings] of lists) {
  const byCost = new Map();
  for (const rating of ratings) {
    const c = wheelCost(rating);
    if (!byCost.has(c)) byCost.set(c, new Set());
    byCost.get(c).add(rating);
    checked++;
  }
  for (const [c, rs] of byCost) if (rs.size > 1)
    fail(`${where}: ratings [${[...rs].sort((a, b) => a - b)}] all cost ${c}`);
}

// 2 + 3. strict monotonicity and integer tenths across every rating present
const all = new Set(BUDGET_BIN.map(b => b.rating));
for (const rows of Object.values(TEAM_ROSTER_ROWS))
  for (const r of rows) for (const [, idx] of CATS) all.add(r[idx]);
const sorted = [...all].sort((a, b) => a - b);
for (const r of sorted) {
  const c = wheelCost(r);
  if (!Number.isInteger(c) || c <= 0) fail(`rating ${r}: cost ${c} is not a positive integer`);
}
for (let i = 1; i < sorted.length; i++)
  if (wheelCost(sorted[i]) <= wheelCost(sorted[i - 1]))
    fail(`not strictly increasing: ${sorted[i - 1]}->${wheelCost(sorted[i - 1])} vs ${sorted[i]}->${wheelCost(sorted[i])}`);

// 4. soft-lock guard: cheapest pick per category (worst case across teams) must fit the cap
let worstMinTotal = 0;
for (const [, idx] of CATS) {
  let worstMin = 0;
  for (const rows of Object.values(TEAM_ROSTER_ROWS))
    worstMin = Math.max(worstMin, Math.min(...rows.map(r => wheelCost(r[idx]))));
  worstMinTotal += worstMin;
}
if (worstMinTotal > BUDGET_CAP)
  fail(`soft-lock: worst-case cheapest 8-pick build costs ${worstMinTotal} > cap ${BUDGET_CAP}`);

console.log(`verify-costs: ${checked} entries across ${lists.length} lists, ` +
  `${sorted.length} distinct ratings (${sorted[0]}..${sorted[sorted.length - 1]}), ` +
  `worst-case floor build ${worstMinTotal}/${BUDGET_CAP}`);
if (failures) { console.error(`RESULT: FAIL (${failures})`); process.exit(1); }
console.log("RESULT: CLEAN");
