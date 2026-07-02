// ===== ARE YOU THE GOAT? — UI CONTROLLER =====

const app = document.getElementById("app");
let career = null;

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

  if (step === "name") renderNameStep();
  else if (step === "height") renderRosterStep("height", "Height", "How tall are they?", pick => lockPhysical("height", pick));
  else if (step === "frame") renderRosterStep("frame", "Body Frame", "What's their build?", pick => lockPhysical("frame", pick));
  else if (SKILL_ORDER.includes(step)) renderRosterStep(step, step, "Pick a legend to build on.", pick => lockSkill(step, pick));
  else if (step === "careerTeam") renderCareerTeamStep();
  else if (step === "position") renderPositionStep();
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

function fmtBig(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
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
// Each pick gets its own independent team spin: first spin for the franchise
// you're scouting from, then that team's full roster shows sorted best to
// worst for the category. Repeats across picks are fine.
function renderRosterStep(category, title, sub, onLock) {
  if (!state.scoutTeam) {
    renderScoutSpin(title);
    return;
  }

  const wrap = el("div", "card");
  wrap.appendChild(el("h1", "step-title center", `Pick: ${title}`));
  wrap.appendChild(el("p", "step-sub center",
    `${sub} &nbsp;·&nbsp; ${state.scoutTeam.name} legends &nbsp;·&nbsp; Budget remaining: ${budgetRemaining()} pts`));

  const list = el("div", "roster-list");
  getRosterOptions(category).forEach(opt => {
    // Height/Frame headline their real-world label; skills show the rating.
    const display = opt.label || opt.rating;
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

  app.appendChild(wrap);
}

// Quick team spin before each pick — decides whose roster you scout from.
// The first spin of each pick is free; "Spin Again" draws from a pool of
// TEAM_REROLLS shared across the whole build.
function renderScoutSpin(title) {
  const wrap = el("div", "card center");
  wrap.appendChild(el("h1", "step-title", `Pick: ${title}`));
  wrap.appendChild(el("p", "step-sub", "First, spin for the franchise you're scouting this pick from."));

  const resultBox = el("div", "spin-result", "?");
  wrap.appendChild(resultBox);

  const rerollsLeft = () => TEAM_REROLLS - state.teamRerollsUsed;

  let provisional = null;
  const spinBtn = el("button", "btn-primary", "🎡 Spin for a Team");
  spinBtn.onclick = () => {
    if (provisional) {
      if (rerollsLeft() <= 0) return;
      state.teamRerollsUsed++;
    }
    provisional = pickRandom(TEAMS);
    resultBox.innerHTML = `<div class="pick-name">${provisional.name}</div><div class="pick-meta">Scouting their all-time legends</div>`;
    spinBtn.textContent = rerollsLeft() > 0 ? `Spin Again (${rerollsLeft()} left)` : "No Rerolls Left";
    spinBtn.disabled = rerollsLeft() <= 0;
    lockBtn.disabled = false;
  };
  wrap.appendChild(spinBtn);

  const lockBtn = el("button", "btn-secondary", "Scout This Team →");
  lockBtn.disabled = true;
  lockBtn.onclick = () => {
    state.scoutTeam = provisional;
    render();
  };
  wrap.appendChild(lockBtn);

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
  spinBtn.onclick = () => {
    state.team = pickRandom(TEAMS);
    resultBox.innerHTML = formatTeamResult(state.team);
    spinBtn.textContent = "Spin Again";
    nextBtn.disabled = false;
  };
  wrap.appendChild(spinBtn);

  const nextBtn = el("button", "btn-secondary", "Lock It In →");
  nextBtn.disabled = !state.team;
  nextBtn.onclick = () => { state.currentStep++; render(); };
  wrap.appendChild(nextBtn);

  app.appendChild(wrap);
}

function formatTeamResult(team) {
  return `<div class="pick-name">${team.name}</div><div class="pick-meta">${team.abbr} &nbsp;·&nbsp; Supporting Cast Rating ${team.scr}</div>`;
}

// ---- Step 10: Verdict ----
function renderVerdict() {
  const ovr = computeOVR();
  const tier = tierForScore(career.goatScore);
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

  wrap.appendChild(renderLadder(tier));

  const pctRow = el("div", "pct-row");
  pctRow.appendChild(el("div", "pct-badge", `TOP ${pct}%`));
  if (isNewBest) pctRow.appendChild(el("div", "best-badge", "★ NEW PERSONAL BEST"));
  wrap.appendChild(pctRow);

  wrap.appendChild(el("div", "seasons-line", `${career.numSeasons} seasons &middot; Peak OVR ${career.peakOVR} &middot; GOAT Score ${career.goatScore}`));

  const statsGrid = el("div", "stats-grid");
  [
    [career.rings, "RINGS"], [career.mvps, "MVP"], [career.finalsMVPs, "FINALS MVP"],
    [career.allNBAs, "ALL-NBA"], [career.allStars, "ALL-STAR"],
  ].forEach(([val, label]) => {
    statsGrid.appendChild(el("div", "stat-box", `<div class="stat-val">${val}×</div><div class="stat-label">${label}</div>`));
  });
  wrap.appendChild(statsGrid);

  wrap.appendChild(el("div", "career-wins", `${career.careerWins.toLocaleString()} career wins with the ${state.team.name}`));

  wrap.appendChild(el("div", "section-label", "CAREER TOTALS"));
  const totalsGrid = el("div", "stats-grid six");
  [
    [career.totals.pts, "PTS"], [career.totals.ast, "AST"], [career.totals.reb, "REB"],
    [career.totals.stl, "STL"], [career.totals.blk, "BLK"], [career.totals.threes, "3PM"],
  ].forEach(([val, label]) => {
    totalsGrid.appendChild(el("div", "stat-box", `<div class="stat-val">${fmtBig(val)}</div><div class="stat-label">${label}</div>`));
  });
  wrap.appendChild(totalsGrid);

  const b = career.bestSeason;
  wrap.appendChild(el("div", "section-label", "BEST SEASON"));
  wrap.appendChild(el("div", "peak-line",
    `Year ${b.year} of ${career.numSeasons} — ${b.ppg} PPG · ${b.apg} APG · ${b.rpg} RPG · ${b.spg} SPG · ${b.bpg} BPG · ${b.tpg} 3PM`));

  if (badges.length) {
    const badgeRow = el("div", "badge-row");
    badges.forEach(b => badgeRow.appendChild(el("div", "badge", b)));
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
  state.currentStep = 0;
  career = null;
  render();
}

render();
