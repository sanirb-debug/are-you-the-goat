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
  else if (step === "team") renderTeamStep();
  else if (step === "height") renderPhysicalStep("height", HEIGHT_POOL, "Height", "How tall are they?");
  else if (step === "frame") renderPhysicalStep("frame", FRAME_POOL, "Body Frame", "What's their build?");
  else if (SKILL_ORDER.includes(step)) renderSkillStep(step);
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

function budgetPillHTML() {
  return `CAP <span class="budget-num">${state.budgetSpent}</span>/${BUDGET_CAP} &nbsp;·&nbsp; Rerolls left: ${TOTAL_REROLLS - state.rerollsUsed}`;
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

// ---- Shared candidate wheel (Height, Frame, and all 5 skills) ----
// Spin reveals 3 affordable candidates; clicking one locks it in.
function renderWheelStep(title, sub, pool, formatCandidate, onLock) {
  const wrap = el("div", "card center");
  wrap.appendChild(el("h1", "step-title", `Spin: ${title}`));
  wrap.appendChild(el("p", "step-sub", `${sub} &nbsp;·&nbsp; Budget remaining: ${budgetRemaining()} pts`));

  const placeholder = el("div", "spin-result", "?");
  wrap.appendChild(placeholder);

  const grid = el("div", "candidate-grid");
  grid.style.display = "none";
  wrap.appendChild(grid);

  const btnRow = el("div", "btn-row");
  const spinBtn = el("button", "btn-primary", "🎡 Spin the Wheel");
  const rerollBtn = el("button", "btn-ghost", `Reroll (${TOTAL_REROLLS - state.rerollsUsed} left)`);
  rerollBtn.disabled = true;

  function showCandidates() {
    grid.innerHTML = "";
    getCandidates(pool).forEach(pick => {
      const card = el("button", "candidate-card", formatCandidate(pick));
      card.onclick = () => {
        onLock(pick);
        state.currentStep++;
        render();
      };
      grid.appendChild(card);
    });
    placeholder.style.display = "none";
    grid.style.display = "grid";
    spinBtn.style.display = "none";
    rerollBtn.disabled = !canReroll();
  }

  spinBtn.onclick = showCandidates;
  rerollBtn.onclick = () => {
    if (!canReroll()) return;
    useReroll();
    rerollBtn.textContent = `Reroll (${TOTAL_REROLLS - state.rerollsUsed} left)`;
    const pill = document.querySelector(".budget-pill");
    if (pill) pill.innerHTML = budgetPillHTML();
    showCandidates();
  };

  btnRow.appendChild(spinBtn);
  btnRow.appendChild(rerollBtn);
  wrap.appendChild(btnRow);

  app.appendChild(wrap);
}

// ---- Steps 2-3: Height / Frame ----
function renderPhysicalStep(key, pool, label, sub) {
  renderWheelStep(label, sub, pool, formatPhysicalCandidate, pick => lockPhysical(key, pick));
}

// Label (e.g. 6'11" or Powerful) is the headline; rating stays internal.
function formatPhysicalCandidate(pick) {
  return `<div class="pick-name">${pick.label}</div><div class="pick-meta">${pick.name} &nbsp;·&nbsp; Costs ${pick.cost} pts</div>`;
}

// ---- Steps 4-8: Skill wheels ----
function renderSkillStep(skillName) {
  renderWheelStep(skillName, "Pick one to lock in.", SKILL_POOLS[skillName], formatSkillCandidate,
    pick => lockSkill(skillName, pick));
}

function formatSkillCandidate(pick) {
  return `<div class="pick-name">${pick.name}</div><div class="pick-meta">Rating ${pick.rating} &nbsp;·&nbsp; Costs ${pick.cost} pts</div>`;
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

// ---- Step 1: Team ----
function renderTeamStep() {
  const wrap = el("div", "card center");
  wrap.appendChild(el("h1", "step-title", "Spin for a Team"));
  wrap.appendChild(el("p", "step-sub", "Wherever it lands, that's who you're carrying."));

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
    `Position: ${state.position} (${POSITIONS[state.position].label}) — ${state.positionFit ? "Fit ✓" : "Anomaly ⚡"} &nbsp;·&nbsp; Budget spent: ${state.budgetSpent}/${BUDGET_CAP} &nbsp;·&nbsp; Rerolls used: ${state.rerollsUsed}/${TOTAL_REROLLS}`));

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
  state.rerollsUsed = 0;
  state.position = null;
  state.positionFit = null;
  state.team = null;
  state.currentStep = 0;
  career = null;
  render();
}

render();
