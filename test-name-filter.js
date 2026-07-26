#!/usr/bin/env node
// Name-filter checks. Run: node test-name-filter.js
// The important half is the FALSE-POSITIVE sweep: the filter runs against every
// real player name in the dataset, because substring-style filtering would flag
// "Sam Cassell", "Vinny Del Negro" and friends.
const fs = require("fs"), path = require("path"), vm = require("vm");
const DIR = __dirname;
const src = fs.readFileSync(path.join(DIR, "data.js"), "utf8")
  + '\n;globalThis.__D__ = module.exports; module.exports = {};\n'
  + fs.readFileSync(path.join(DIR, "game.js"), "utf8")
  + '\n;globalThis.__G__ = module.exports;\n';
const store = {};
const ctx = { console, module: { exports: {} }, localStorage: {
  getItem: k => (k in store ? store[k] : null), setItem: () => {}, removeItem: () => {} } };
vm.createContext(ctx); vm.runInContext(src, ctx);
const G = Object.assign({}, ctx.__D__, ctx.__G__);

let fails = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fails++; };

console.log("=== MUST BLOCK ===");
["fuck", "Fuck You", "shit head", "BITCH", "Big Dick Energy", "a55hole", "sh1t",
 "Nazi Guy", "retard", "F4GGOT", "dumbass", "MotherFucker", "pussy", "whore man",
 "n1gger", "kkk", "Ass", "curry muncher"].forEach(n => ok(G.isNameBlocked(n), `blocked: "${n}"`));

console.log("\n=== MUST PASS (normal names + known false-positive traps) ===");
["Zayde Storm", "Sam Cassell", "Michael Jordan", "Scunthorpe United", "Classic Kid",
 "Cassius Clay", "Assassin", "Big Class", "Bass Player", "Anthony Cocking",
 "Vinny Del Negro", "George Lynch", "Nazir Khan", "Spicy Pete", "Terry Cummings",
 "Dickerson Blue", "Titan", "Hancock", "Bassett", "Assante", "Cocoa Kid",
 "Grass Man", "Analytics Nerd", "The Mystery Player", "A1 Baller", "Shuttlesworth"
].forEach(n => ok(!G.isNameBlocked(n), `allowed: "${n}"`));

console.log("\n=== FALSE-POSITIVE SWEEP over the real dataset ===");
const seen = new Set();
for (const rows of Object.values(G.TEAM_ROSTERS)) rows.forEach(p => seen.add(p.name));
const rosterHits = [...seen].filter(G.isNameBlocked);
ok(rosterHits.length === 0, `${seen.size} real player names, none blocked${rosterHits.length ? " -> " + rosterHits.join(", ") : ""}`);
const compHits = G.COMP_PLAYERS.map(p => p.name).filter(G.isNameBlocked);
ok(compHits.length === 0, `${G.COMP_PLAYERS.length} comp players, none blocked${compHits.length ? " -> " + compHits.join(", ") : ""}`);
const legendHits = G.SHADOW_ORDER.filter(G.isNameBlocked);
ok(legendHits.length === 0, `${G.SHADOW_ORDER.length} shadow legends, none blocked`);
const teamHits = G.TEAMS.map(t => t.name).filter(G.isNameBlocked);
ok(teamHits.length === 0, `${G.TEAMS.length} team names, none blocked`);

console.log("\n=== EDGE CASES ===");
ok(!G.isNameBlocked(""), "empty string not blocked (caller substitutes a placeholder)");
ok(!G.isNameBlocked("   "), "whitespace-only not blocked");
ok(G.isNameBlocked("  FUCK  "), "surrounding whitespace still blocked");
ok(!G.isNameBlocked(null) && !G.isNameBlocked(undefined), "null/undefined safe");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
