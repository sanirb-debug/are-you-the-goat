// ===== ARE YOU THE GOAT? — UI CONTROLLER =====

const app = document.getElementById("app");
let career = null;
let picksDrawerOpen = false; // mobile drawer toggle, persists across renders
let simRunToken = 0; // invalidates sim-screen timers from earlier runs

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function render() {
  app.innerHTML = "";
  const step = STEPS[state.currentStep];
  app.appendChild(renderTopBar());

  if (inPickingPhase()) app.appendChild(renderPicksPanel());
  if (state.editingCategory) {
    renderEditStep(state.editingCategory);
    return;
  }

  if (step === "name") renderNameStep();
  else if (step === "height") renderRosterStep("height", "Height", "How tall are they?", pick => lockPhysical("height", pick));
  else if (step === "frame") renderRosterStep("frame", "Body Frame", "What's their build?", pick => lockPhysical("frame", pick));
  else if (SKILL_ORDER.includes(step)) renderRosterStep(step, step, "Pick a legend to build on.", pick => lockSkill(step, pick));
  else if (step === "confirm") renderConfirmStep();
  else if (step === "careerTeam") renderCareerTeamStep();
  else if (step === "position") renderPositionStep();
  else if (step === "simulating") renderSimulating();
  else if (step === "verdict") renderVerdict();
}

function renderTopBar() {
  const bar = el("div", "topbar");
  const title = el("div", "brand", "🏀 ARE YOU THE GOAT?");
  bar.appendChild(title);

  const step = STEPS[state.currentStep];
  if (step === "height" || step === "frame" || SKILL_ORDER.includes(step)) {
    const budget = el("div", "budget-pill", budgetPillHTML());
    bar.appendChild(budget);
  }
  return bar;
}

// Picks are editable while choosing attributes and on the confirm screen;
// from the career team step onward they lock in for good (Position depends
// on final Height/Frame).
function inPickingPhase() {
  const step = STEPS[state.currentStep];
  return step === "height" || step === "frame" || step === "confirm" || SKILL_ORDER.includes(step);
}

const CATEGORY_LABELS = { height: "Height", frame: "Frame" };
function categoryLabel(cat) { return CATEGORY_LABELS[cat] || cat; }

// ---- Persistent picks panel ----
// Fixed sidebar on wide screens, collapsible drawer above the card on
// narrow ones. Locked rows are clickable to revise that pick.
function renderPicksPanel() {
  const locked = CATEGORIES.filter(c => currentPick(c)).length;
  const panel = el("aside", "picks-panel" + (picksDrawerOpen ? " open" : ""));

  const toggle = el("button", "picks-title", `YOUR PICKS <span class="picks-count">${locked}/7</span><span class="picks-caret">${picksDrawerOpen ? "▴" : "▾"}</span>`);
  toggle.onclick = () => { picksDrawerOpen = !picksDrawerOpen; render(); };
  panel.appendChild(toggle);

  const body = el("div", "picks-body");
  CATEGORIES.forEach(cat => {
    const pick = currentPick(cat);
    if (pick) {
      const row = el("button", "picks-row" + (state.editingCategory === cat ? " editing" : ""),
        `<span class="picks-cat">${categoryLabel(cat)}</span>
         <span class="picks-player">${pick.name}</span>
         <span class="picks-meta">${pick.team ? pick.team.abbr : "—"} &nbsp;·&nbsp; ${pick.cost} pts</span>`);
      row.onclick = () => {
        state.editingCategory = cat;
        render();
      };
      body.appendChild(row);
    } else {
      body.appendChild(el("div", "picks-row empty",
        `<span class="picks-cat">${categoryLabel(cat)}</span><span class="picks-player">not picked yet</span>`));
    }
  });
  panel.appendChild(body);
  return panel;
}

