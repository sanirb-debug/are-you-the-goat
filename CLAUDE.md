# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Are You the GOAT?" — a browser game: build a Frankenstein NBA player from
different franchises' legends, spin for a career team, simulate 15–20 seasons,
and get a GOAT-tier verdict. Plain HTML/CSS/JS. No build step, no dependencies,
no framework, no test runner.

## Running and deploying

- Run locally: `python3 -m http.server 8000` from the repo root (or open
  index.html directly in a browser).
- No lint or build. Sanity-test game logic with Node by concatenating
  data.js + game.js and appending assertions (both files have
  `module.exports` guards for exactly this):
  `cat data.js game.js my-assertions.js > /tmp/t.js && node /tmp/t.js`
- `node --check <file>` for quick syntax validation.
- Deploy = push to `main`. GitHub Pages auto-redeploys
  https://sanirb-debug.github.io/are-you-the-goat/ within a minute or two.
  After pushing, confirm the deploy actually succeeded (the deploy step can
  fail transiently): check `pages/builds/latest` via the GitHub API, or curl
  the live file and grep for the new code.
- Pages serves with `cache-control: max-age=600`, so browsers hold stale JS.
  index.html references css/js with `?v=N` query strings — **bump N on every
  deploy that changes css/js** so returning players get fresh files.

## Files and load order

index.html loads three scripts as plain `<script>` tags sharing one global
scope. Order matters — later files reference earlier files' globals:

1. `data.js` — TEAM_ROSTERS, TEAMS, POSITIONS, BUDGET_BIN
2. `game.js` — state, STEPS, all formulas, and the career sim
3. `ui.js` — render() dispatcher + one render function per step

`style.css` is a dark navy/gold theme driven by CSS variables in `:root`.

## Core loop (STEPS array in game.js)

name → height → frame → Shooting → Finishing → Playmaking → Handles →
Defense → Rebounding → careerTeam → position → verdict

- Each of the 8 attribute picks starts with a **scout spin**: spin for a
  random franchise, then pick any player from that team's roster, sorted
  best-to-worst for the current category. The first spin of each pick is
  free; "Spin Again" draws from a pool of 3 rerolls shared across the whole
  build (`state.teamRerollsUsed` vs `TEAM_REROLLS`).
- **careerTeam** is separate from the scouting spins: spun once (unlimited
  respins), and it alone drives the season sim (wins via `team.scr`), the
  verdict headline, and the career-wins line. Don't let scouting spins touch
  `state.team`.
- **position**: clicking a position runs `computeOVR()` + `simCareer()`
  immediately and advances to the verdict.
- Budget: 100 points (`BUDGET_CAP`) shared across all 7 picks. Cost formula:
  `wheelCost(rating) = Math.round(rating * rating / 500)` — quadratic on
  purpose (99→20, 75→11, 45→4) so stacking elites everywhere is impossible.
- Top tiers also require a peak-OVR floor (`TIER_OVR_FLOORS`: GOAT 95,
  Legend 90, Superstar 85) via `tierForCareer(score, peakOVR)` — longevity
  alone can't reach GOAT. Balance target, verified by greedy simulation
  (`node sim-difficulty.js [runs]`, covers both tracked modes): greedy play
  gets 0% GOAT and mostly Superstar/Legend; a deliberately top-heavy build
  reaches GOAT ~1-2%.
  Re-run that simulation after touching wheelCost, TIERS, or the floors.
- **Two OVR axes.** The sim, award gates and `generateSeasonStats` all run on
  the RAW axis; what the player sees is `scaleOVR`'d. `scaleOVR` expands
  25..83 onto 25..99 **only under the salary cap**, where 83 is the solved
  achievable ceiling. The no-cap modes (Classic, Sandbox — see
  `uncappedMode()`) reach raw 94 on their own, so they report raw as-is;
  expanding there displayed a raw 81 build as 96. `computeOVR`/`projectedOVR`/
  `baseOVRDisplay` are additionally bounded by `inputCeiling()` — the best
  rating actually PICKED — so an overall can never exceed every number on the
  player's own card (a weighted average can't exceed its inputs, and the +3
  position-fit bonus must not smuggle it past).
