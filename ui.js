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
  const isNewBest = career.goatScore > prevBest;
  if (isNewBest) localStorage.setItem(bestKey, String(career.goatScore));

  const wrap = el("div", "card verdict");
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
      badge.title = BADGE_INFO[b] || "";
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

  const again = el("button", "btn-primary", "Play Again");
  again.onclick = resetGame;
  wrap.appendChild(again);

  app.appendChild(wrap);
  animateCounts(wrap);
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
  state.currentStep = 0;
  career = null;
  picksDrawerOpen = false;
  render();
}

render();