// ---- Edit a locked pick ----
// Re-opens the same team's roster the pick was scouted from — no new spin.
function renderEditStep(category) {
  const pick = currentPick(category);
  const team = pick.team;

  const wrap = el("div", "card");
  wrap.appendChild(el("h1", "step-title center", `Edit: ${categoryLabel(category)}`));
  wrap.appendChild(el("p", "step-sub center",
    `${team.name} legends &nbsp;·&nbsp; current: ${pick.name} (${pick.cost} pts refunded on swap) &nbsp;·&nbsp; Budget remaining: ${budgetRemaining()} pts`));

  const list = el("div", "roster-list");
  getRosterOptions(category, team, pick.cost).forEach(opt => {
    const isCurrent = opt.name === pick.name && opt.cost === pick.cost;
    const display = opt.label ? `${opt.label} <span class="sub-rating">${opt.rating}</span>` : opt.rating;
    const row = el("button", "roster-row" + (opt.affordable ? "" : " locked") + (isCurrent ? " current" : ""),
      `<span class="roster-name">${opt.name} <span class="era-tag">${opt.era}</span>${isCurrent ? ' <span class="era-tag current-tag">current</span>' : ""}</span>
       <span class="roster-rating">${display}</span>
       <span class="roster-cost">${opt.cost} pts</span>`);
    row.disabled = !opt.affordable;
    row.onclick = () => {
      replacePick(category, opt);
      state.editingCategory = null;
      render();
    };
    list.appendChild(row);
  });
  wrap.appendChild(list);

  const keepBtn = el("button", "btn-secondary", "← Keep Current Pick");
  keepBtn.style.marginTop = "14px";
  keepBtn.onclick = () => {
    state.editingCategory = null;
    render();
  };
  wrap.appendChild(keepBtn);

  app.appendChild(wrap);
}

