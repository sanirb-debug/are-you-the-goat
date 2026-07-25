#!/usr/bin/env node
/*
 * measure-positions.js — positional composition of TEAM_ROSTERS.
 *
 * Position isn't a tracked field; the game itself gates position purely on the
 * height RATING (see checkPositionFit + POSITIONS). So we classify each player by
 * height rating into a single canonical slot using the nearest-center of the five
 * overlapping POSITIONS ranges:
 *   PG center 32.5 | SG 50 | SF 65 | PF 77.5 | C 89.5
 *   -> boundaries PG<=41, SG 42-57, SF 58-71, PF 72-83, C>=84
 * Guards (PG+SG) are height<=57 — unambiguous, no real 6'6"+ player is a guard.
 *
 * Reports overall counts/percentages, a guards-vs-wings-vs-bigs split, and the
 * per-team guard count so the worst-imbalanced franchises are visible.
 */
const path = require("path");
const D = require(path.join(__dirname, "data.js"));
const ROSTERS = D.TEAM_ROSTERS;

function classify(rating) {
  if (rating <= 41) return "PG";
  if (rating <= 57) return "SG";
  if (rating <= 71) return "SF";
  if (rating <= 83) return "PF";
  return "C";
}

const order = ["PG", "SG", "SF", "PF", "C"];
const totals = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
const perTeamGuards = {};
let n = 0;

for (const [abbr, players] of Object.entries(ROSTERS)) {
  let guards = 0;
  for (const p of players) {
    const pos = classify(p.height.rating);
    totals[pos]++; n++;
    if (pos === "PG" || pos === "SG") guards++;
  }
  perTeamGuards[abbr] = { guards, size: players.length };
}

console.log(`\n=== TEAM_ROSTERS positional composition (${n} players, ${Object.keys(ROSTERS).length} teams) ===\n`);
console.log("  pos   count   pct");
for (const pos of order) {
  const c = totals[pos];
  console.log(`  ${pos.padEnd(4)} ${String(c).padStart(5)}   ${(c / n * 100).toFixed(1).padStart(5)}%`);
}
const guards = totals.PG + totals.SG;
const wings = totals.SF;
const bigs = totals.PF + totals.C;
console.log("\n  --- aggregate ---");
console.log(`  Guards (PG+SG)   ${String(guards).padStart(4)}   ${(guards / n * 100).toFixed(1)}%`);
console.log(`  Wings  (SF)      ${String(wings).padStart(4)}   ${(wings / n * 100).toFixed(1)}%`);
console.log(`  Bigs   (PF+C)    ${String(bigs).padStart(4)}   ${(bigs / n * 100).toFixed(1)}%`);
console.log(`  Guards : Bigs ratio = ${(guards / bigs).toFixed(2)} : 1`);
console.log(`  Avg guards per team = ${(guards / Object.keys(ROSTERS).length).toFixed(2)}`);

console.log("\n  --- guards per team (sorted fewest first) ---");
const rows = Object.entries(perTeamGuards).sort((a, b) => a[1].guards - b[1].guards || a[0].localeCompare(b[0]));
console.log("  " + rows.map(([abbr, v]) => `${abbr}:${v.guards}`).join("  "));