- No two players on the same team share a rating in Frame or any of the 5
  skills (costs may still tie after rounding; the UI shows the rating to
  disambiguate). Height is the exception: it is deterministic — the same
  listed height always maps to the same rating (see the height table in git
  history's heightfix script), and ties there are expected. Keep both
  invariants when adding roster players.
- Unaffordable roster rows render greyed-out but stay visible. If no skill
  row is affordable, BUDGET_BIN generics are appended with cost clamped to
  the remaining budget so the game can never soft-lock.

## state object shape (game.js)

- `state.height` / `state.frame` — `{ name, era, label, rating, cost, team }`
- `state.skills[skillName]` — same shape with `label: null`
- `state.team` — career team (one of TEAMS); drives the sim
- `state.scoutTeam` — current pick's scouting team; reset to null after each lock
- `state.editingCategory` — non-null while revising a pick from the sidebar
- `state.budgetSpent`, `state.teamRerollsUsed`, `state.position`,
  `state.positionFit`, `state.currentStep` (index into STEPS)

Locked picks store the team they were scouted from (`team`) so the sidebar
edit flow can re-open the same roster without a new spin.

## TEAM_ROSTERS structure (data.js)

Authored as compact arrays in `TEAM_ROSTER_ROWS`, hydrated at load by
`hydrateRosterRow`:

```
[name, era, heightLabel, heightRating, frameLabel, frameRating,
 Shooting, Finishing, Playmaking, Handles, Defense, Rebounding]
```

hydrates to `{ name, era, height: {label, rating}, frame: {label, rating},
skills: {Shooting, ...} }`.

- All 30 teams (keyed by TEAMS abbr), 16–17 players each with a long tail of
  mid-tier/role players, eras '60s → Modern. Ratings are fictional flavor
  values — plausibility over accuracy.
- Height labels map to ratings on a fixed scale (5'3"=15, 6'2"=40, 6'9"=68,
  7'1"=90, 7'4"=99); frame labels: Slight 30, Lean 45, Athletic 60,
  Strong 72, Bulky 80, Powerful 92. Reuse these values when adding players.
- The same player may appear on multiple teams they actually played for.

## Sim internals worth knowing

- Skills are the 6 in SKILL_ORDER (Shooting, Finishing, Playmaking, Handles,
  Defense, Rebounding); OVR weights (computeOVR): .16/.16/.14/.12/.18/.14 +
  height .05 + frame .05 = 1.00. Handles is size-driven and distinct from
  Playmaking. Adding/removing a category = edit SKILL_ORDER + the row format;
  most UI/share/verdict code derives from CATEGORIES.length.
- `applyModifiers()` nudges the 6 skills by height/frame extremes before OVR;
  raw pick ratings stay in state, modified values exist only via
  `finalSkills()`.
- `simCareer()`: 15–20 planned seasons; a 5% per-season injury roll can end
  the career early (`career.injuryEnded` / `injuryYear` — the injury season
  still counts, nothing earlier is erased). Per-season box scores come from
  `generateSeasonStats()` and accumulate into `career.totals` and
  `career.bestSeason` (82 games/season assumed).
- Verdict tier comes from `goatScore` against the TIERS ladder; personal best
  is stored in localStorage under `aytg_best_score`.

## UI conventions (ui.js)

- Full re-render on every interaction: `render()` clears `#app` and
  dispatches on `STEPS[state.currentStep]`. There is no partial-update
  system. Module-level `career` and `picksDrawerOpen` survive re-renders;
  all other cross-step data belongs in `state`.
- The picks sidebar (`renderPicksPanel`) renders only while
  `inPickingPhase()` (height → Rebounding); from careerTeam onward, picks are
  final. Clicking a locked row sets `state.editingCategory`, which `render()`
  intercepts before normal step dispatch. Swaps go through `replacePick()`
  (refund old cost, charge new); affordability during an edit includes the
  refund headroom (third arg of `getRosterOptions`).
- Layout: fixed sidebar ≥1240px, collapsible drawer below that; the rest of
  the app's mobile breakpoint is 480px in style.css.

## Gotchas

- README.md and docs/design-doc.pdf describe an older version of the loop
  (blind wheel spins, different step order, 8–18 season careers) — trust the
  code, not the docs.
- The git remote URL embeds a GitHub access token (token-in-URL auth). Never
  print it; pipe git output through
  `sed 's#ghp_[A-Za-z0-9]*#[token]#g'` when showing remotes or push results.