function fmtBig(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

// Broadcast-style count-up for stat numbers. Elements carry data-count
// (target), optional data-suffix, and data-fmt="big" for k-formatting.
function animateCounts(root) {
  root.querySelectorAll("[data-count]").forEach(elm => {
    const target = parseFloat(elm.dataset.count);
    const suffix = elm.dataset.suffix || "";
    const big = elm.dataset.fmt === "big";
    const render = v => (big ? fmtBig(Math.round(v)) : String(Math.round(v))) + suffix;
    // Hidden tab (or zero target): rAF won't run, so just show the final value.
    if (document.hidden || target === 0) { elm.textContent = render(target); return; }
    const dur = 750;
    const start = performance.now();
    (function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      elm.textContent = render(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
    })(performance.now());
    // Safety net: guarantee the final value even if rAF stalls mid-count.
    setTimeout(() => { elm.textContent = render(target); }, dur + 400);
  });
}

function budgetPillHTML() {
  return `CAP <span class="budget-num">${state.budgetSpent}</span>/${BUDGET_CAP}`;
}

// ---- Step 0: Name ----
function renderNameStep() {
  const wrap = el("div", "card center");
  wrap.appendChild(el("h1", "step-title", "Name Your Player"));
  wrap.appendChild(el("p", "step-sub", "You're about to gamble their whole career on the wheel. Give them a name first."));
  const input = el("input", "name-input");
  input.placeholder = "e.g. Zayde Storm";
  input.maxLength = 24;
  wrap.appendChild(input);
  const btn = el("button", "btn-primary", "Let's Go →");
  btn.onclick = () => {
    state.name = input.value.trim() || "The Mystery Player";
    state.currentStep++;
    render();
  };
  wrap.appendChild(btn);
  app.appendChild(wrap);
  input.focus();
}

// ---- Shared roster picker (Height, Frame, and all 5 skills) ----
// Each pick gets its own independent team spin. Spinning reveals the team's
// FULL roster for the category right away — sorted best to worst, clickable
// to lock in. "Spin Again" (3 shared rerolls per build) sits above the list.
function renderRosterStep(category, title, sub, onLock) {
  const team = state.scoutTeam;
  const rerollsLeft = TEAM_REROLLS - state.teamRerollsUsed;

  const wrap = el("div", "card");
  wrap.appendChild(el("h1", "step-title center", `Pick: ${title}`));
  const teamNote = team
    ? `<span class="scout-team-name">${team.name}</span> legends`
    : "Spin for the franchise you're scouting this pick from.";
  wrap.appendChild(el("p", "step-sub center",
    `${sub} &nbsp;·&nbsp; ${teamNote} &nbsp;·&nbsp; Budget remaining: ${budgetRemaining()} pts`));

  const spinBtn = el("button", "btn-primary",
    !team ? "🎡 Spin for a Team"
      : rerollsLeft > 0 ? `Spin Again (${rerollsLeft} left)`
      : "No Rerolls Left");
  spinBtn.disabled = !!team && rerollsLeft <= 0;
  spinBtn.onclick = () => {
    if (team) {
      if (rerollsLeft <= 0) return;
      state.teamRerollsUsed++; // first spin of each pick is free, respins are not
    }
    state.scoutTeam = pickRandom(TEAMS);
    render();
  };
  wrap.appendChild(spinBtn);

  if (!team) {
    wrap.appendChild(el("div", "spin-result", "?"));
  } else {
    wrap.appendChild(el("div", "scout-header",
      `<div class="scout-badge">${team.abbr}</div>
       <div class="scout-head-text">
         <div class="scout-kicker">● Scouting Report</div>
         <div class="scout-teamname">${team.name}</div>
         <div class="scout-scr">Supporting Cast Rating ${team.scr}</div>
       </div>`));
    const list = el("div", "roster-list");
    getRosterOptions(category).forEach(opt => {
      // Height/Frame show their real-world label plus the individual rating;
      // skills show the rating alone.
      const display = opt.label ? `${opt.label} <span class="sub-rating">${opt.rating}</span>` : opt.rating;
      const row = el("button", "roster-row" + (opt.affordable ? "" : " locked"),
        `<span class="roster-name">${opt.name} <span class="era-tag">${opt.era}</span></span>
         <span class="roster-rating">${display}</span>
         <span class="roster-cost">${opt.cost} pts</span>`);
      row.disabled = !opt.affordable;
      row.onclick = () => {
        onLock(opt);
        state.scoutTeam = null; // next pick spins its own team
        state.currentStep++;
        render();
      };
      list.appendChild(row);
    });
    wrap.appendChild(list);
  }

  app.appendChild(wrap);
}

// ---- Step 9: Position ----
function renderPositionStep() {
  const wrap = el("div", "card center");
  wrap.appendChild(el("h1", "step-title", "Choose a Position"));
  wrap.appendChild(el("p", "step-sub", "Pick to fit your build, or gamble on an anomaly run."));

  const grid = el("div", "position-grid");
  Object.entries(POSITIONS).forEach(([key, pos]) => {
    const fits = checkPositionFit(key);
    const btn = el("button", `pos-btn ${fits ? "fits" : "anomaly"}`,
      `<div class="pos-key">${key}</div><div class="pos-label">${pos.label}</div><div class="pos-tag">${fits ? "Fits your build (+3 OVR)" : "Anomaly (higher risk/reward)"}</div>`);
    btn.onclick = () => {
      state.position = key;
      state.positionFit = fits;
      // Capture a seed and simulate deterministically so a share link can
      // reproduce this exact career later.
      state.seed = Math.floor(Math.random() * 4294967296);
      seedRng(state.seed);
      career = simCareer(computeOVR(), state.team);
      state.currentStep++;
      render();
    };
    grid.appendChild(btn);
  });
  wrap.appendChild(grid);
  app.appendChild(wrap);
}

// ---- Confirm: last chance to retool before the career locks in ----
function renderConfirmStep() {
  const wrap = el("div", "card center");
  wrap.appendChild(el("h1", "step-title", "Ready to Simulate This Career?"));
  wrap.appendChild(el("p", "step-sub",
    `All 7 picks locked &nbsp;·&nbsp; Budget spent: ${state.budgetSpent}/${BUDGET_CAP} &nbsp;·&nbsp; click any pick to change it`));

  const list = el("div", "roster-list");
  CATEGORIES.forEach(cat => {
    const p = currentPick(cat);
    const display = p.label ? `${p.label} <span class="sub-rating">${p.rating}</span>` : p.rating;
    const row = el("button", "roster-row",
      `<span class="roster-name">${categoryLabel(cat)}: ${p.name} <span class="era-tag">${p.team ? p.team.abbr : "—"}</span></span>
       <span class="roster-rating">${display}</span>
       <span class="roster-cost">${p.cost} pts</span>`);
    row.onclick = () => {
      state.editingCategory = cat;
      render();
    };
    list.appendChild(row);
  });
  wrap.appendChild(list);

  const simBtn = el("button", "btn-primary", "Simulate Career →");
  simBtn.style.marginTop = "14px";
  simBtn.onclick = () => { state.currentStep++; render(); };
  wrap.appendChild(simBtn);

  const retoolBtn = el("button", "btn-secondary", "Retool Picks");
  retoolBtn.onclick = () => {
    picksDrawerOpen = true; // surfaces the sidebar drawer; rows above edit directly too
    render();
  };
  wrap.appendChild(retoolBtn);

  app.appendChild(wrap);
}

// ---- Simulating: animated highlight reel from the real career data ----
function renderSimulating() {
  const wrap = el("div", "card center");
  wrap.appendChild(el("h1", "step-title", "Simulating Career..."));
  wrap.appendChild(el("p", "step-sub", `${state.name || "The Mystery Player"} &nbsp;·&nbsp; ${state.team.name}`));
  const feed = el("div", "sim-feed");
  wrap.appendChild(feed);
  app.appendChild(wrap);

  const lines = careerHighlights(career);
  const token = ++simRunToken; // stale timers from a previous run must not fire
  lines.forEach((line, i) => {
    setTimeout(() => {
      if (simRunToken !== token || STEPS[state.currentStep] !== "simulating") return;
      feed.appendChild(el("div", "sim-line", line));
    }, 400 + i * 500);
  });
  setTimeout(() => {
    if (simRunToken !== token || STEPS[state.currentStep] !== "simulating") return;
    state.currentStep++;
    render();
  }, 400 + lines.length * 500 + 800);
}

// ---- Step 8: Career Team ----
// The one team that matters for the season sim — separate from the
// per-pick scouting spins, and spun exactly once.
function renderCareerTeamStep() {
  const wrap = el("div", "card center");
  wrap.appendChild(el("h1", "step-title", "Your Career Team"));
  wrap.appendChild(el("p", "step-sub", "Your build is done — now spin for the franchise you'll actually play for. Their supporting cast decides your win totals."));

  const resultBox = el("div", "spin-result", state.team ? formatTeamResult(state.team) : "?");
  wrap.appendChild(resultBox);

  const spinBtn = el("button", "btn-primary", state.team ? "Spin Again" : "🎡 Spin the Wheel");
  spinBtn.onclick = () => spinReel(resultBox, spinBtn, nextBtn);
  wrap.appendChild(spinBtn);

  const nextBtn = el("button", "btn-secondary", "Lock It In →");
  nextBtn.disabled = !state.team;
  nextBtn.onclick = () => { state.currentStep++; render(); };
  wrap.appendChild(nextBtn);

  app.appendChild(wrap);
}

// Decelerating team-wheel reel: cycles random teams fast, easing to a stop.
// Deadline is wall-clock (performance.now) so it always lands even if timers
// are throttled (e.g. a backgrounded tab).
function spinReel(resultBox, spinBtn, nextBtn) {
  spinBtn.disabled = true;
  nextBtn.disabled = true;
  resultBox.classList.remove("reel-land");
  resultBox.classList.add("reeling");
  const finalTeam = pickRandom(TEAMS);
  const start = performance.now();
  const dur = 1150;
  let delay = 55;
  (function tick() {
    if (performance.now() - start >= dur) {
      state.team = finalTeam;
      resultBox.innerHTML = formatTeamResult(finalTeam);
      resultBox.classList.remove("reeling");
      resultBox.classList.add("reel-land");
      spinBtn.disabled = false;
      spinBtn.textContent = "Spin Again";
      nextBtn.disabled = false;
      return;
    }
    resultBox.innerHTML = formatTeamResult(pickRandom(TEAMS));
    delay = Math.min(delay * 1.16, 160); // ease out
    setTimeout(tick, delay);
  })();
}

function formatTeamResult(team) {
  return `<div class="pick-name">${team.name}</div><div class="pick-meta">${team.abbr} &nbsp;·&nbsp; Supporting Cast Rating ${team.scr}</div>`;
}

// ---- Step 10: Verdict ----
function renderVerdict() {
  const ovr = computeOVR();
  const tier = tierForCareer(career.goatScore, career.peakOVR);
  const pct = percentileForScore(career.goatScore).toFixed(1);
  const badges = computeBadges(ovr, career);
  const headline = generateHeadline(career, tier);
  const bestKey = "aytg_best_score";
  const prevBest = parseInt(localStorage.getItem(bestKey) || "0", 10);
  // Don't let viewing someone else's shared build touch the local best.
  const isNewBest = !state.sharedView && career.goatScore > prevBest;
  if (isNewBest) localStorage.setItem(bestKey, String(career.goatScore));

  const wrap = el("div", "card verdict");
  if (state.sharedView) {
    wrap.appendChild(el("div", "shared-banner",
      `● Viewing <strong>${state.name}</strong>'s build`));
  }
  wrap.appendChild(el("div", "verdict-label", "THE VERDICT"));
  wrap.appendChild(el("h1", "verdict-tier", tier.name.toUpperCase()));
  wrap.appendChild(el("div", "verdict-headline", `"${headline}"`));

  wrap.appendChild(el("div", "scout-report", generateScoutingReport(career, ovr, tier)));

  wrap.appendChild(renderLadder(tier));

  const pctRow = el("div", "pct-row");
  pctRow.appendChild(el("div", "pct-badge", `TOP ${pct}%`));
  if (isNewBest) pctRow.appendChild(el("div", "best-badge", "★ NEW PERSONAL BEST"));
  wrap.appendChild(pctRow);

  const injuryNote = career.injuryEnded
    ? ` <span class="injury-tag">career cut short by injury in Year ${career.injuryYear}</span>`
    : "";
  wrap.appendChild(el("div", "seasons-line", `${career.numSeasons} season${career.numSeasons === 1 ? "" : "s"}${injuryNote} &middot; Peak OVR ${career.peakOVR} &middot; GOAT Score ${career.goatScore}`));

  const statsGrid = el("div", "stats-grid");
  [
    [career.rings, "RINGS"], [career.mvps, "MVP"], [career.finalsMVPs, "FINALS MVP"],
    [career.allNBAs, "ALL-NBA"], [career.allStars, "ALL-STAR"],
  ].forEach(([val, label]) => {
    statsGrid.appendChild(el("div", "stat-box", `<div class="stat-val" data-count="${val}" data-suffix="×">0×</div><div class="stat-label">${label}</div>`));
  });
  wrap.appendChild(statsGrid);

  wrap.appendChild(el("div", "career-wins", `${career.careerWins.toLocaleString()} career wins with the ${state.team.name}`));

  wrap.appendChild(el("div", "section-label", "CAREER TOTALS"));
  const totalsGrid = el("div", "stats-grid six");
  [
    [career.totals.pts, "PTS"], [career.totals.ast, "AST"], [career.totals.reb, "REB"],
    [career.totals.stl, "STL"], [career.totals.blk, "BLK"], [career.totals.threes, "3PM"],
  ].forEach(([val, label]) => {
    totalsGrid.appendChild(el("div", "stat-box", `<div class="stat-val" data-count="${val}" data-fmt="big">0</div><div class="stat-label">${label}</div>`));
  });
  wrap.appendChild(totalsGrid);

  // Career per-game averages: total stat / total games played across the
  // whole career (each season is GAMES_PER_SEASON games, injury year included).
  const games = career.numSeasons * GAMES_PER_SEASON;
  const pg = n => (n / games).toFixed(1);
  wrap.appendChild(el("div", "career-averages",
    `${pg(career.totals.pts)} PPG &middot; ${pg(career.totals.ast)} APG &middot; ${pg(career.totals.reb)} RPG &middot; ${pg(career.totals.stl)} SPG &middot; ${pg(career.totals.blk)} BPG &middot; ${pg(career.totals.threes)} 3PM`));

  const b = career.bestSeason;
  wrap.appendChild(el("div", "section-label", "BEST SEASON"));
  wrap.appendChild(el("div", "peak-line",
    `Year ${b.year} of ${career.numSeasons} — ${b.ppg} PPG · ${b.apg} APG · ${b.rpg} RPG · ${b.spg} SPG · ${b.bpg} BPG · ${b.tpg} 3PM`));

  if (badges.length) {
    const badgeRow = el("div", "badge-row");
    badges.forEach(b => {
      const badge = el("div", "badge", b);
      const info = BADGE_INFO[b] || "";
      badge.dataset.tip = info; // drives the custom broadcast popover
      badge.title = info;        // native fallback for touch / edge cases
      badge.tabIndex = 0;         // keyboard/focus can surface the tip too
      badgeRow.appendChild(badge);
    });
    wrap.appendChild(badgeRow);
  }

  wrap.appendChild(el("div", "section-label", "YOUR 7 LEGENDS"));
  const legendList = el("div", "legend-list");
  const f = finalSkills();
  const rows = [
    ["Height", `${state.height.name} (${state.height.label})`, state.height.rating, `${state.height.cost} pts`],
    ["Frame", `${state.frame.name} (${state.frame.label})`, state.frame.rating, `${state.frame.cost} pts`],
    ...SKILL_ORDER.map(s => [s, state.skills[s].name, f[s], `${state.skills[s].cost} pts`]),
  ];
  rows.forEach(([cat, name, rating, cost]) => {
    const row = el("div", "legend-row");
    row.appendChild(el("div", "legend-cat", cat));
    row.appendChild(el("div", "legend-name", name));
    row.appendChild(el("div", "legend-rating", String(rating)));
    row.appendChild(el("div", "legend-cost", cost));
    legendList.appendChild(row);
  });
  wrap.appendChild(legendList);

  wrap.appendChild(el("div", "meta-line",
    `Position: ${state.position} (${POSITIONS[state.position].label}) — ${state.positionFit ? "Fit ✓" : "Anomaly ⚡"} &nbsp;·&nbsp; Budget spent: ${state.budgetSpent}/${BUDGET_CAP}`));

  if (state.sharedView) {
    const build = el("button", "btn-primary", "Build Your Own →");
    build.onclick = startFresh;
    wrap.appendChild(build);
  } else {
    const shareRow = el("div", "btn-row");
    const shareBtn = el("button", "btn-primary", "🔗 Copy Share Link");
    shareBtn.onclick = () => {
      const link = shareLink();
      copyToClipboard(link).then(() => {
        shareBtn.textContent = "✓ Link Copied!";
        setTimeout(() => { shareBtn.textContent = "🔗 Copy Share Link"; }, 2200);
      }).catch(() => { shareBtn.textContent = "Copy failed — long-press to copy"; });
    };
    const imgBtn = el("button", "btn-secondary", "⬇ Save Image");
    imgBtn.onclick = () => exportVerdictImage(imgBtn);
    shareRow.appendChild(shareBtn);
    shareRow.appendChild(imgBtn);
    wrap.appendChild(shareRow);

    const again = el("button", "btn-secondary", "Play Again");
    again.onclick = resetGame;
    again.style.marginTop = "10px";
    wrap.appendChild(again);
  }

  app.appendChild(wrap);
  animateCounts(wrap);
}

// ---- Share link: encode the build (picks + team + position + seed) ----
// Only the *inputs* are encoded; the verdict is recomputed from them, so the
// link stays short and always re-derives tier/score/stats client-side.
function b64urlEncode(s) {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(s)));
}

function encodeBuild() {
  const ref = cat => {
    const p = currentPick(cat);
    const idx = p.team ? TEAM_ROSTERS[p.team.abbr].findIndex(x => x.name === p.name) : -1;
    if (idx >= 0) return [p.team.abbr, idx];
    // Budget-bin fallback player (not in any roster; its cost was clamped to
    // the remaining budget) — encode by bin index + the clamped cost.
    return ["*", BUDGET_BIN.findIndex(x => x.name === p.name), p.cost];
  };
  const data = { v: 1, n: state.name, s: state.seed, p: state.position, t: state.team.abbr, k: CATEGORIES.map(ref) };
  return b64urlEncode(JSON.stringify(data));
}

function shareLink() {
  return location.origin + location.pathname + "?build=" + encodeBuild();
}

// Rebuild full game state from an encoded build, then recompute the career.
// Throws on anything malformed so the caller can fall back to a fresh game.
function decodeBuild(str) {
  const data = JSON.parse(b64urlDecode(str));
  if (data.v !== 1 || !Array.isArray(data.k) || data.k.length !== CATEGORIES.length) throw new Error("bad build");
  state.skills = {};
  CATEGORIES.forEach((cat, i) => {
    const entry = data.k[i];
    const [abbr, idx, binCost] = entry;
    let pick;
    if (abbr === "*") {
      // budget-bin fallback (skills only): rebuild from BUDGET_BIN + stored cost
      const bp = BUDGET_BIN[idx];
      if (!bp) throw new Error("unknown bin pick");
      pick = { name: bp.name, era: "—", label: null, rating: bp.rating, cost: binCost, team: null };
    } else {
      const team = TEAMS.find(t => t.abbr === abbr);
      const roster = TEAM_ROSTERS[abbr];
      if (!team || !roster || !roster[idx]) throw new Error("unknown pick");
      const pl = roster[idx];
      const rating = categoryRating(pl, cat);
      const label = cat === "height" ? pl.height.label : cat === "frame" ? pl.frame.label : null;
      pick = { name: pl.name, era: pl.era, label, rating, cost: wheelCost(rating), team };
    }
    if (cat === "height" || cat === "frame") state[cat] = pick; else state.skills[cat] = pick;
  });
  state.team = TEAMS.find(t => t.abbr === data.t);
  if (!state.team || !POSITIONS[data.p]) throw new Error("bad team/position");
  state.name = String(data.n || "The Mystery Player").slice(0, 24);
  state.position = data.p;
  state.positionFit = checkPositionFit(data.p);
  state.budgetSpent = CATEGORIES.reduce((a, c) => a + currentPick(c).cost, 0);
  state.seed = data.s >>> 0;
  seedRng(state.seed);
  career = simCareer(computeOVR(), state.team);
  state.sharedView = true;
  state.currentStep = STEPS.indexOf("verdict");
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      ok ? resolve() : reject();
    } catch (e) { reject(e); }
  });
}

// Leaving a shared view: drop the ?build= param and start a normal game.
function startFresh() {
  history.replaceState({}, "", location.pathname);
  state.sharedView = false;
  resetGame();
}

// ---- Downloadable verdict card, hand-drawn on a canvas (no libraries) ----
function exportVerdictImage(btn) {
  const tier = tierForCareer(career.goatScore, career.peakOVR);
  const pct = percentileForScore(career.goatScore).toFixed(1);
  const b = career.bestSeason;
  const W = 1080, H = 1080, cx = W / 2;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  const draw = () => {
    // background
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#101c31"); g.addColorStop(1, "#0a1120");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#d4a72c"; ctx.fillRect(0, 0, 14, H); // gold accent bar
    ctx.fillStyle = "#d4a72c"; ctx.fillRect(60, 130, W - 120, 3); // top rule

    ctx.textAlign = "center";
    const anton = px => `${px}px Anton, sans-serif`;
    const oswald = (px, w = 600) => `${w} ${px}px Oswald, sans-serif`;

    ctx.fillStyle = "#f2c94c"; ctx.font = oswald(34, 700);
    ctx.fillText("🏀 ARE YOU THE GOAT?", cx, 100);

    ctx.fillStyle = "#ff4b3e"; ctx.font = oswald(26, 600);
    ctx.fillText("T H E   V E R D I C T", cx, 220);

    ctx.fillStyle = "#f2c94c"; ctx.font = anton(150);
    ctx.fillText(tier.name.toUpperCase(), cx, 360);

    ctx.fillStyle = "#e5e7eb"; ctx.font = oswald(40, 600);
    ctx.fillText(state.name.toUpperCase(), cx, 430);

    ctx.fillStyle = "#9ca3af"; ctx.font = oswald(30, 500);
    ctx.fillText(`TOP ${pct}%  ·  ${career.numSeasons} SEASONS  ·  PEAK OVR ${career.peakOVR}`, cx, 500);

    // stat cards row
    const stats = [
      [career.rings + "×", "RINGS"], [career.mvps + "×", "MVP"],
      [career.allStars + "×", "ALL-STAR"], [career.goatScore, "GOAT SCORE"],
    ];
    const cardW = 220, gap = 24, totalW = stats.length * cardW + (stats.length - 1) * gap;
    let x = cx - totalW / 2, y = 560;
    stats.forEach(([v, l]) => {
      ctx.fillStyle = "#0e1c34"; ctx.fillRect(x, y, cardW, 170);
      ctx.fillStyle = "#d4a72c"; ctx.fillRect(x, y, cardW, 4);
      ctx.fillStyle = "#f2c94c"; ctx.font = anton(64); ctx.textAlign = "center";
      ctx.fillText(String(v), x + cardW / 2, y + 100);
      ctx.fillStyle = "#9ca3af"; ctx.font = oswald(22, 600);
      ctx.fillText(l, x + cardW / 2, y + 140);
      x += cardW + gap;
    });

    ctx.fillStyle = "#f2c94c"; ctx.font = oswald(26, 700); ctx.textAlign = "left";
    ctx.fillText("BEST SEASON", 70, 830);
    ctx.fillStyle = "#e5e7eb"; ctx.font = oswald(38, 600); ctx.textAlign = "center";
    ctx.fillText(`${b.ppg} PPG   ${b.apg} APG   ${b.rpg} RPG   ${b.bpg} BPG`, cx, 890);

    ctx.fillStyle = "#9ca3af"; ctx.font = oswald(28, 500);
    ctx.fillText(`${career.careerWins.toLocaleString()} career wins with the ${state.team.name}`, cx, 970);

    ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);

    cv.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(state.name || "goat").replace(/\s+/g, "-").toLowerCase()}-verdict.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (btn) { btn.textContent = "✓ Image Saved"; setTimeout(() => { btn.textContent = "⬇ Save Image"; }, 2200); }
    }, "image/png");
  };

  // Ensure the display fonts are ready before drawing, else canvas falls back.
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load("150px Anton"), document.fonts.load("600 34px Oswald")])
      .then(draw).catch(draw);
  } else { draw(); }
}

function renderLadder(currentTier) {
  const ladder = el("div", "ladder");
  TIERS.forEach(t => {
    const dot = el("div", `ladder-dot ${t.name === currentTier.name ? "active" : ""}`);
    const label = el("div", "ladder-label", t.name);
    const item = el("div", "ladder-item");
    item.appendChild(dot);
    item.appendChild(label);
    ladder.appendChild(item);
  });
  return ladder;
}

function resetGame() {
  state.name = "";
  state.height = null;
  state.frame = null;
  state.skills = {};
  state.budgetSpent = 0;
  state.position = null;
  state.positionFit = null;
  state.team = null;
  state.scoutTeam = null;
  state.teamRerollsUsed = 0;
  state.editingCategory = null;
  state.seed = null;
  state.sharedView = false;
  state.currentStep = 0;
  career = null;
  picksDrawerOpen = false;
  render();
}

// Boot: a ?build= link jumps straight to that reconstructed verdict (read-only);
// anything malformed falls back cleanly to a fresh game.
(function boot() {
  const buildParam = new URLSearchParams(location.search).get("build");
  if (buildParam) {
    try { decodeBuild(buildParam); render(); return; }
    catch (e) { history.replaceState({}, "", location.pathname); }
  }
  render();
})();
