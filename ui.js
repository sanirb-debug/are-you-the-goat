// ===== ARE YOU THE GOAT? — UI CONTROLLER =====

const app = document.getElementById("app");
let career = null;
let picksDrawerOpen = false; // mobile drawer toggle, persists across renders
let simRunToken = 0; // invalidates sim-screen timers from earlier runs
let runUnlocks = []; // achievements earned during THIS playthrough (for the verdict toast)
let sandboxQuery = ""; // Sandbox roster search text, persists across re-renders within a pick
let prevBestAtSim = 0;   // personal best as it stood BEFORE this run (see the Simulate handler)
// No-budget team wheel. Rotation accumulates so every spin turns forward; the
// token invalidates an in-flight spin if the screen re-renders under it (e.g. Back).
let wheelRotation = 0;
let wheelSpinning = false;
let wheelSpinToken = 0;
// No-budget player spinner. The token guards the slot-machine shuffle the same way
// the wheel's does; PLAYER_REROLLS re-spins are a build-level pool shared across
// all 8 rounds (each round's first player spin is free).
const PLAYER_REROLLS = 1;
// Classic's team-wheel re-spins, also build-level. Kept separate from the Salary
// Cap TEAM_REROLLS (still 3) so reducing Classic doesn't touch Salary Cap.
const CLASSIC_TEAM_REROLLS = 1;
let playerSpinToken = 0;
let playerSpinning = false;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ---- Modal / overlay ----
// Mounted on document.body rather than inside #app so the screen underneath is
// left completely untouched — opening and closing never triggers a re-render.
let openModalEl = null;

function closeModal() {
  if (!openModalEl) return;
  const trigger = openModalEl._trigger;
  openModalEl.remove();
  openModalEl = null;
  document.body.classList.remove("modal-open");
  document.removeEventListener("keydown", modalKeydown);
  if (trigger && document.contains(trigger)) trigger.focus();
}

function modalKeydown(e) {
  if (e.key === "Escape") { e.preventDefault(); closeModal(); }
}

// `body` is a DOM node; `actions` is an optional list of [label, className, onClick].
function openModal(titleText, body, actions, trigger) {
  closeModal();
  const backdrop = el("div", "modal-backdrop");
  const modal = el("div", "modal");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", titleText);

  const close = el("button", "modal-x", "&times;");
  close.setAttribute("aria-label", "Close");
  close.onclick = closeModal;
  modal.appendChild(close);
  modal.appendChild(el("h2", "modal-title", titleText));
  modal.appendChild(body);

  if (actions && actions.length) {
    const row = el("div", "modal-actions");
    actions.forEach(([label, cls, fn]) => {
      const b = el("button", cls, label);
      b.onclick = () => { closeModal(); fn && fn(); };
      row.appendChild(b);
    });
    modal.appendChild(row);
  }

  // Click the backdrop (but not the panel) to dismiss.
  backdrop.onclick = e => { if (e.target === backdrop) closeModal(); };
  backdrop.appendChild(modal);
  backdrop._trigger = trigger || null;
  document.body.appendChild(backdrop);
  document.body.classList.add("modal-open");
  document.addEventListener("keydown", modalKeydown);
  openModalEl = backdrop;
  (modal.querySelector(".modal-actions button") || close).focus();
}

function render() {
  closeModal();
  hideTraitTip(); // the pinned pill is about to be detached by the rebuild
  app.innerHTML = "";
  const step = STEPS[state.currentStep];
  // The home screen is its own full-bleed title card: no broadcast chrome, since
  // the top bar's brand would just repeat the big title sitting under it.
  if (step === "home") { renderHome(); return; }
  app.appendChild(renderTopBar());

  if (inPickingPhase()) app.appendChild(renderPicksPanel());
  if (state.editingCategory) {
    renderEditStep(state.editingCategory);
    return;
  }

  if (step === "shadow") renderShadowStep();
  else if (step === "name") renderNameStep();
  else if (step === "height") renderRosterStep("height", "Height", "How tall are they?", pick => lockPhysical("height", pick));
  else if (step === "athleticism") renderRosterStep("athleticism", "Athleticism", "How athletic are they?", pick => lockPhysical("athleticism", pick));
  else if (SKILL_ORDER.includes(step)) renderRosterStep(step, step, "Pick a legend to build on.", pick => lockSkill(step, pick));
  else if (step === "chooseBadges") renderChooseBadges();
  else if (step === "confirm") renderConfirmStep();
  else if (step === "careerTeam") renderCareerTeamStep();
  else if (step === "position") renderPositionStep();
  else if (step === "simulating") renderSimulating();
  else if (step === "verdict") renderVerdict();

  // Appended AFTER the step so it is last in the DOM and cannot be clipped by a
  // card's overflow. Only these two screens: everywhere earlier the picks panel
  // already shows the badges, and it occupies the same corner below 1240px.
  if (step === "simulating" || step === "verdict") {
    const dock = renderBadgeDock();
    if (dock) app.appendChild(dock);
  }
}

function renderTopBar() {
  const bar = el("div", "topbar");
  const step = STEPS[state.currentStep];

  const left = el("div", "topbar-side left");
  // Back first, in the leftmost slot where a back control is expected, and
  // carrying the arrow — Home gives up the arrow so the two don't read alike.
  // The distinction matters: Back is the cheap one (step back a screen, keep
  // everything), Home is the expensive one (leave the build, with a confirm).
  if (backTargetStep() >= 0 || state.editingCategory) {
    const back = el("button", "nav-btn nav-back", "← Back");
    back.title = "Back one screen — your build is kept";
    back.onclick = () => goBack();
    left.appendChild(back);
  }
  const home = el("button", "nav-btn", "⌂ Home");
  home.title = "Leave this build and return to the home screen";
  home.onclick = () => goHome(home);
  left.appendChild(home);
  // Reset sits beside Back/Home for the whole build-in-progress window, but only
  // once there is actually something to clear.
  if (inPickingPhase() && hasBuildProgress()) {
    const reset = el("button", "nav-btn nav-reset", "↺ Reset Build");
    reset.title = "Clear every pick and start the build over — keeps your name and shadow target";
    reset.onclick = () => confirmResetBuild(reset);
    left.appendChild(reset);
  }
  bar.appendChild(left);

  bar.appendChild(el("div", "brand", "🏀 ARE YOU THE GOAT?"));

  const right = el("div", "topbar-side right");
  // Who you're building toward, kept in view for the whole build so the target
  // doesn't vanish between the shadow pick and the verdict. Initials show alone on
  // narrow screens (see .sp-name in style.css) so it never crowds the bar.
  if (state.shadowTarget && inPickingPhase() && !state.sharedView) {
    const parts = state.shadowTarget.split(" ").filter(Boolean);
    const initials = ((parts[0] || "")[0] || "") + ((parts[parts.length - 1] || "")[0] || "");
    const pill = el("div", "shadow-pill",
      `<span class="shp-ini">${initials.toUpperCase()}</span>` +
      `<span class="shp-chase">Chasing</span>` +
      `<span class="shp-name">${state.shadowTarget}</span>`);
    pill.title = `Chasing the Shadow: ${state.shadowTarget}`;
    right.appendChild(pill);
  }
  if (!state.sandbox && !state.autoPick && (step === "height" || step === "athleticism" || SKILL_ORDER.includes(step))) {
    right.appendChild(el("div", "budget-pill", budgetPillHTML()));
  }
  const attrs = el("button", "nav-btn", "Attributes");
  attrs.title = "What each attribute does and how it factors in";
  attrs.onclick = () => showAttributes(attrs);
  right.appendChild(attrs);

  const badges = el("button", "nav-btn", "Badges");
  badges.title = "Browse every signature trait badge";
  badges.onclick = () => showBadges(badges);
  right.appendChild(badges);

  const help = el("button", "nav-btn", "How to Play");
  help.title = "How this game works";
  help.onclick = () => showHowToPlay(help);
  right.appendChild(help);
  bar.appendChild(right);

  return bar;
}

// Any locked-in pick past the shadow-target step counts as progress worth
// warning about. A shared ?build= view has nothing of the player's own to lose.
function hasBuildProgress() {
  if (state.sharedView) return false;
  return !!(state.height || state.athleticism || state.position || state.team ||
            Object.keys(state.skills).length || career);
}

// Step back exactly one screen, keeping the build intact. Distinct from goHome,
// which abandons the run. Mode-independent: backTargetStep reads the one shared
// STEPS flow, so Salary Cap, auto-assign and Sandbox all step back the same way.
function goBack() {
  // The edit sub-screen is a detour hanging off the current step, not a step of
  // its own — Back cancels the edit and drops back onto the screen underneath.
  if (state.editingCategory) { state.editingCategory = null; render(); return; }

  const target = backTargetStep();
  if (target < 0) return;
  const step = STEPS[target];

  if (step === "height" || step === "athleticism" || SKILL_ORDER.includes(step)) {
    // Landing on an attribute screen means that pick is being re-made, so un-make
    // it. In no-budget mode slots fill out of order, so the slot to re-open is the
    // one filled LAST (tracked in pickOrder), not this step's category. Sequential
    // modes still un-make the step's own category. Restoring the scouted team means
    // the re-pick draws from the SAME roster — Back must not hand out a free spin.
    const cat = state.autoPick ? state.pickOrder.pop() : step;
    const removed = cat ? unlockPick(cat) : null;
    if (removed) state.scoutTeam = removed.team;
  }
  sandboxQuery = "";
  // No-budget spinner: re-spin the player for the pick we stepped back into.
  // playerRerollsUsed is a build-level pool (like the team wheel's), so it is
  // NOT refunded here — stepping back does not hand spent re-spins back.
  state.spunPlayer = null;
  state.currentStep = target;
  render();
}

function goHome(trigger) {
  if (!hasBuildProgress()) { resetGame(); return; }
  const body = el("p", "modal-text", "Leave this build? Your progress will be lost.");
  openModal("Leave Build", body, [
    ["Cancel", "btn-secondary", null],
    ["Leave", "btn-primary", () => resetGame()],
  ], trigger);
}

// Start the build over WITHOUT leaving the run: clears every pick, the position,
// the career team and any badges, then drops back on the first attribute step.
// Deliberately keeps the two things chosen before the build began — the player's
// name and their Chasing-the-Shadow target — plus the mode flags, so a reset
// never silently moves you between Classic / Salary Cap / Sandbox.
// Distinct from resetGame (abandons the run entirely, back to the home screen)
// and from goBack (steps back one screen, build intact).
function resetBuild() {
  state.activeBadges = [];
  state.height = null;
  state.athleticism = null;
  state.skills = {};
  state.budgetSpent = 0;
  state.position = null;
  state.positionFit = null;
  state.teamNeedMet = false;
  state.team = null;
  state.scoutTeam = null;
  state.teamRerollsUsed = 0;
  state.spunPlayer = null;
  state.playerRerollsUsed = 0;
  state.pickOrder = [];
  state.editingCategory = null;
  state.seed = null;          // a fresh build earns a fresh sim seed
  sandboxQuery = "";
  wheelRotation = 0;
  wheelSpinning = false;
  playerSpinning = false;
  career = null;
  picksDrawerOpen = false;
  runUnlocks = [];
  state.currentStep = STEPS.indexOf("height");
  render();
}

// Same confirm-before-destroying shape as goHome.
function confirmResetBuild(trigger) {
  const body = el("p", "modal-text", "Reset your build? This can't be undone.");
  openModal("Reset Build", body, [
    ["Cancel", "btn-secondary", null],
    ["Reset", "btn-primary", () => resetBuild()],
  ], trigger);
}

// How to Play: the two tracked modes each get their own steps behind a sub-tab
// (same split as the Trophy Case). Sandbox is a fun untracked side mode, so it
// is left out here too. The tier ladder is shared — it works the same in both.
const HOWTO_STEPS = {
  cap: `
    <ol class="howto-list">
      <li><b>Pick your shadow.</b> Choose an all-time great to measure yourself against. The <b>Chasing the Shadow</b> tracker compares your final stats to theirs, category by category.</li>
      <li><b>Name your player.</b></li>
      <li><b>Make 8 attribute picks</b> — Height, Athleticism, and the five skills, in order. Each pick spins up a scouted team and you buy from that team's <b>full roster</b>. Every player costs cap space against one shared <b>$100M budget</b>, so a max-rated pick early means bargain-bin picks later. Click any locked pick in the sidebar to swap it while you build.</li>
      <li><b>Claim trait badges.</b> Some legends carry a signature trait (★). Collect 2 or more and you choose <b>two</b> to activate for stat bonuses.</li>
      <li><b>Pick a position and a career team.</b> Fitting your position and filling the team's positional need both help.</li>
      <li><b>Simulate.</b> Watch the career play out season by season, then read the verdict.</li>
    </ol>`,
  classic: `
    <ol class="howto-list">
      <li><b>Pick your shadow.</b> Same all-time great to measure yourself against, category by category.</li>
      <li><b>Name your player.</b></li>
      <li><b>Fill 8 attribute slots — no budget, no fixed order.</b> Each round, <b>spin the wheel</b> for a team (no team repeats across your build, so the wheel shrinks as you go) and it <b>spins up a player</b> from that team automatically (no player repeats). You see that player's <b>full 8-stat card</b> and take <b>any one</b> rating whose slot is still open — it fills that slot. Fill the eight in whatever order you like; a stat whose slot is already taken is greyed out. You get <b>one player re-spin for the whole build</b>.</li>
      <li><b>Claim trait badges.</b> Same signature traits (★) — here you can activate up to <b>three</b>.</li>
      <li><b>No do-overs.</b> Once a rating is locked into a slot it's final — the sidebar isn't click-to-swap here. Use <b>Back</b> to step back a whole round.</li>
      <li><b>Pick a position and a career team, then simulate.</b> Just like Salary Cap — position fit and team need matter — then read the verdict.</li>
    </ol>`,
};

function showHowToPlay(trigger) {
  const body = el("div", "howto");
  body.appendChild(el("p", "modal-text", "Build a player from scratch, run their career, and see where they land. Two tracked modes, one ladder:"));

  // Mode sub-tabs — same pattern as the Trophy Case split.
  const modeBar = el("div", "trophy-modes");
  const modeBtns = {};
  MODE_KEYS.forEach(k => {
    const b = el("button", "trophy-mode", MODE_LABELS[k]);
    b.onclick = () => select(k);
    modeBtns[k] = b;
    modeBar.appendChild(b);
  });
  body.appendChild(modeBar);

  const panel = el("div", "howto-steps");
  body.appendChild(panel);

  // Shared tier ladder — shown once, since tiers work the same in both modes.
  body.appendChild(el("p", "modal-text", "Your career earns a spot on the ladder — awards and rings matter as much as ratings:"));
  body.appendChild(el("div", "howto-ladder", TIERS.map(t => `<span>${t.name}</span>`).join("")));

  function select(mode) {
    panel.innerHTML = HOWTO_STEPS[mode];
    MODE_KEYS.forEach(k => modeBtns[k].classList.toggle("active", k === mode));
  }
  // Open on the mode you're actually playing (Classic when in the no-budget mode,
  // Salary Cap otherwise — Sandbox has no tab, so it falls to Salary Cap). Both
  // tabs stay, so the other mode is one click away.
  select(state.autoPick ? "classic" : "cap");

  openModal("How to Play", body, null, trigger);
}

// ---- Attributes reference ----
// Plain-language explanation of every attribute AND exactly how it factors into
// the logic. The weight column is pulled live from OVR_WEIGHTS (game.js), and
// the "drives"/"modifiers" lines mirror generateSeasonStats + applyModifiers, so
// this stays honest if the formula is retuned. Keep entries short and scannable.
const ATTR_INFO = [
  { key: "height", label: "Height",
    blurb: "Raw size. It sets which positions your body fits and anchors your work near the rim.",
    drives: "Rebounds (RPG) and blocks (BPG). Extreme height also trims steals and three-point volume — giants live at the rim, not the arc.",
    mods: "Raises your Rebounding &amp; Defense ratings. At 90+ it drags Playmaking, Shooting &amp; Handles <b>down</b> (a giant's ball-skill tax). Fitting your position's height range earns a +3 OVR bonus." },
  { key: "athleticism", label: "Athleticism",
    blurb: "Explosion, speed and leaping — a clean physical edge with no downside.",
    drives: "Adds to shot-blocking (BPG).",
    mods: "A one-directional boost: above ~55 it lifts your Finishing, Defense &amp; Rebounding ratings. It never penalizes anything." },
  { key: "Shooting", label: "Shooting",
    blurb: "Jump-shooting — range, and touch off the catch.",
    drives: "Half of your scoring (PPG), plus FG% and 3PT% efficiency — and it <b>alone</b> sets three-point volume (3PM).",
    mods: "Nudged down only if your Height is 90+." },
  { key: "Finishing", label: "Finishing",
    blurb: "Scoring at the rim — dunks, layups, inside touch.",
    drives: "The other half of scoring (PPG) and FG%.",
    mods: "Boosted by high Athleticism." },
  { key: "Playmaking", label: "Playmaking",
    blurb: "Passing and court vision.",
    drives: "Assists (APG).",
    mods: "Nudged down only if your Height is 90+." },
  { key: "Handles", label: "Handles",
    blurb: "Ball control and dribbling.",
    drives: "No single box-score line — it feeds your overall OVR, which drives wins, award odds, career length and your final tier.",
    mods: "Nudged down only if your Height is 90+." },
  { key: "Defense", label: "Defense",
    blurb: "On-ball defense, rim protection and instincts.",
    drives: "Steals (SPG) and blocks (BPG), and it gates your Defensive Player of the Year odds.",
    mods: "Raised by high Height and high Athleticism." },
  { key: "Rebounding", label: "Rebounding",
    blurb: "Cleaning the glass at both ends.",
    drives: "Rebounds (RPG).",
    mods: "Raised by high Height and high Athleticism." },
];

function showAttributes(trigger) {
  const body = el("div", "attr-ref");
  body.appendChild(el("p", "modal-text",
    "Your eight picks feed one weighted <b>OVR</b>, and each also drives specific career stats in the sim. " +
    "The percentages below are the live OVR weights — Defense counts most, the two physical traits least."));
  const list = el("div", "attr-list");
  ATTR_INFO.forEach(a => {
    const pct = Math.round((OVR_WEIGHTS[a.key] || 0) * 100);
    const entry = el("div", "attr-entry");
    entry.innerHTML =
      `<div class="attr-head"><span class="attr-name">${a.label}</span>` +
      `<span class="attr-weight">${pct}% of OVR</span></div>` +
      `<div class="attr-blurb">${a.blurb}</div>` +
      `<div class="attr-meta"><span class="attr-tag">Drives</span>${a.drives}</div>` +
      `<div class="attr-meta"><span class="attr-tag">Modifiers</span>${a.mods}</div>`;
    list.appendChild(entry);
  });
  body.appendChild(list);
  openModal("Attributes", body, null, trigger);
}

// ---- Badges reference ----
// Every signature-trait badge, grouped by the skill it attaches to, with a live
// player/badge name filter. Same {name, effect, mods} the in-game tooltips show —
// sourced straight from TRAIT_BADGES so it can't drift.
//
// Each category is a collapsible accordion section: everything starts collapsed
// (200+ badges at once was an unreadable wall), and opening one closes the rest so
// only a single list is ever on screen. The filter overrides that — see below.
function showBadges(trigger) {
  const body = el("div", "badge-ref");

  const search = el("input", "badge-search");
  search.type = "search";
  search.placeholder = "Filter by player or badge name…";
  search.setAttribute("aria-label", "Filter badges by player or badge name");
  body.appendChild(search);

  const groups = el("div", "badge-groups");
  const noMatch = el("div", "badge-empty", "No badges match that filter.");
  noMatch.style.display = "none";

  // Collect entries per skill category, preserving TRAIT_BADGES order.
  const byCat = {};
  SKILL_ORDER.forEach(c => (byCat[c] = []));
  Object.keys(TRAIT_BADGES).forEach(k => {
    const [player, cat] = k.split("|");
    if (byCat[cat]) byCat[cat].push({ player, b: TRAIT_BADGES[k] });
  });

  const sections = [];

  const setOpen = (sec, open) => {
    sec.panel.hidden = !open;
    sec.head.setAttribute("aria-expanded", open ? "true" : "false");
    sec.head.classList.toggle("open", open);
  };
  // Accordion: opening a section closes every other one; clicking the open
  // section's own header collapses it back down.
  const toggle = sec => {
    const willOpen = sec.panel.hidden;
    sections.forEach(s => setOpen(s, false));
    if (willOpen) setOpen(sec, true);
  };

  SKILL_ORDER.forEach(cat => {
    const entries = byCat[cat];
    if (!entries.length) return;

    const head = el("button", "badge-group-head");
    head.type = "button";
    head.innerHTML =
      `<span class="bgh-label">${cat}<span class="badge-group-count">${entries.length}</span></span>` +
      `<span class="bgh-caret" aria-hidden="true">▾</span>`;
    const countEl = head.querySelector(".badge-group-count");

    const panel = el("div", "badge-group-panel");
    const rows = [];
    entries.forEach(({ player, b }) => {
      const mods = fmtMods(b.mods);
      const row = el("div", "badge-row",
        `<div class="badge-row-top"><span class="badge-row-player">${player}</span>` +
        `<span class="badge-row-name">★ ${b.name}</span></div>` +
        `<div class="badge-row-effect">${b.effect}</div>` +
        `<div class="badge-row-mods">${mods}</div>`);
      panel.appendChild(row);
      rows.push({ row, hay: (player + " " + b.name).toLowerCase() });
    });

    const wrap = el("div", "badge-group");
    wrap.appendChild(head);
    wrap.appendChild(panel);
    groups.appendChild(wrap);

    const sec = { cat, head, panel, rows, wrap, countEl, total: entries.length };
    setOpen(sec, false); // collapsed by default
    head.onclick = () => toggle(sec);
    sections.push(sec);
  });

  body.appendChild(groups);
  body.appendChild(noMatch);

  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    let anyVisible = false;
    sections.forEach(sec => {
      let matches = 0;
      sec.rows.forEach(r => {
        const show = !q || r.hay.includes(q);
        r.row.style.display = show ? "" : "none";
        if (show) matches++;
      });
      // A section with no hits drops out entirely; the count reflects the hits
      // while filtering so the header doesn't claim 33 when 2 are showing.
      sec.wrap.style.display = matches ? "" : "none";
      sec.countEl.textContent = q ? String(matches) : String(sec.total);
      // Results must be visible, so a live filter force-opens the sections that
      // matched; clearing it returns everything to collapsed.
      setOpen(sec, !!q && matches > 0);
      if (matches) anyVisible = true;
    });
    noMatch.style.display = anyVisible ? "none" : "";
  };

  openModal("Signature Trait Badges", body, null, trigger);
}

// Picks are editable while choosing attributes and on the confirm screen;
// from the career team step onward they lock in for good (Position depends
// on final Height/Athleticism).
function inPickingPhase() {
  const step = STEPS[state.currentStep];
  // The sidebar stays up through the whole build — the attribute picks, the
  // trait/position/team steps, and the confirm screen — so the 8 locked picks
  // remain visible right up until the sim runs. (Position and Team come after
  // the 8 attributes, so it shows fully filled there.)
  return step === "height" || step === "athleticism" || step === "confirm" ||
    step === "chooseBadges" || step === "position" || step === "careerTeam" ||
    SKILL_ORDER.includes(step);
}

// A shadow-metric value for display: career totals (`big`) get thousands
// separators (44,000), everything else keeps its fixed decimals (4.0, 6).
function fmtMetric(v, r) {
  return r.big ? Math.round(v).toLocaleString() : v.toFixed(r.decimals);
}

const CATEGORY_LABELS = { height: "Height", athleticism: "Athleticism" };
// Display labels for Signature-Trait stat modifiers.
const STAT_LABEL = { ppg: "PPG", apg: "APG", rpg: "RPG", spg: "SPG", bpg: "BPG", tpg: "3PM", fgPct: "FG%", tptPct: "3PT%" };
const fmtMods = mods => Object.entries(mods).map(([k, v]) => `${STAT_LABEL[k]} +${v}`).join(" · ");
function categoryLabel(cat) { return CATEGORY_LABELS[cat] || cat; }
// A roster row's cost cell: the salary plus its share of the full $100M cap, so
// the price reads as a fraction of the budget while you're choosing. Sandbox has
// no cap for a share to be of, so it shows the salary alone. (Classic never
// reaches this code — it uses the player spinner, not a roster list.)
function rosterCostHTML(cost) {
  if (state.sandbox) return fmtSalary(cost);
  return `${fmtSalary(cost)}<span class="roster-cost-pct">${capPct(cost)}</span>`;
}
// Signature-Trait pill for a roster row: only for skill categories, only if this
// exact player carries a badge there.
function traitPillHTML(name, category) {
  if (!SKILL_ORDER.includes(category)) return "";
  const b = TRAIT_BADGES[name + "|" + category];
  if (!b) return "";
  const tip = `${b.name} — ${b.effect}`;
  const mods = fmtMods(b.mods); // same "3PT% +3 · FG% +2" format as the verdict cards
  // role/tabindex make it a real button (click + Enter/Space); the tooltip is
  // driven by data-tip (+ data-mods) via the delegated trait-tip controller, so
  // it works by tap on mobile as well as hover on desktop.
  return ` <span class="trait-pill" role="button" tabindex="0" data-tip="${tip}" data-mods="${mods}" aria-label="Trait ${b.name}. ${b.effect}. ${mods}">★ ${b.name}</span>`;
}

// The click-to-toggle tooltip attributes for a badge object, so the same trait-tip
// controller can drive any .trait-pill element — used by Classic's sidebar badge
// and stat-card star, which show the badge outside the Salary Cap roster list.
function traitTipAttrs(b) {
  const mods = fmtMods(b.mods);
  return `role="button" tabindex="0" data-tip="${b.name} — ${b.effect}" data-mods="${mods}" aria-label="Trait ${b.name}. ${b.effect}. ${mods}"`;
}

// ---- Click-to-toggle info tooltip: click (primary), hover-preview (bonus) ----
// The roster list is a scroll container that would clip a CSS ::after tooltip,
// so this floats a single element on <body> positioned to the clicked element.
// Delegated capture-phase click handling means tapping toggles the info WITHOUT
// the surrounding roster-row button also selecting that player.
//
// TIP_SELECTOR is what makes this reusable. It started life driving only
// .trait-pill; achievements (the verdict toast chips and the Trophy Case grid)
// now opt in with .tip-target rather than growing a second controller, so they
// inherit the whole behaviour for free — pinning, hover preview, Enter/Space,
// Escape, flip-above-or-below positioning and hide-on-scroll. Anything with
// data-tip and one of these classes is tappable.
const TIP_SELECTOR = ".trait-pill, .tip-target";
let traitTipEl = null;
let pinnedPill = null; // the element whose tip is "pinned" open by a click/tap

function positionTraitTip(pill) {
  const tip = traitTipEl;
  const r = pill.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
  let top = r.top - tr.height - 9;        // preferred: above the pill
  const below = top < 8;
  if (below) top = r.bottom + 9;          // flip beneath if there's no room above
  tip.style.left = left + "px";
  tip.style.top = top + "px";
  tip.classList.toggle("below", below);
  tip.style.setProperty("--arrow-x", (r.left + r.width / 2 - left) + "px");
}

function showTraitTip(pill, pinned) {
  const text = pill.dataset.tip;
  if (!text) return;
  if (!traitTipEl) { traitTipEl = el("div", "trait-tip"); document.body.appendChild(traitTipEl); }
  // Flavor line + a distinct stat-modifier line (green, matching the verdict
  // Signature Traits cards). Built from textContent so badge data can't inject.
  traitTipEl.textContent = "";
  const desc = el("span", "trait-tip-desc");
  desc.textContent = text;
  traitTipEl.appendChild(desc);
  const mods = pill.dataset.mods;
  if (mods) {
    const m = el("span", "trait-tip-mods");
    m.textContent = mods;
    traitTipEl.appendChild(m);
  }
  traitTipEl.classList.add("show");
  positionTraitTip(pill);                  // measure after content + show are set
  pinnedPill = pinned ? pill : pinnedPill;
}

function hideTraitTip() {
  pinnedPill = null;
  if (traitTipEl) traitTipEl.classList.remove("show");
}

function toggleTraitTip(pill) {
  const openOnThis = pinnedPill === pill && traitTipEl && traitTipEl.classList.contains("show");
  if (openOnThis) hideTraitTip(); else showTraitTip(pill, true);
}

// Registered once at load. Capture phase so stopPropagation beats the row
// button's own bubble-phase onclick (requirement: the pill must not select).
function initTraitTips() {
  document.addEventListener("click", e => {
    const pill = e.target.closest && e.target.closest(TIP_SELECTOR);
    if (pill) { e.preventDefault(); e.stopPropagation(); toggleTraitTip(pill); return; }
    if (!(e.target.closest && e.target.closest(".trait-tip"))) hideTraitTip();
  }, true);
  document.addEventListener("keydown", e => {
    const pill = e.target.closest && e.target.closest(TIP_SELECTOR);
    if (pill && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); toggleTraitTip(pill); }
    else if (e.key === "Escape") hideTraitTip();
  }, true);
  // Hover preview (desktop bonus) — only when nothing is pinned by a click.
  document.addEventListener("mouseover", e => {
    const pill = e.target.closest && e.target.closest(TIP_SELECTOR);
    if (pill && !pinnedPill) showTraitTip(pill, false);
  });
  document.addEventListener("mouseout", e => {
    const pill = e.target.closest && e.target.closest(TIP_SELECTOR);
    if (pill && !pinnedPill) hideTraitTip();
  });
  // The pill moves under a floating tip on scroll/resize; simplest is to hide.
  window.addEventListener("scroll", hideTraitTip, true);
  window.addEventListener("resize", hideTraitTip);
}
initTraitTips();

// ---- Persistent picks panel ----
// Fixed sidebar on wide screens, collapsible drawer above the card on
// narrow ones. Locked rows are clickable to revise that pick.
function renderPicksPanel() {
  const locked = CATEGORIES.filter(c => currentPick(c)).length;
  const panel = el("aside", "picks-panel" + (picksDrawerOpen ? " open" : ""));

  const toggle = el("button", "picks-title", `YOUR PICKS <span class="picks-count">${locked}/${CATEGORIES.length}</span><span class="picks-caret">${picksDrawerOpen ? "▴" : "▾"}</span>`);
  toggle.onclick = () => { picksDrawerOpen = !picksDrawerOpen; render(); };
  panel.appendChild(toggle);

  const body = el("div", "picks-body");
  CATEGORIES.forEach(cat => {
    const pick = currentPick(cat);
    if (pick) {
      const b = SKILL_ORDER.includes(cat) ? TRAIT_BADGES[pick.name + "|" + cat] : null;
      const badgeLine = b ? `<span class="picks-badge"><span class="trait-pill" ${traitTipAttrs(b)}>★ ${b.name}</span></span>` : "";
      // Meta line: team, the pick's RATING, then what it cost. Every mode shows the
      // rating (Classic had it first; the capped modes were missing it) and Height
      // always shows its feet-inches band, never a bare rating number. Under the cap
      // the salary carries its share of the full $100M so the budget reads at a
      // glance; the uncapped modes have no share to quote.
      const metaBits = [pick.team ? pick.team.abbr : "—", cat === "height" ? pick.label : pick.rating];
      if (!state.autoPick) {
        metaBits.push(fmtSalary(pick.cost));
        if (!state.sandbox) metaBits.push(`<span class="picks-pct">${capPct(pick.cost)}</span>`);
      }
      const row = el("button", "picks-row" + (state.editingCategory === cat ? " editing" : "") + (state.autoPick ? " locked-in" : ""),
        `<span class="picks-cat">${categoryLabel(cat)}</span>
         <span class="picks-player">${pick.name}</span>
         <span class="picks-meta">${metaBits.join(" &nbsp;·&nbsp; ")}</span>
         ${badgeLine}`);
      row.disabled = state.autoPick; // the spin decides; no re-picking from a list
      row.onclick = () => {
        if (state.autoPick) return;
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

  // Two live metrics, side by side:
  //   Raw Avg      — flat unweighted mean of every LOCKED skill/athleticism
  //                  rating (Height excluded — an objective physical trait, not a
  //                  skill, so averaging its number in is meaningless).
  //   Projected OVR — the SAME weighted formula the sim uses (Defense/Shooting/
  //                  Finishing heaviest, physicals lightest) over the filled
  //                  slots, plus the +3 fit bonus once a position is set, mapped
  //                  onto the final Peak-OVR scale. This is "what the build
  //                  translates to" and reads meaningfully higher than the flat
  //                  average for builds stacked in heavily-weighted categories.
  // Both recompute every render, so they track the moment a pick locks.
  const ratingSlots = CATEGORIES.filter(c => c !== "height");
  const filled = ratingSlots.map(c => currentPick(c)).filter(Boolean);
  const allPicked = CATEGORIES.every(c => currentPick(c));
  if (filled.length) {
    const avg = filled.reduce((s, p) => s + p.rating, 0) / filled.length;
    const proj = projectedOVR();
    const info = tip =>
      `<span class="trait-pill pa-info" role="button" tabindex="0" data-tip="${tip}">?</span>`;
    const metrics = el("div", "picks-metrics" + (allPicked ? " complete" : ""));
    metrics.appendChild(el("div", "metric",
      `<span class="m-label">Raw Avg ${info("Unweighted raw average of your skill ratings (Height excluded). Projected OVR weights these — it is the truer read on what your build becomes.")}</span>` +
      `<span class="m-val">${Math.round(avg)}</span>`));
    if (proj != null) {
      metrics.appendChild(el("div", "metric metric-proj",
        `<span class="m-label">Proj OVR ${info("Weighted projection on your final Peak-OVR scale: heavier skills (Defense, Shooting, Finishing) count more and Height/Athleticism least, plus a +3 bonus once your position fits. Updates live; the career sim then adds season-to-season variance.")}</span>` +
        `<span class="m-val">${proj}</span>`));
    }
    panel.appendChild(metrics);
  }
  return panel;
}

// ---- Edit a locked pick ----
// Re-opens the same team's roster the pick was scouted from — no new spin.
function renderEditStep(category) {
  // Auto-assign never exposes a manual roster list — bail back to the flow.
  if (state.autoPick) { state.editingCategory = null; render(); return; }
  const pick = currentPick(category);
  const team = pick.team;

  const wrap = el("div", "card");
  wrap.appendChild(el("h1", "step-title center", `Edit: ${categoryLabel(category)}`));
  wrap.appendChild(el("p", "step-sub center",
    `${team.name} legends &nbsp;·&nbsp; current: ${pick.name}${state.sandbox ? "" : ` (${fmtSalary(pick.cost)} refunded on swap)`} &nbsp;·&nbsp; ${state.sandbox ? "Sandbox \u2014 no cap" : "Cap space: " + fmtSalary(budgetRemaining())}`));

  const list = el("div", "roster-list");
  getRosterOptions(category, team, pick.cost).forEach(opt => {
    const isCurrent = opt.name === pick.name && opt.cost === pick.cost;
    const display = opt.label ? (category === "height" ? opt.label : `${opt.label} <span class="sub-rating">${opt.rating}</span>`) : opt.rating;
    const row = el("button", "roster-row" + (opt.affordable ? "" : " locked") + (isCurrent ? " current" : ""),
      `<span class="roster-name">${opt.name} <span class="era-tag">${opt.era}</span>${isCurrent ? ' <span class="era-tag current-tag">current</span>' : ""}${traitPillHTML(opt.name, category)}</span>
       <span class="roster-rating">${display}</span>
       <span class="roster-cost">${rosterCostHTML(opt.cost)}</span>`);
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
  return `CAP <span class="budget-num">${fmtSalary(state.budgetSpent)}</span>/${fmtSalary(BUDGET_CAP)}`;
}

// ---- Step 0: Name ----
// ---- Step 0: "Chasing the Shadow" — pick the all-time great to measure against ----
function renderShadowStep() {
  const wrap = el("div", "card center");
  wrap.appendChild(el("div", "verdict-label", "CHASING THE SHADOW"));
  wrap.appendChild(el("h1", "step-title", "Who is your GOAT?"));
  wrap.appendChild(el("p", "step-sub", "Pick the legend your career will be measured against. You'll chase their rings, their MVPs, and their peak numbers."));
  // A dropdown rather than a 16-card grid: the list stays scannable as legends
  // are added, and the picked legend gets a full benchmark preview before it is
  // locked in. Native <select> (same pattern as the Sandbox team picker) so the
  // scroll/keyboard/mobile behaviour is the platform's.
  const sel = el("select", "shadow-menu");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a legend\u2026";
  sel.appendChild(placeholder);
  SHADOW_ORDER.forEach(name => {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    if (state.shadowTarget === name) o.selected = true;
    sel.appendChild(o);
  });
  wrap.appendChild(sel);

  const preview = el("div", "shadow-preview");
  wrap.appendChild(preview);

  const cta = el("button", "btn-primary", "Lock In Your GOAT \u2192");
  cta.style.marginTop = "14px";

  // The full benchmark set the Chasing the Shadow tracker will compare against —
  // zeros included, since a legend with no DPOY/ROTY is a genuinely easier mark.
  function showPreview(name) {
    preview.innerHTML = "";
    if (!name) { cta.disabled = true; return; }
    const t = SHADOW_TARGETS[name];
    const stat = (v, lbl) => `<span class="sp-stat"><b>${v}</b><i>${lbl}</i></span>`;
    // Career totals show with thousands separators. For Russell/Wilt the
    // pre-tracking blocks/steals/3PM (0) render as a muted "n/t" with era context
    // rather than a hollow number — same handling as the tracker/verdict.
    const total = (v, lbl, era) => {
      const untracked = t.preTracking && era && v === 0;
      const val = untracked
        ? `<span class="sp-nt" title="Not an official stat in ${t.label}'s era">n/t</span>`
        : v.toLocaleString();
      return `<span class="sp-stat"><b>${val}</b><i>${lbl}</i></span>`;
    };
    preview.appendChild(el("div", "sp-name", name));
    preview.appendChild(el("div", "sp-stats",
      stat(t.rings, `Ring${t.rings === 1 ? "" : "s"}`) +
      stat(t.mvps, "MVP") +
      stat(t.finalsMVPs, "Finals MVP") +
      stat(t.allNBA, "All-NBA") +
      stat(t.allStar, "All-Star") +
      stat(t.dpoys, "DPOY") +
      stat(t.roty, "ROTY") +
      stat(t.peakPPG, "Peak PPG") +
      stat(t.peakAPG, "Peak APG") +
      stat(t.peakRPG, "Peak RPG")));
    preview.appendChild(el("div", "sp-sub", "Career Totals"));
    preview.appendChild(el("div", "sp-stats",
      total(t.totalPTS, "Points", false) +
      total(t.totalAST, "Assists", false) +
      total(t.totalREB, "Rebounds", false) +
      total(t.totalBLK, "Blocks", true) +
      total(t.total3PM, "3PM", true) +
      total(t.totalSTL, "Steals", true)));
    cta.disabled = false;
  }

  sel.onchange = () => showPreview(sel.value);
  cta.onclick = () => {
    if (!sel.value) return;
    state.shadowTarget = sel.value;
    state.currentStep++;
    render();
  };
  showPreview(sel.value);
  wrap.appendChild(cta);
  app.appendChild(wrap);
}

// ---- Home / title screen ----
// First thing the player sees. Deliberately sparse: title, tagline, one CTA.
// The CTA lives in a .home-modes column so a second game mode can be dropped in
// later without any layout work — with one child it just reads as a single button.
function renderHome() {
  const wrap = el("div", "home");
  wrap.appendChild(el("h1", "home-title", "ARE YOU<br>THE GOAT?"));
  wrap.appendChild(el("p", "home-tagline", "Build a legend. Chase the shadow. Find out."));

  const modes = el("div", "home-modes");
  // New primary: spin-and-be-assigned, no budget.
  const cta = el("button", "home-cta", "ARE YOU THE GOAT?");
  cta.onclick = () => { state.autoPick = true; state.currentStep++; render(); };
  modes.appendChild(cta);
  // The original constrained game, now explicitly labelled.
  const capCta = el("button", "home-cta cap-edition", "ARE YOU THE GOAT? <span>(SALARY CAP EDITION)</span>");
  capCta.onclick = () => { state.currentStep++; render(); };
  modes.appendChild(capCta);
  wrap.appendChild(modes);

  // Sandbox Mode — a fun side mode, so secondary weight below the main CTA.
  const sandboxRow = el("div", "home-secondary");
  const sandboxBtn = el("button", "home-link sandbox", "\u26A1 Sandbox Mode");
  sandboxBtn.title = "No budget cap, every trait active - just for fun (not tracked)";
  sandboxBtn.onclick = () => { state.sandbox = true; state.currentStep++; render(); };
  sandboxRow.appendChild(sandboxBtn);
  wrap.appendChild(sandboxRow);

  // Two secondary entry points into the Trophy Case (one modal, two tabs).
  const sub = el("div", "home-secondary");
  const statsBtn = el("button", "home-link", "Lifetime Stats");
  statsBtn.onclick = () => showTrophyCase("stats", statsBtn);
  const achBtn = el("button", "home-link", "Achievements");
  achBtn.onclick = () => showTrophyCase("achievements", achBtn);
  sub.appendChild(statsBtn);
  sub.appendChild(achBtn);
  wrap.appendChild(sub);

  wrap.appendChild(el("div", "home-foot", "v1.0"));
  app.appendChild(wrap);
  cta.focus();
}

// ---- Trophy Case: one modal, two tabs (Lifetime Stats + Achievements) ----
// Reads straight from persisted progress so it always reflects localStorage.
function showTrophyCase(initialTab, trigger) {
  const body = el("div", "trophy");

  // Tab bar: what you're looking at
  const tabs = el("div", "trophy-tabs");
  const statsTab = el("button", "trophy-tab", "Lifetime Stats");
  const achTab = el("button", "trophy-tab", "Achievements");
  tabs.appendChild(statsTab);
  tabs.appendChild(achTab);
  body.appendChild(tabs);

  // Sub-tabs: WHICH MODE's history you're looking at. Stats and achievements are
  // tracked per mode, so both panels are rebuilt when this changes. Sandbox has
  // no pool and so no sub-tab.
  const modeBar = el("div", "trophy-modes");
  const modeBtns = {};
  MODE_KEYS.forEach(k => {
    const b = el("button", "trophy-mode", MODE_LABELS[k]);
    b.onclick = () => selectMode(k);
    modeBtns[k] = b;
    modeBar.appendChild(b);
  });
  body.appendChild(modeBar);

  const panelHost = el("div", "trophy-panels");
  body.appendChild(panelHost);

  let view = initialTab === "achievements" ? "achievements" : "stats";
  let mode = loadAllProgress().lastMode; // open on the mode most recently played

  function draw() {
    const p = loadProgress(mode);
    panelHost.innerHTML = "";
    const statsPanel = buildLifetimePanel(p);
    const achPanel = buildAchievementsPanel(p);
    panelHost.appendChild(statsPanel);
    panelHost.appendChild(achPanel);
    const onStats = view === "stats";
    statsTab.classList.toggle("active", onStats);
    achTab.classList.toggle("active", !onStats);
    statsPanel.style.display = onStats ? "" : "none";
    achPanel.style.display = onStats ? "none" : "";
    MODE_KEYS.forEach(k => modeBtns[k].classList.toggle("active", k === mode));
  }
  const selectMode = m => { mode = m; draw(); };
  statsTab.onclick = () => { view = "stats"; draw(); };
  achTab.onclick = () => { view = "achievements"; draw(); };
  draw();

  openModal("Trophy Case", body, null, trigger);
}

function buildLifetimePanel(p) {
  const panel = el("div", "trophy-panel");
  const bestTier = p.bestTierIdx >= 0 ? TIERS[p.bestTierIdx].name : "—";
  const rows = [
    ["Careers Played", p.careersPlayed],
    ["Best Tier Reached", bestTier],
    ["Best GOAT Score", p.bestScore],
    ["Total Rings", p.totalRings],
    ["Total MVPs", p.totalMVPs],
    ["Total DPOYs", p.totalDPOYs],
    ["Total ROTYs", p.totalROTYs],
    ["Trait Badges Activated", p.activatedBadges.length],
  ];
  const grid = el("div", "lifetime-grid");
  rows.forEach(([label, val]) => {
    grid.appendChild(el("div", "lifetime-cell",
      `<span class="lc-val">${val}</span><span class="lc-label">${label}</span>`));
  });
  panel.appendChild(grid);

  // Dethroned legends: all 14, the cleared ones lit up.
  panel.appendChild(el("div", "trophy-sub",
    `Legends Dethroned &nbsp;·&nbsp; ${p.dethronedTargets.length} of ${SHADOW_ORDER.length}`));
  const chips = el("div", "dethrone-chips");
  SHADOW_ORDER.forEach(name => {
    const got = p.dethronedTargets.includes(name);
    chips.appendChild(el("span", "dethrone-chip" + (got ? " got" : ""),
      `${got ? "✓ " : ""}${SHADOW_TARGETS[name].label}`));
  });
  panel.appendChild(chips);
  return panel;
}

function buildAchievementsPanel(p) {
  const panel = el("div", "trophy-panel");
  const earned = ACHIEVEMENTS.filter(a => p.unlocked[a.id]).length;
  panel.appendChild(el("div", "trophy-sub", `Unlocked &nbsp;·&nbsp; ${earned} of ${ACHIEVEMENTS.length}`));
  const grid = el("div", "ach-grid");
  // The criteria line was already rendered inline here, so this does NOT hide it
  // behind the tap — hiding information that was visible would be a regression.
  // The card becomes a tap target that pins the same criteria plus an explicit
  // earned/not-earned status, which is what the inline text alone never said.
  ACHIEVEMENTS.forEach(a => {
    const got = !!p.unlocked[a.id];
    const card = el("div", "ach-card tip-target" + (got ? " unlocked" : " locked"),
      `<span class="ach-icon">${got ? "🏆" : "🔒"}</span>
       <span class="ach-name">${a.name}</span>
       <span class="ach-status">${got ? "✓ Earned" : "Not yet earned"}</span>
       <span class="ach-desc">${a.desc}</span>`);
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.dataset.tip = (got ? "Earned — " : "Not yet earned — ") + a.desc;
    card.setAttribute("aria-label",
      `${a.name}. ${got ? "Earned" : "Not yet earned"}. ${a.desc}`);
    grid.appendChild(card);
  });
  panel.appendChild(grid);
  return panel;
}

function renderNameStep() {
  const wrap = el("div", "card center");
  wrap.appendChild(el("h1", "step-title", "Name Your Player"));
  wrap.appendChild(el("p", "step-sub", "You're about to gamble their whole career on the wheel. Give them a name first."));
  const input = el("input", "name-input");
  input.placeholder = "e.g. Zayde Storm";
  input.maxLength = 24;
  wrap.appendChild(input);

  // Inline rejection message. Kept in the DOM (not inserted on demand) so showing
  // it never shifts the button underneath it.
  const err = el("p", "name-error", "Please choose an appropriate name.");
  err.style.visibility = "hidden";
  err.setAttribute("role", "alert");
  wrap.appendChild(err);

  const submit = () => {
    const value = input.value.trim();
    // Blocked names are REJECTED, not silently replaced — the player is told why
    // and gets to try again rather than being surprised by a swapped-in name later.
    if (isNameBlocked(value)) {
      err.style.visibility = "";
      input.classList.add("invalid");
      input.focus();
      input.select();
      return;
    }
    state.name = value || "The Mystery Player";
    state.currentStep++;
    render();
  };
  // Clear the warning as soon as they start editing, so it reads as guidance
  // rather than a persistent scold.
  input.oninput = () => { err.style.visibility = "hidden"; input.classList.remove("invalid"); };
  input.onkeydown = e => { if (e.key === "Enter") submit(); };

  const btn = el("button", "btn-primary", "Let's Go →");
  btn.onclick = submit;
  wrap.appendChild(btn);
  app.appendChild(wrap);
  input.focus();
}

// ---- Sandbox roster browser ----
// Sandbox only. Normal mode keeps the random spin + 3 rerolls, because that
// scouting constraint is what makes a real build mean something — a
// browse-anything control would delete it. Sandbox has no constraints, so any
// team is fair game.
function renderSandboxBrowser(category) {
  const bar = el("div", "sandbox-controls");

  const sel = el("select", "sandbox-team");
  sel.title = "Browse any team's roster";
  TEAMS.forEach(t => {
    const o = document.createElement("option");
    o.value = t.abbr;
    o.textContent = t.name;
    if (state.scoutTeam && t.abbr === state.scoutTeam.abbr) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => {
    state.scoutTeam = TEAMS.find(t => t.abbr === sel.value) || state.scoutTeam;
    sandboxQuery = ""; // a team choice replaces an active league-wide search
    render();
  };

  const search = el("input", "sandbox-search");
  search.type = "search";
  search.placeholder = "Search any player in the league\u2026";
  search.value = sandboxQuery;
  // Re-render on input, then restore focus + caret so typing stays continuous.
  search.oninput = () => {
    sandboxQuery = search.value;
    const pos = search.selectionStart;
    render();
    const next = document.querySelector(".sandbox-search");
    if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch (e) {} }
  };

  bar.appendChild(sel);
  bar.appendChild(search);
  return bar;
}

// ---- No-budget mode: the team wheel ----
// A wheel-of-fortune spinner over the teams still available (no team repeats
// across the 8 picks, so the wheel visibly loses a segment each pick). Pure CSS
// transform rotation — the disc spins, eases to a stop with a fixed pointer at
// top landing on one team, then the flow continues to that team's roster exactly
// as before. Only this mode calls it; Salary Cap and Sandbox are untouched.
const SPINS_PER_TURN = 5;      // full turns before the disc settles, for feel
// The angle (deg) the disc must sit at for `available[idx]` to be under the top
// pointer. Segment i spans [i·seg, (i+1)·seg) clockwise from top; its centre is
// at i·seg + seg/2, and the disc must rotate by the negative of that to bring it up.
function wheelAngleFor(idx, n) {
  const seg = 360 / n;
  const centre = idx * seg + seg / 2;
  return ((-centre) % 360 + 360) % 360;
}

function renderTeamWheel(category, team, rerollsLeft, wrap) {
  wheelSpinToken++;            // invalidate any spin still animating from a prior render
  wheelSpinning = false;
  // No exceptCategory: in the free-for-all loop the round's STEPS entry is just a
  // round counter, NOT the slot being filled, so excepting it would re-admit the
  // team locked in that slot and let it repeat. Back already clears a slot via
  // unlockPick before re-rendering, so nothing needs an exception here.
  const available = availableTeams();
  const n = available.length;
  const seg = 360 / n;

  // Sit the disc at the landed team's angle (static, no animation) so a re-render
  // after a spin — or a Back that restores a team — shows the right segment on top.
  // Idle (no team yet) rests at 0. Either way spins accumulate forward from here.
  if (team) {
    const idx = available.findIndex(t => t.abbr === team.abbr);
    wheelRotation = idx >= 0 ? wheelAngleFor(idx, n) : 0;
  } else {
    wheelRotation = 0;
  }

  const stage = el("div", "team-wheel-stage");
  stage.appendChild(el("div", "tw-pointer"));

  // Alternating navy tones per segment give the slices their edges; a gold-tinted
  // slice marks whichever team is currently under the pointer.
  const landedIdx = team ? available.findIndex(t => t.abbr === team.abbr) : -1;
  const stops = available.map((t, i) => {
    const c = i === landedIdx ? "#3a2f12" : (i % 2 ? "#132540" : "#0d1a30");
    return `${c} ${(i * seg).toFixed(3)}deg ${((i + 1) * seg).toFixed(3)}deg`;
  }).join(", ");
  const disc = el("div", "team-wheel");
  disc.style.background = `conic-gradient(from 0deg, ${stops})`;
  disc.style.transform = `rotate(${wheelRotation}deg)`;

  available.forEach((t, i) => {
    const label = el("span", "tw-label", t.abbr);
    label.style.transform = `translate(-50%, -50%) rotate(${(i * seg + seg / 2).toFixed(3)}deg) translateY(-108px)`;
    if (i === landedIdx) label.classList.add("on");
    disc.appendChild(label);
  });
  stage.appendChild(disc);
  stage.appendChild(el("div", "tw-hub", n + ""));
  wrap.appendChild(stage);

  wrap.appendChild(el("p", "tw-count",
    `${n} team${n === 1 ? "" : "s"} still on the wheel`));

  const canReroll = rerollsLeft > 0;
  // Solid gold is reserved for CONFIRM actions. The first spin is the only thing
  // on screen, so it stays the gold primary; once a team has landed the button
  // becomes a re-spin competing with the lock-in below it, and switches to the
  // slate .btn-spin treatment so the two can't be confused at a glance.
  const btn = el("button", team ? "btn-spin" : "btn-primary",
    !team ? "🎡 Spin the Wheel"
      : canReroll ? `Spin Again (${rerollsLeft} left)`
      : "No Rerolls Left");
  btn.disabled = !!team && !canReroll;
  btn.onclick = () => {
    if (wheelSpinning) return;
    if (team) {
      if (!canReroll) return;
      state.teamRerollsUsed++; // first spin of a pick is free, respins cost a reroll
    }
    // Reroll lands on a DIFFERENT team so paying always visibly moves the wheel.
    const pool = team ? available.filter(t => t.abbr !== team.abbr) : available;
    const target = pickRandom(pool);
    const idx = available.findIndex(t => t.abbr === target.abbr);

    const targetMod = wheelAngleFor(idx, n);
    const cur = ((wheelRotation % 360) + 360) % 360;
    const delta = ((targetMod - cur) % 360 + 360) % 360;
    wheelRotation += SPINS_PER_TURN * 360 + delta;

    wheelSpinning = true;
    btn.disabled = true;
    const tok = wheelSpinToken;
    // Respect reduced-motion: a quick settle instead of the long spin.
    const reduceMotion = window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const durMs = reduceMotion ? 350 : 3000;

    // Landing is driven by a timer, NOT by transitionend alone — under
    // reduced-motion (or any missed event) transitionend never fires, and the
    // spin must still resolve or the wheel would hang forever.
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      disc.removeEventListener("transitionend", done);
      if (tok !== wheelSpinToken) return; // a re-render (e.g. Back) superseded this spin
      wheelSpinning = false;
      state.scoutTeam = target;
      // A newly landed team means a fresh player selection for this pick — but
      // player re-spins are a build-level pool, so spinning a new team does NOT
      // refund them.
      state.spunPlayer = null;
      render();
    };

    if (reduceMotion) {
      disc.style.transition = "none";
      disc.style.transform = `rotate(${wheelRotation}deg)`;
    } else {
      // Double-rAF is the reliable way to start a transform transition: commit the
      // transition property on one frame, then change the transform on the next so
      // the browser has a baseline to animate FROM (a plain reflow read proved
      // flaky here). transitionend finishes early; the timer below guarantees it.
      disc.style.transition = `transform ${durMs}ms cubic-bezier(0.16, 0.62, 0.13, 1)`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        disc.style.transform = `rotate(${wheelRotation}deg)`;
      }));
      disc.addEventListener("transitionend", done);
    }
    setTimeout(done, durMs + 120); // guaranteed resolution even if transitionend never fires
  };
  wrap.appendChild(btn);
}

// ---- No-budget mode: the player spinner + free stat choice ----
// Once the team wheel lands, the player spin fires AUTOMATICALLY as part of the
// same flow — no separate "Spin for Player" press. The reel shuffles that team's
// roster names to ONE random player, then the player takes ANY of that player's 8
// ratings into the CURRENT slot (off-category allowed — the whole point of the
// mode). Only this mode calls it; the team wheel above stays untouched.
let statChoiceKey = null;      // the stat cell currently selected on the 8-stat card

function renderPlayerSpinner(category, team, onLock, wrap) {
  playerSpinToken++;   // invalidate any shuffle still running from a prior render
  playerSpinning = false;
  const rerollsLeft = PLAYER_REROLLS - state.playerRerollsUsed;

  // ---- Not yet spun: the reel auto-spins ----
  // Every path that clears spunPlayer with a team already set — the wheel
  // landing, a team re-spin, Back, or "Spin Player Again" — re-renders into
  // here, and the player spin starts immediately. The old manual button is gone;
  // runPlayerShuffle locks interaction and lands on a player, which re-renders
  // into the stat card below.
  if (!state.spunPlayer) {
    const reel = el("div", "player-reel", "—");
    wrap.appendChild(reel);
    // Placeholder button the shuffle disables; kept off-screen because there is
    // nothing left for the player to click at this step.
    const btn = el("button", "btn-primary");
    btn.style.display = "none";
    wrap.appendChild(btn);
    runPlayerShuffle(category, team, reel, btn);
    return;
  }

  // ---- Landed: the full 8-stat card, free-for-all slot fill ----
  // Clicking a stat fills THAT stat's slot (on-category). Stats whose slot is
  // already filled are disabled — you can only fill still-open slots.
  statChoiceKey = null;
  const p = state.spunPlayer;
  wrap.appendChild(el("div", "player-reel landed",
    `${p.name} <span class="era-tag">${p.era}</span>`));
  wrap.appendChild(el("p", "stat-card-hint center",
    `Click any <strong>open</strong> stat to lock ${p.name.split(" ").slice(-1)[0]}'s rating into that slot. Filled slots are greyed out.`));

  const card = el("div", "stat-card");
  CATEGORIES.forEach(cat => {
    const rating = categoryRating(p, cat);
    const bandLabel = cat === "height" ? p.height.label : cat === "athleticism" ? p.athleticism.label : null;
    const filled = !!currentPick(cat);
    const badge = SKILL_ORDER.includes(cat) ? TRAIT_BADGES[p.name + "|" + cat] : null;
    const starTip = badge ? ` <span class="trait-pill sc-star-pill" ${traitTipAttrs(badge)}>★</span>` : "";
    const cell = el("button", "stat-cell" + (filled ? " filled" : ""),
      `<span class="sc-cat">${categoryLabel(cat)}${filled ? ` <span class="sc-taken">filled</span>` : starTip}</span>
       <span class="sc-val">${bandLabel ? (cat === "height" ? bandLabel : `${bandLabel} <span class="sc-sub">${rating}</span>`) : rating}</span>`);
    cell.disabled = filled;
    cell.onclick = () => {
      if (filled) return;
      statChoiceKey = cat;
      [...card.querySelectorAll(".stat-cell")].forEach(c => c.classList.remove("selected"));
      cell.classList.add("selected");
      lockBtn.disabled = false;
      // Height is objective — show the feet-inches band, never the raw number.
      lockBtn.textContent = `Lock ${categoryLabel(cat)}: ${cat === "height" ? bandLabel : rating} →`;
    };
    card.appendChild(cell);
  });
  wrap.appendChild(card);

  const lockBtn = el("button", "btn-primary", `Choose an open stat above`);
  lockBtn.disabled = true;
  lockBtn.style.marginTop = "12px";
  lockBtn.onclick = () => {
    const cat = statChoiceKey;
    if (!cat || currentPick(cat)) return;
    // The chosen stat fills its OWN slot; the pick carries the scouted team so
    // no-repeat teams keeps working. cost 0 — this mode tracks no budget.
    const pick = buildStatPick(p, team, cat, cat);
    if (cat === "height" || cat === "athleticism") lockPhysical(cat, pick);
    else lockSkill(cat, pick);
    state.pickOrder.push(cat); // so Back re-opens the slot actually filled this round
    state.spunPlayer = null;
    // playerRerollsUsed is NOT reset — it is a build-level pool of PLAYER_REROLLS
    // shared across all 8 rounds, mirroring the team wheel's teamRerollsUsed.
    state.scoutTeam = null; // next round spins its own team
    state.currentStep++;
    render();
  };
  wrap.appendChild(lockBtn);

  // Re-spin the player (a different one). Draws from the build-level pool, so
  // once it hits 0 this button stays disabled for the rest of the build.
  // Sits directly under the gold "Lock ..." button, so it gets the slate re-spin
  // treatment — this is the exact pair a playtester kept misclicking.
  const respin = el("button", "btn-spin",
    rerollsLeft > 0 ? `Spin Player Again (${rerollsLeft} left)` : "No Player Re-spins Left");
  respin.disabled = rerollsLeft <= 0;
  respin.style.marginTop = "8px";
  respin.onclick = () => {
    if (rerollsLeft <= 0) return;
    state.playerRerollsUsed++;
    state.spunPlayer = null; // re-render lands on the idle branch and auto-spins
    render();
  };
  wrap.appendChild(respin);
}

// The slot-machine shuffle: flash roster names in `reel`, decelerating, and land
// on one eligible player. Landing is driven by a guaranteed timer, never by an
// animation event alone (same lesson as the team wheel).
function runPlayerShuffle(category, team, reel, btn) {
  if (playerSpinning) return;
  // Same reason as the wheel: except nothing, or the player locked in the slot
  // this round's step happens to name becomes spinnable again and could fill a
  // SECOND slot (95 players sit on multiple teams, so it is reachable).
  const eligible = spinnablePlayers(team);
  if (!eligible.length) return; // unreachable: teams never repeat, roster is fresh
  const target = pickRandom(eligible);
  const names = eligible.map(p => p.name);
  playerSpinning = true;
  btn.disabled = true;
  const tok = ++playerSpinToken;

  let settled = false;
  const land = () => {
    if (settled) return;
    settled = true;
    if (tok !== playerSpinToken) return; // superseded by a re-render (Back, team respin)
    playerSpinning = false;
    state.spunPlayer = target;
    render();
  };

  const total = 1900;
  let elapsed = 0, delay = 55;
  const tick = () => {
    if (tok !== playerSpinToken) return; // stop flashing if superseded
    reel.textContent = names[Math.floor(Math.random() * names.length)];
    elapsed += delay;
    if (elapsed >= total) { reel.textContent = target.name; land(); return; }
    delay = 55 + Math.pow(elapsed / total, 2) * 240; // ramp the gap -> visibly slow down
    setTimeout(tick, delay);
  };
  tick();
  setTimeout(land, total + 900); // guaranteed landing even if the flash chain stalls
}

// ---- Shared roster picker (Height, Athleticism, and all 5 skills) ----
// Each pick gets its own independent team spin. Spinning reveals the team's
// FULL roster for the category right away — sorted best to worst, clickable
// to lock in. "Spin Again" (3 shared rerolls per build) sits above the list.
function renderRosterStep(category, title, sub, onLock) {
  // Sandbox browses freely, so there is nothing to spin for: seed a team on
  // entry so a roster is visible straight away and let the dropdown drive.
  if (state.sandbox && !state.scoutTeam) state.scoutTeam = pickRandom(TEAMS);
  const team = state.scoutTeam;
  // Classic (autoPick) gets its own reduced team-respin limit; Salary Cap keeps TEAM_REROLLS.
  const rerollsLeft = (state.autoPick ? CLASSIC_TEAM_REROLLS : TEAM_REROLLS) - state.teamRerollsUsed;

  const wrap = el("div", "card");
  // No-budget mode is a free-for-all loop \u2014 no fixed slot per screen, so the
  // title and prompt are generic (the chosen stat decides which slot fills).
  const openLeft = state.autoPick ? CATEGORIES.filter(c => !currentPick(c)).length : 0;
  wrap.appendChild(el("h1", "step-title center",
    state.autoPick ? "Spin & Choose" : `Pick: ${title}`));
  const teamNote = team
    ? `<span class="scout-team-name">${team.name}</span> legends`
    : "Spin for the franchise you're scouting this pick from.";
  // Cap space, or the reason there isn't one. The no-budget team-spin mode lets
  // you pick freely from the spun team, minus anyone already on your roster.
  const capNote = state.sandbox ? "Sandbox \u2014 no cap"
    : state.autoPick ? `${openLeft} slot${openLeft === 1 ? "" : "s"} left to fill \u2014 no repeats`
    : "Cap space: " + fmtSalary(budgetRemaining());
  const subLine = state.autoPick
    ? "Spin a team — a player spins up automatically — then take one of their ratings into any open slot."
    : sub;
  wrap.appendChild(el("p", "step-sub center", `${subLine} &nbsp;·&nbsp; ${teamNote} &nbsp;·&nbsp; ${capNote}`));

  // Team selection, per mode:
  //  - Sandbox: browse controls (dropdown + search), team already seeded above.
  //  - No-budget: a real spinning wheel of the teams still available (no repeats).
  //  - Salary Cap: the classic instant-reveal spin button.
  if (state.sandbox) {
    wrap.appendChild(renderSandboxBrowser(category));
  } else if (state.autoPick) {
    renderTeamWheel(category, team, rerollsLeft, wrap);
  } else {
    // Same rule as the Classic wheel: gold while it's the only action on screen,
    // slate once the roster list is showing and this is a re-spin competing with
    // locking a player in.
    const spinBtn = el("button", team ? "btn-spin" : "btn-primary",
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
  }

  if (!team) {
    // The no-budget wheel is its own pre-spin visual — no "?" placeholder there.
    if (!state.autoPick) wrap.appendChild(el("div", "spin-result", "?"));
  } else {
    wrap.appendChild(el("div", "scout-header",
      `<div class="scout-badge">${team.abbr}</div>
       <div class="scout-head-text">
         <div class="scout-kicker">● Scouting Report</div>
         <div class="scout-teamname">${team.name}</div>
         <div class="scout-scr">Starting Five Rating ${teamRatingFromFive(team.abbr)}</div>
       </div>`));
    // No-budget mode: a player spinner + free stat choice instead of the list.
    if (state.autoPick) {
      renderPlayerSpinner(category, team, onLock, wrap);
      app.appendChild(wrap);
      return;
    }

    const list = el("div", "roster-list");
    // In sandbox an active search pulls from every team; otherwise the scouted one.
    const q = state.sandbox ? sandboxQuery.trim().toLowerCase() : "";
    const source = q
      ? getAllRosterOptions(category).filter(o => o.name.toLowerCase().includes(q)).slice(0, 50)
      : getRosterOptions(category);
    if (q && !source.length) list.appendChild(el("div", "roster-empty", `No player matches \u201C${sandboxQuery.trim()}\u201D`));
    source.forEach(opt => {
      // Height/Athleticism show their real-world label plus the individual rating;
      // skills show the rating alone.
      const display = opt.label ? (category === "height" ? opt.label : `${opt.label} <span class="sub-rating">${opt.rating}</span>`) : opt.rating;
      const row = el("button", "roster-row" + (!opt.affordable ? " locked" : ""),
        `<span class="roster-name">${opt.name} <span class="era-tag">${opt.era}</span>${q ? ` <span class="era-tag team-tag">${opt.team.abbr}</span>` : ""}${traitPillHTML(opt.name, category)}</span>
         <span class="roster-rating">${display}</span>
         <span class="roster-cost">${rosterCostHTML(opt.cost)}</span>`);
      row.disabled = !opt.affordable;
      row.onclick = () => {
        onLock(opt); // opt carries its own .team, so cross-team picks are self-describing
        sandboxQuery = "";
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

// ---- Step 1: Position (chosen first, before the build) ----
function renderPositionStep() {
  const wrap = el("div", "card center");
  wrap.appendChild(el("h1", "step-title", "Choose Your Position"));
  wrap.appendChild(el("p", "step-sub", "Lock your position first, then build toward it. A body that fits the position (right height) earns a +3 OVR fit bonus — go off-position for a higher-risk anomaly run."));

  const grid = el("div", "position-grid");
  Object.entries(POSITIONS).forEach(([key, pos]) => {
    const btn = el("button", "pos-btn",
      `<div class="pos-key">${key}</div><div class="pos-label">${pos.label}</div>`);
    btn.onclick = () => {
      state.position = key;
      state.currentStep++;
      render();
    };
    grid.appendChild(btn);
  });
  wrap.appendChild(grid);
  app.appendChild(wrap);
}

// ---- Confirm: last chance to retool before the career locks in ----
// ---- New step: activate 2 Signature Traits (only shown when 2+ acquired) ----
function renderChooseBadges() {
  const acquired = acquiredBadges();
  // Nothing to choose (sandbox stacks everything; every other mode auto-fills at
  // or under its cap) — activate the lot and skip the step. badgeChoiceIsPending
  // owns that rule so Back can skip this screen on exactly the same terms.
  if (!badgeChoiceIsPending()) {
    state.activeBadges = acquired.map(b => b.key);
    state.currentStep++;
    render();
    return;
  }
  // Auto-assign mode allows up to 3 active traits; every other mode allows 2.
  const cap = state.autoPick ? 3 : 2;
  // Drop any stale selections (e.g. after editing a pick), cap at 2.
  state.activeBadges = state.activeBadges.filter(k => acquired.some(b => b.key === k)).slice(0, cap);

  const wrap = el("div", "card");
  wrap.appendChild(el("div", "verdict-label center", "SIGNATURE TRAITS"));
  wrap.appendChild(el("h1", "step-title center", `Activate ${cap} Traits`));
  wrap.appendChild(el("p", "step-sub center",
    `Your build collected <strong>${acquired.length}</strong> signature traits — pick exactly ${cap} to power the career. The rest stay collected on your verdict but don't affect the sim.`));

  const list = el("div", "badge-choose-list");
  acquired.forEach(b => {
    const on = state.activeBadges.includes(b.key);
    const card = el("button", "badge-choose" + (on ? " on" : ""),
      `<span class="bc-check">${on ? "✓" : ""}</span>
       <span class="bc-main">
         <span class="bc-name">${b.name}</span>
         <span class="bc-src">${b.player} &middot; ${b.category}</span>
         <span class="bc-effect">${b.effect}</span>
         <span class="bc-mods">${fmtMods(b.mods)}</span>
       </span>`);
    card.onclick = () => {
      if (on) state.activeBadges = state.activeBadges.filter(k => k !== b.key);
      else if (state.activeBadges.length < cap) state.activeBadges.push(b.key);
      render();
    };
    list.appendChild(card);
  });
  wrap.appendChild(list);

  const btn = el("button", "btn-primary", `Activate ${state.activeBadges.length}/${cap} →`);
  btn.disabled = state.activeBadges.length !== cap;
  btn.style.marginTop = "12px";
  btn.onclick = () => { state.currentStep++; render(); };
  wrap.appendChild(btn);
  app.appendChild(wrap);
}

function renderConfirmStep() {
  const wrap = el("div", "card center");
  wrap.appendChild(el("h1", "step-title", "Ready to Simulate This Career?"));
  wrap.appendChild(el("p", "step-sub",
    `All ${CATEGORIES.length} picks locked &nbsp;·&nbsp; ${state.sandbox ? "Sandbox \u2014 no salary cap" : state.autoPick ? "No salary cap" : `Salary committed: ${fmtSalary(state.budgetSpent)} of ${fmtSalary(BUDGET_CAP)}`} &nbsp;·&nbsp; click any pick to change it`));

  const list = el("div", "roster-list");
  CATEGORIES.forEach(cat => {
    const p = currentPick(cat);
    const display = p.label ? (cat === "height" ? p.label : `${p.label} <span class="sub-rating">${p.rating}</span>`) : p.rating;
    const row = el("button", "roster-row" + (state.autoPick ? " no-cost" : ""),
      `<span class="roster-name">${categoryLabel(cat)}: ${p.name} <span class="era-tag">${p.team ? p.team.abbr : "—"}</span></span>
       <span class="roster-rating">${display}</span>
       ${state.autoPick ? "" : `<span class="roster-cost">${fmtSalary(p.cost)}</span>`}`);
    row.onclick = () => {
      state.editingCategory = cat;
      render();
    };
    list.appendChild(row);
  });
  wrap.appendChild(list);

  const simBtn = el("button", "btn-primary", "Simulate Career →");
  simBtn.style.marginTop = "14px";
  simBtn.onclick = () => {
    // Build is complete now, so the position-fit bonus can be resolved.
    state.positionFit = checkPositionFit(state.position);
    // Capture a seed and simulate deterministically so a share link can
    // reproduce this exact career later.
    state.seed = Math.floor(Math.random() * 4294967296);
    seedRng(state.seed);
    career = simCareer(computeOVR(), state.team, activeBadgeMods());
    // Fold this finished career into lifetime progress exactly once, here at the
    // moment of completion — not in renderVerdict, which can re-run. Capture any
    // fresh unlocks for the verdict toast.
    // Snapshot the previous best FIRST: recordCareerRun immediately syncs the
    // legacy best-score key, so reading it later in renderVerdict would always
    // come back already-updated and the "new personal best" test could never pass.
    prevBestAtSim = loadProgress(state.autoPick ? "classic" : "cap").bestScore;
    // Sandbox runs never touch lifetime stats, achievements or personal best —
    // an uncapped build trivially hits GOAT and would make every one meaningless.
    runUnlocks = state.sandbox ? [] : recordCareerRun(buildCareerRun(career)).newlyUnlocked;
    state.currentStep++;
    render();
  };
  wrap.appendChild(simBtn);

  const retoolBtn = el("button", "btn-secondary", "Retool Picks");
  retoolBtn.onclick = () => {
    picksDrawerOpen = true; // surfaces the sidebar drawer; rows above edit directly too
    render();
  };
  wrap.appendChild(retoolBtn);

  app.appendChild(wrap);
}

// Assemble the plain fact-sheet recordCareerRun() consumes. Kept here (not in
// game.js) because it reads UI-side state (budget spent, active badges).
function buildCareerRun(car) {
  const tier = tierForCareer(car);
  const active = activeBadgeList();
  const byPlayer = {};
  active.forEach(b => { byPlayer[b.player] = (byPlayer[b.player] || 0) + 1; });
  const fullStack = active.length >= 2 && Object.values(byPlayer).some(n => n >= 2);
  const sh = compareToShadow(car);

  // Two ACTIVE badges whose players really shared a franchise. Team membership is
  // derived from TEAM_ROSTERS (the same source usedTeamAbbrs reads) rather than
  // stored on the badge, so it can't drift from the roster data.
  const teamsOf = name => {
    const out = new Set();
    for (const [abbr, roster] of Object.entries(TEAM_ROSTERS)) {
      if (roster.some(p => p.name === name)) out.add(abbr);
    }
    return out;
  };
  const players = [...new Set(active.map(b => b.player))];
  let badgeSameTeam = false;
  for (let i = 0; i < players.length && !badgeSameTeam; i++) {
    for (let j = i + 1; j < players.length && !badgeSameTeam; j++) {
      const a = teamsOf(players[i]), b = teamsOf(players[j]);
      for (const t of a) if (b.has(t)) { badgeSameTeam = true; break; }
    }
  }
  const catCount = c => active.filter(b => b.category === c).length;
  const best = car.bestSeason || { ppg: 0, rpg: 0, apg: 0 };

  return {
    // Which pool this run credits. Sandbox never reaches recordCareerRun.
    mode: state.autoPick ? "classic" : "cap",
    goatScore: car.goatScore,
    tierIdx: TIERS.findIndex(t => t.name === tier.name),
    tierName: tier.name,
    isHOF: isHallOfFame(car, tier),
    rings: car.rings, mvps: car.mvps, dpoys: car.dpoys, rotys: car.roty,
    // Gate the "Out of the Shadow" achievement + lifetime dethroned list on the
    // true weighted/tier outcome, not the old flat benchmark count.
    dethroned: sh && isDethroned(car) ? sh.targetName : null,
    activatedBadgeKeys: active.map(b => b.key),
    fullStack,
    budgetExact: state.budgetSpent === BUDGET_CAP,
    // "Unanimous": an MVP won in a 99-caliber peak season.
    unanimous: car.mvps >= 1 && car.bestMVPOVR >= 95,

    // ---- Fields the expanded achievement set reads ----
    allStars: car.allStars, allNBAs: car.allNBAs, allDefensives: car.allDefensives,
    numSeasons: car.numSeasons,
    baseOVR: computeOVR(),           // raw axis, so the Classic threshold means one thing
    peakOVR: car.peakOVR,
    budgetSpent: state.budgetSpent,  // internal hundredths of $M (8000 = $80M)
    heightRating: state.height.rating,
    athleticismRating: state.athleticism.rating,
    position: state.position,
    teamAbbr: state.team ? state.team.abbr : null,
    positionFit: !!state.positionFit,
    teamNeedMet: !!state.teamNeedMet,
    // Classic's "Purist" reads both pools; Salary Cap uses only the team pool.
    rerollsUsed: state.teamRerollsUsed + state.playerRerollsUsed,
    activeBadgeCount: active.length,
    badgeSameTeam,
    badgeDefensivePair: catCount("Defense") >= 2,
    badgeScoringPair: catCount("Shooting") + catCount("Finishing") >= 2,
    peakPPG: best.ppg, peakRPG: best.rpg, peakAPG: best.apg,
  };
}

// ---- Simulating: animated highlight reel from the real career data ----
// ---- Persistent active-trait dock (sim + verdict) ----
// The badges are chosen many screens earlier and then only restated near the TOP
// of the verdict, so during the sim sequence and while reading a long verdict the
// player cannot see which traits are actually live. This is a small fixed panel
// that keeps them on screen.
//
// null = "not decided yet": the first render picks a default from the viewport
// (open on desktop, collapsed on narrow screens where an expanded panel would
// cover content). After that it is whatever the player last set, and it survives
// re-renders because render() rebuilds #app from scratch.
let badgeDockOpen = null;
function renderBadgeDock() {
  const active = activeBadgeList();
  if (!active.length) return null;               // no badges acquired -> no dock
  if (badgeDockOpen === null) {
    badgeDockOpen = !(window.matchMedia && window.matchMedia("(max-width: 1240px)").matches);
  }
  const dock = el("div", "badge-dock" + (badgeDockOpen ? " open" : ""));

  const head = el("button", "bd-head");
  head.type = "button";
  head.setAttribute("aria-expanded", badgeDockOpen ? "true" : "false");
  head.innerHTML =
    // The words live in their own span so a collapsed dock can drop to "★ 2" on a
    // narrow screen — measured at 375px, the full label made the pill 156px wide
    // and it sat on top of the verdict's Playstyle Comp callout.
    `<span class="bd-title">★<span class="bd-label"> Active Traits</span><span class="bd-count">${active.length}</span></span>` +
    `<span class="bd-caret" aria-hidden="true">▾</span>`;
  head.setAttribute("aria-label", `Active traits (${active.length})`);
  head.onclick = () => { badgeDockOpen = !badgeDockOpen; render(); };
  dock.appendChild(head);

  const body = el("div", "bd-body");
  active.forEach(b => {
    body.appendChild(el("div", "bd-row",
      `<span class="bd-name">${b.name}</span>` +
      `<span class="bd-who">${b.player} · ${b.category}</span>`));
  });
  dock.appendChild(body);
  return dock;
}

function renderSimulating() {
  const wrap = el("div", "card center");
  wrap.appendChild(el("h1", "step-title", "Simulating Career..."));
  wrap.appendChild(el("p", "step-sub", `${state.name || "The Mystery Player"} &nbsp;·&nbsp; ${state.team.name}`));

  // Small looping dribbler — pure inline SVG + CSS (no assets, no libraries).
  // Animates transform/opacity only, so it stays off the layout/paint path.
  wrap.appendChild(el("div", "dribbler",
    `<svg viewBox="0 0 120 92" width="120" height="92" aria-hidden="true" focusable="false">
       <line class="dr-floor" x1="12" y1="82" x2="108" y2="82" />
       <ellipse class="dr-shadow" cx="84" cy="82" rx="8" ry="2.4" />
       <g class="dr-body">
         <circle class="dr-head" cx="44" cy="20" r="8" />
         <path class="dr-line" d="M44 29 V56" />
         <path class="dr-line" d="M44 56 L36 82 M44 56 L53 82" />
         <path class="dr-line" d="M44 37 L31 47" />
       </g>
       <path class="dr-line dr-arm" d="M44 37 L67 46" />
       <g class="dr-ball">
         <circle class="dr-ballbody" cx="84" cy="46" r="7" />
         <path class="dr-ballseam" d="M77 46 H91 M84 39 V53" />
       </g>
     </svg>`));

  const feed = el("div", "sim-feed");
  wrap.appendChild(feed);

  const lines = careerHighlights(career);
  const token = ++simRunToken; // stale timers from a previous run must not fire
  // Pace the full timeline across 10-14s: ~700ms/line for a packed great
  // career, stretched out for sparse careers, so it reads as a career
  // unfolding rather than a wall of text.
  const feedDur = clamp(lines.length * 700, 10000, 14000);
  const lineGap = feedDur / lines.length;
  lines.forEach((line, i) => {
    setTimeout(() => {
      if (simRunToken !== token || STEPS[state.currentStep] !== "simulating") return;
      feed.appendChild(el("div", "sim-line", line));
      feed.scrollTop = feed.scrollHeight; // keep the newest line in view
    }, 400 + i * lineGap);
  });

  // ---- Shadow tracker: build metrics count up toward the chosen legend's ----
  const cmp = compareToShadow(career);
  if (cmp) {
    const track = el("div", "shadow-track");
    track.appendChild(el("div", "shadow-track-head", `Chasing <strong>${cmp.targetName}</strong>`));
    const grid = el("div", "shadow-track-grid");
    const spans = cmp.rows.map(r => {
      const row = el("div", "shadow-track-row" + (r.untracked ? " untracked" : ""));
      row.appendChild(el("span", "stl", r.label));
      const build = el("span", "stb", r.big ? "0" : r.decimals ? "0.0" : "0");
      row.appendChild(build);
      row.appendChild(el("span", "sts", r.untracked
        ? "not tracked in his era"
        : `/ ${cmp.targetLabel} ${fmtMetric(r.target, r)}`));
      grid.appendChild(row);
      return { el: build, row, final: r.build, decimals: r.decimals, big: r.big, beat: r.beat, untracked: r.untracked };
    });
    track.appendChild(grid);
    wrap.appendChild(track);

    // Count each build value up to its final over the feed's runtime, using a
    // wall-clock deadline so a backgrounded tab (rAF/interval throttling) still
    // lands on the right numbers. Colour each row once it settles.
    const dur = 400 + feedDur;
    const start = performance.now();
    const timer = setInterval(() => {
      if (simRunToken !== token || STEPS[state.currentStep] !== "simulating") { clearInterval(timer); return; }
      const t = Math.min(1, (performance.now() - start) / dur);
      spans.forEach(s => { s.el.textContent = s.big ? Math.round(s.final * t).toLocaleString() : (s.final * t).toFixed(s.decimals); });
      if (t >= 1) {
        spans.forEach(s => {
          s.el.textContent = s.big ? Math.round(s.final).toLocaleString() : s.final.toFixed(s.decimals);
          if (!s.untracked) s.row.classList.add(s.beat ? "beat" : "short");
        });
        clearInterval(timer);
      }
    }, 40);
  }

  app.appendChild(wrap);

  setTimeout(() => {
    if (simRunToken !== token || STEPS[state.currentStep] !== "simulating") return;
    state.currentStep++;
    render();
  }, 400 + feedDur + 1200);
}

// ---- Step 2: Career Team (manual pick from all 30, with positional needs) ----
// The one team that drives the season sim — separate from the per-pick
// scouting spins. Choosing a team whose positional need matches your chosen
// position fills that need for an SCR bonus.
//
// TWO-STAGE: tapping a row expands it, only the confirm button commits. That is
// the whole point of the rework — you see the lineup you'd be joining BEFORE the
// choice is locked, instead of picking off an abstract number.
//
// Migrated teams (see TEAM_FIVES in data.js) show their real starting five and
// the projected team rating with the build in it. Un-migrated teams keep the old
// "need a Power Forward" + SCR treatment — deliberately the old panel, not an
// empty lineup, so every team stays pickable during the division migration.
// .team-list is its OWN scroll container (max-height ~447px at 375px) and an
// expanded group runs ~430px, so opening a row near the bottom of the visible
// window pushed the Sign button below the fold with no cue it was there.
// scrollIntoView is not usable for this: block "nearest" is a no-op whenever the
// element's top is already visible (measured — the container stayed at
// scrollTop 0 with 276px of the group hidden), and "start"/"center" yank the
// whole page around. Compute the scroll directly instead.
function revealGroup(container, group) {
  const c = container.getBoundingClientRect();
  const g = group.getBoundingClientRect();
  const overflowBelow = g.bottom - c.bottom;
  if (overflowBelow <= 0) return;
  // Never scroll so far that the group's own header leaves the top of the window.
  const delta = Math.min(overflowBelow, g.top - c.top);
  // Plain scrollTop, not scrollTo({behavior:"smooth"}) — the latter measured as a
  // complete no-op on this container (scrollTop stayed 0 with delta 276), so the
  // button stayed hidden. The instant jump is short and always works.
  if (delta > 0) container.scrollTop += delta;
}

function renderCareerTeamStep() {
  const posLabel = POSITIONS[state.position].label;
  const buildRating = baseOVRDisplay();
  const wrap = el("div", "card");
  wrap.appendChild(el("h1", "step-title center", "Choose Your Career Team"));
  wrap.appendChild(el("p", "step-sub center",
    `You're a <span class="scout-team-name">${posLabel}</span> rated <strong>${buildRating}</strong>. Tap a team to see the starting five you'd be joining — the lineup around you decides your win totals.`));

  const list = el("div", "roster-list team-list");

  // Sort by how much the build would improve each team — the most meaningful
  // signal on this screen — then by team quality. Every team has a five now, so
  // there is no second ordering rule for un-scouted teams to fall back to.
  const upgradeOf = t => projectedRatingWith(t.abbr, state.position, buildRating) - teamRatingFromFive(t.abbr);
  const sorted = [...TEAMS].sort((a, b) =>
    upgradeOf(b) - upgradeOf(a) || teamRatingFromFive(b.abbr) - teamRatingFromFive(a.abbr));

  const sections = [];
  const setOpen = (sec, open) => {
    sec.panel.hidden = !open;
    sec.head.setAttribute("aria-expanded", open ? "true" : "false");
    sec.head.classList.toggle("open", open);
  };
  // One open at a time — same accordion behaviour as the Badges reference.
  const toggle = sec => {
    const willOpen = sec.panel.hidden;
    sections.forEach(s => setOpen(s, false));
    if (willOpen) { setOpen(sec, true); revealGroup(list, sec.group); }
  };

  sorted.forEach(team => {
    const match = teamNeedPosition(team.abbr) === state.position;
    const rating = teamRatingFromFive(team.abbr);
    const projected = projectedRatingWith(team.abbr, state.position, buildRating);
    const delta = projected - rating;
    const sign = delta > 0 ? "▲ +" + delta : delta < 0 ? "▼ " + delta : "— 0";

    const head = el("button", "roster-row team-row" + (match ? " need-match" : ""));
    head.type = "button";
    head.innerHTML =
      `<span class="roster-name">${team.name} <span class="era-tag">${team.abbr}</span></span>
       <span class="team-swing ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}">${sign}</span>
       <span class="roster-rating">${rating}</span>
       <span class="tf-caret" aria-hidden="true">▾</span>`;

    const panel = el("div", "team-five-panel");
    const rows = teamFive(team.abbr).map(p => {
      const taken = p.pos === state.position;
      return `<div class="tf-row${taken ? " taken" : ""}">
         <span class="tf-pos">${p.pos}</span>
         <span class="tf-player">${p.name}</span>
         <span class="tf-rating">${p.rating}</span>
         ${taken ? `<span class="tf-you">→ you ${buildRating}</span>` : ""}
       </div>`;
    }).join("");
    panel.innerHTML =
      `<div class="tf-rows">${rows}</div>
       <div class="tf-summary">Team rating <strong>${rating}</strong> <span class="tf-arrow">→</span> <strong class="${projected > rating ? "up" : projected < rating ? "down" : ""}">${projected}</strong>
         ${match ? `<span class="tf-needpill">✓ fills their weakest slot</span>` : ""}</div>`;

    const confirm = el("button", "btn btn-primary tf-confirm", `Sign with ${team.name} →`);
    confirm.type = "button";
    confirm.onclick = () => {
      state.team = team;
      state.teamNeedMet = match;
      state.currentStep++;
      render();
    };
    panel.appendChild(confirm);

    const group = el("div", "team-five-group");
    group.appendChild(head);
    group.appendChild(panel);
    list.appendChild(group);

    const sec = { head, panel, group };
    setOpen(sec, false);
    head.onclick = () => toggle(sec);
    sections.push(sec);
  });

  wrap.appendChild(list);
  app.appendChild(wrap);
}

// ---- Verdict ----
function renderVerdict() {
  const ovr = computeOVR();
  const tier = tierForCareer(career);
  const pct = percentileForScore(career.goatScore).toFixed(1);
  const badges = computeBadges(ovr, career);
  const headline = generateHeadline(career, tier);
  // Compare against this mode's pre-run best (recordCareerRun owns the write).
  const prevBest = prevBestAtSim;
  // Don't let viewing someone else's shared build touch the local best.
  // Sandbox is excluded from persistent progress alongside shared views.
  const isNewBest = !state.sharedView && !state.sandbox && career.goatScore > prevBest;


  const wrap = el("div", "card verdict");
  if (state.sandbox) {
    wrap.appendChild(el("div", "sandbox-banner",
      "\u26A1 <strong>SANDBOX MODE</strong> \u00B7 no salary cap, every trait active \u2014 not counted toward stats or achievements"));
  }
  if (state.sharedView) {
    wrap.appendChild(el("div", "shared-banner",
      `● Viewing <strong>${state.name}</strong>'s build`));
  }
  wrap.appendChild(el("div", "verdict-label", "THE VERDICT"));
  wrap.appendChild(el("h1", "verdict-tier", tier.name.toUpperCase()));
  wrap.appendChild(el("div", "verdict-headline", `"${headline}"`));

  // Base OVR (the player you BUILT — weighted rating after the 8 picks + position
  // fit, pre-variance) and Peak OVR (best single sim season), shown as two big
  // headline tiles right under the tier so both read at a glance. Same 25-99
  // scaled axis, so they're directly comparable; Peak >= Base by season variance.
  // baseOVRDisplay keeps Base bounded by the best rating actually picked — a
  // weighted average can't exceed its inputs, and the display must not either.
  const baseOVR = baseOVRDisplay();
  wrap.appendChild(el("div", "verdict-ovr",
    `<div class="vo-tile">
       <span class="vo-label">Base OVR</span>
       <span class="vo-val">${baseOVR}</span>
       <span class="vo-sub">the player you built</span>
     </div>
     <div class="vo-tile vo-peak">
       <span class="vo-label">Peak OVR</span>
       <span class="vo-val">${career.peakOVR}</span>
       <span class="vo-sub">best single season</span>
     </div>`));

  // Achievement toast: only for a real playthrough that unlocked something new.
  // A shared ?build= view never records, so runUnlocks is empty there.
  if (!state.sharedView && runUnlocks.length) {
    const toast = el("div", "ach-toast");
    toast.appendChild(el("div", "ach-toast-head",
      `🏆 Achievement${runUnlocks.length > 1 ? "s" : ""} Unlocked`));
    const names = el("div", "ach-toast-names");
    // Tap/click a chip for what was actually accomplished. dataset (not string
    // interpolation into the markup) so an apostrophe or quote in a desc can
    // never break the attribute.
    runUnlocks.forEach(a => {
      const pill = el("span", "ach-toast-pill tip-target", a.name);
      pill.setAttribute("role", "button");
      pill.setAttribute("tabindex", "0");
      pill.dataset.tip = a.desc;
      pill.setAttribute("aria-label", `Achievement unlocked: ${a.name}. ${a.desc}`);
      names.appendChild(pill);
    });
    toast.appendChild(names);
    wrap.appendChild(toast);
  }

  wrap.appendChild(el("div", "scout-report", generateScoutingReport(career, ovr, tier)));

  const comp = playstyleComp(career);
  wrap.appendChild(el("div", "comp-callout",
    `<span class="comp-label">Playstyle Comp</span>
     <span class="comp-name">${comp.name}</span>
     <span class="comp-reason">${comp.reason}</span>
     ${comp.shades && comp.shades.length ? `<span class="comp-shades">Shades of: ${comp.shades.join(", ")}</span>` : ""}`));

  // ---- Chasing the Shadow: build vs the chosen legend (additive; does not
  // touch the tier/comp logic above). Guarded for older share links w/o a target.
  const shadow = compareToShadow(career);
  if (shadow) {
    const box = el("div", "shadow-verdict");
    // "Caught" only for a true dethroning — cleared the résumé pillars AND a
    // Legend/GOAT-tier career — so the header matches the triumphant narrative
    // and never contradicts a measured one below.
    box.appendChild(el("div", "comp-label",
      `Chasing the Shadow · ${isDethroned(career) ? "Caught" : "Chased"} ${shadow.targetName} — ${shadow.beatCount}/${shadow.total}`));

    // One comparison cell. Pre-tracking-era rows (Russell/Wilt blocks/steals/3PM)
    // show the build's own number tagged "n/t" rather than a hollow ✓ over a zero.
    const shadowCell = r => {
      if (r.untracked) {
        const cell = el("div", "shadow-cmp untracked");
        cell.innerHTML =
          `<span class="scl">${r.label}</span>
           <span class="scv">${fmtMetric(r.build, r)} <span class="scvs">/ —</span></span>
           <span class="scm" title="Not an official stat in ${shadow.targetLabel}'s era">n/t</span>`;
        return cell;
      }
      const cell = el("div", "shadow-cmp" + (r.beat ? " beat" : " short"));
      cell.innerHTML =
        `<span class="scl">${r.label}</span>
         <span class="scv">${fmtMetric(r.build, r)} <span class="scvs">/ ${fmtMetric(r.target, r)}</span></span>
         <span class="scm">${r.beat ? "✓" : "✕"}</span>`;
      return cell;
    };

    // Declutter: show only the three résumé pillars (Rings, MVPs, All-NBA — the
    // heaviest-weighted metrics) by default; the rest fold behind a toggle. This
    // is display-only — beatCount/total and the narrative still score every row.
    const isPillar = r => SHADOW_PILLARS.includes(r.key);
    const grid = el("div", "shadow-cmp-grid");
    shadow.rows.filter(isPillar).forEach(r => grid.appendChild(shadowCell(r)));
    box.appendChild(grid);

    const rest = shadow.rows.filter(r => !isPillar(r));
    if (rest.length) {
      const moreGrid = el("div", "shadow-cmp-grid shadow-more");
      rest.forEach(r => moreGrid.appendChild(shadowCell(r)));
      const toggle = el("button", "shadow-more-toggle", `Show more (${rest.length}) ▾`);
      toggle.setAttribute("aria-expanded", "false");
      toggle.onclick = () => {
        const open = !moreGrid.classList.contains("open");
        moreGrid.classList.toggle("open", open);
        toggle.textContent = open ? "Show less ▴" : `Show more (${rest.length}) ▾`;
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      };
      box.appendChild(toggle);
      box.appendChild(moreGrid);
    }

    box.appendChild(el("p", "shadow-narrative", generateShadowVerdict(career)));
    wrap.appendChild(box);
  }

  wrap.appendChild(renderLadder(tier));

  const pctRow = el("div", "pct-row");
  pctRow.appendChild(el("div", "pct-badge", `TOP ${pct}%`));
  // Hall of Fame verdict: Superstar+ tier, or a long very-good career (10+
  // seasons, 5+ All-Star) — the classic non-superstar Hall of Fame path.
  const hof = isHallOfFame(career, tier);
  pctRow.appendChild(el("div", "hof-badge " + (hof ? "hof-yes" : "hof-no"), hof ? "★ HALL OF FAME" : "NOT A HALL OF FAMER"));
  if (isNewBest) pctRow.appendChild(el("div", "best-badge", "★ NEW PERSONAL BEST"));
  wrap.appendChild(pctRow);

  // Base OVR / Peak OVR now headline the top of the card (verdict-ovr); this line
  // carries the remaining summary figures.
  wrap.appendChild(el("div", "seasons-line",
    `${career.numSeasons} season${career.numSeasons === 1 ? "" : "s"} &middot; GOAT Score ${career.goatScore}`));

  const statsGrid = el("div", "stats-grid eight");
  let allNbaBox = null;
  [
    // Rings + Finals MVP adjacent: the two awards tied directly to team success
    [career.rings, "RINGS"], [career.finalsMVPs, "FINALS MVP"], [career.mvps, "MVP"],
    [career.dpoys || 0, "DPOY"], [career.roty || 0, "ROTY"],
    [career.allNBAs, "ALL-NBA"], [career.allDefensives || 0, "ALL-DEF"], [career.allStars, "ALL-STAR"],
  ].forEach(([val, label]) => {
    const box = el("div", "stat-box", `<div class="stat-val" data-count="${val}" data-suffix="×">0×</div><div class="stat-label">${label}</div>`);
    if (label === "ALL-NBA") allNbaBox = box;
    statsGrid.appendChild(box);
  });
  wrap.appendChild(statsGrid);

  // ---- All-NBA season-by-season breakdown ----
  // Every season's full stat line and All-NBA tier are already produced by
  // simCareer (seasons[] carries {...simSeason result, stats}); this just
  // surfaces the ones that earned a nod instead of only showing the total.
  // The career team is a single team for the whole career (simCareer takes one
  // team), so every row shows state.team.
  const allNbaSeasons = career.seasons
    .map((s, i) => ({ s, year: i + 1 }))
    .filter(x => x.s.allNBA);
  if (allNbaBox && allNbaSeasons.length) {
    const panel = el("div", "season-panel");
    panel.appendChild(el("div", "season-panel-head",
      `All-NBA Seasons &nbsp;·&nbsp; ${allNbaSeasons.length} of ${career.numSeasons} &nbsp;·&nbsp; ${state.team.name}`));
    allNbaSeasons.forEach(({ s, year }) => {
      const st = s.stats;
      const extras = [
        s.mvp ? '<span class="sp-tag mvp">MVP</span>' : "",
        s.ring ? '<span class="sp-tag ring">CHAMPION</span>' : "",
        s.dpoy ? '<span class="sp-tag dpoy">DPOY</span>' : "",
        s.allDefensive ? `<span class="sp-tag alldef">ALL-DEF ${s.allDefensive}</span>` : "",
      ].join("");
      panel.appendChild(el("div", "season-row",
        `<span class="sp-year">Year ${year}</span>
         <span class="sp-team">${state.team.abbr}</span>
         <span class="sp-tier tier-${s.allNBA.replace(/\D/g, "")}">All-NBA ${s.allNBA}</span>
         ${extras}
         <span class="sp-line">${st.ppg} PPG &middot; ${st.rpg} RPG &middot; ${st.apg} APG &middot; ${st.spg} SPG &middot; ${st.bpg} BPG &middot; ${st.tpg} 3PM &middot; ${st.fgPct} FG% &middot; ${st.tptPct} 3PT%</span>`));
    });
    wrap.appendChild(panel);

    // Toggle by mutating classes directly rather than calling render(), so the
    // stat count-up animations don't replay on every open/close.
    allNbaBox.classList.add("expandable");
    allNbaBox.setAttribute("role", "button");
    allNbaBox.tabIndex = 0;
    allNbaBox.title = "Show every All-NBA season";
    const toggle = () => {
      const open = panel.classList.toggle("open");
      allNbaBox.classList.toggle("open", open);
      allNbaBox.setAttribute("aria-expanded", String(open));
    };
    allNbaBox.setAttribute("aria-expanded", "false");
    allNbaBox.onclick = toggle;
    allNbaBox.onkeydown = e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    };
  }

  // ---- Career Stats by Year ----
  // Distinct from the All-NBA breakdown above: EVERY season, in order, with its
  // full stat line and whatever honors it earned. Same expand/collapse pattern,
  // toggled by class mutation so the count-up animations never replay.
  const yearBtn = el("button", "season-toggle", `Career Stats by Year <span class="st-caret">▾</span>`);
  yearBtn.setAttribute("aria-expanded", "false");
  const yearPanel = el("div", "season-panel");
  // One hint for the whole panel replaces what used to be one explanation line
  // per award per season — the affordance stays discoverable, the rows stay clean.
  yearPanel.appendChild(el("div", "season-panel-head",
    `All ${career.numSeasons} Seasons &nbsp;·&nbsp; ${state.team.name}` +
    `<span class="sp-hint">tap any tag for why it was earned &mdash; or why it was not</span>`));
  // The "why did this season win that" explanations (game.js awardReasons, still
  // computed from the same constants the rolls use) are CLICK-TO-REVEAL on the
  // tag itself rather than printed inline. Inline was one line per award per
  // season — a decorated 19-year career carried ~50 lines and swamped the stat
  // lines it was meant to annotate. The tag becomes a .tip-target and the shared
  // controller does the rest, so each tag toggles independently: opening Year 3's
  // All-NBA closes whatever else was open and leaves every other row untouched.
  // Not hover-only — the controller's primary path is click/tap, with hover as a
  // desktop bonus, because hover does not exist on touch.
  career.seasons.forEach((s, i) => {
    const st = s.stats;
    const why = awardReasons(s);
    const row = el("div", "season-row");
    row.innerHTML =
      `<span class="sp-year">Year ${i + 1}</span>
       <span class="sp-team">${state.team.abbr}</span>`;

    // [cssClass, label, reason key]. A ring has no threshold of its own — it is
    // the playoff sim's outcome — so CHAMPION only becomes tappable when that
    // season also produced a Finals MVP, which does have one.
    const TAGS = [
      ["sp-tag mvp", "MVP", s.mvp, "mvp"],
      ["sp-tag ring", "CHAMPION", s.ring, "finalsMVP"],
      ["sp-tag roty", "ROTY", s.roty, "roty"],
      ["sp-tag dpoy", "DPOY", s.dpoy, "dpoy"],
      [`sp-tier tier-${s.allNBA ? s.allNBA.replace(/\D/g, "") : ""}`, `All-NBA ${s.allNBA}`, s.allNBA, "allNBA"],
      ["sp-tag alldef", `ALL-DEF ${s.allDefensive}`, s.allDefensive, "allDefensive"],
      ["sp-tag allstar", "ALL-STAR", s.allStar, "allStar"],
    ];
    TAGS.forEach(([cls, label, present, key]) => {
      if (!present) return;
      const reason = why[key];
      const tag = el("span", cls + (reason ? " tip-target" : ""), label);
      if (reason) {
        tag.setAttribute("role", "button");
        tag.setAttribute("tabindex", "0");
        tag.dataset.tip = reason;
        tag.setAttribute("aria-label", `${label}, year ${i + 1}. ${reason}`);
      }
      row.appendChild(tag);
    });

    // A season with NO honor is the one a player actually questions, and until now
    // it was the only row with nothing to tap. These use the same click-to-reveal
    // controller as the earned tags and are muted rather than gold, so a career's
    // real honors still read at a glance — the misses are there when asked for, not
    // competing for attention. Text comes from missedAwardReasons (game.js), which
    // recomputes from the live thresholds, so it cannot drift from the roll.
    const missed = missedAwardReasons(s);
    [["allStar", "no All-Star"], ["allNBA", "no All-NBA"]].forEach(([key, label]) => {
      const reason = missed[key];
      if (!reason) return;                    // the honor WAS earned this season
      const tag = el("span", "sp-tag sp-missed tip-target", label);
      tag.setAttribute("role", "button");
      tag.setAttribute("tabindex", "0");
      tag.dataset.tip = reason;
      tag.setAttribute("aria-label", `${label}, year ${i + 1}. ${reason}`);
      row.appendChild(tag);
    });

    row.appendChild(el("span", "sp-line",
      `${st.ppg} PPG &middot; ${st.rpg} RPG &middot; ${st.apg} APG &middot; ${st.spg} SPG &middot; ${st.bpg} BPG &middot; ${st.tpg} 3PM &middot; ${st.fgPct} FG% &middot; ${st.tptPct} 3PT%`));
    yearPanel.appendChild(row);
  });
  yearBtn.onclick = () => {
    const open = yearPanel.classList.toggle("open");
    yearBtn.classList.toggle("open", open);
    yearBtn.setAttribute("aria-expanded", String(open));
  };
  wrap.appendChild(yearBtn);
  wrap.appendChild(yearPanel);

  wrap.appendChild(el("div", "career-wins", `${career.careerWins.toLocaleString()} career wins with the ${state.team.name}`));

  wrap.appendChild(el("div", "section-label", "CAREER TOTALS"));
  const totalsGrid = el("div", "stats-grid eight");
  // Counting stats are summed; FG% / 3PT% are career-averaged (can't be summed).
  [
    [career.totals.pts, "PTS", "big"], [career.totals.ast, "AST", "big"], [career.totals.reb, "REB", "big"], [career.totals.stl, "STL", "big"],
    [career.totals.blk, "BLK", "big"], [career.totals.threes, "3PM", "big"],
    [Math.round(career.avgFgPct), "FG%", "pct"], [Math.round(career.avgTptPct), "3PT%", "pct"],
  ].forEach(([val, label, kind]) => {
    const attrs = kind === "pct" ? `data-count="${val}" data-suffix="%"` : `data-count="${val}" data-fmt="big"`;
    totalsGrid.appendChild(el("div", "stat-box", `<div class="stat-val" ${attrs}>0</div><div class="stat-label">${label}</div>`));
  });
  wrap.appendChild(totalsGrid);

  // Career per-game averages: total stat / total games played across the
  // whole career (each season is GAMES_PER_SEASON games). FG%/3PT% are averaged.
  const games = career.numSeasons * GAMES_PER_SEASON;
  const pg = n => (n / games).toFixed(1);
  wrap.appendChild(el("div", "career-averages",
    `${pg(career.totals.pts)} PPG &middot; ${pg(career.totals.ast)} APG &middot; ${pg(career.totals.reb)} RPG &middot; ${pg(career.totals.stl)} SPG &middot; ${pg(career.totals.blk)} BPG &middot; ${pg(career.totals.threes)} 3PM &middot; ${career.avgFgPct} FG% &middot; ${career.avgTptPct} 3PT%`));

  const b = career.bestSeason;
  wrap.appendChild(el("div", "section-label", "BEST SEASON"));
  wrap.appendChild(el("div", "peak-line",
    `Year ${b.year} of ${career.numSeasons} — ${b.ppg} PPG · ${b.apg} APG · ${b.rpg} RPG · ${b.spg} SPG · ${b.bpg} BPG · ${b.tpg} 3PM · ${b.fgPct} FG% · ${b.tptPct} 3PT%`));

  if (badges.length) {
    const badgeRow = el("div", "badge-row");
    // badges arrive ranked by match strength; show only the top few so the
    // most defining ones stand out instead of a wall of 20+.
    badges.slice(0, 6).forEach(b => {
      const badge = el("div", "badge", b.name);
      const info = BADGE_INFO[b.name] || "";
      badge.dataset.tip = info; // drives the custom broadcast popover
      badge.title = info;        // native fallback for touch / edge cases
      badge.tabIndex = 0;         // keyboard/focus can surface the tip too
      badgeRow.appendChild(badge);
    });
    wrap.appendChild(badgeRow);
  }

  // Signature Traits — a DIFFERENT system from the achievement badges above:
  // the real-player traits this build collected, with the active ones (which
  // actually boosted the sim) highlighted and the rest shown as "collected".
  const acquiredTraits = acquiredBadges();
  if (acquiredTraits.length) {
    const activeKeys = new Set(activeBadgeList().map(b => b.key));
    wrap.appendChild(el("div", "section-label", "SIGNATURE TRAITS"));
    const tgrid = el("div", "traits-grid");
    acquiredTraits.forEach(b => {
      const on = activeKeys.has(b.key);
      const cell = el("div", "trait-card" + (on ? " active" : " collected"),
        `<span class="tc-top"><span class="tc-name">${b.name}</span>${on ? '<span class="tc-flag on">ACTIVE</span>' : '<span class="tc-flag off">collected</span>'}</span>
         <span class="tc-src">${b.player} &middot; ${b.category}</span>
         <span class="tc-effect">${b.effect}</span>
         ${on ? `<span class="tc-mods">${fmtMods(b.mods)}</span>` : ""}`);
      tgrid.appendChild(cell);
    });
    wrap.appendChild(tgrid);
  }

  wrap.appendChild(el("div", "section-label", `YOUR ${CATEGORIES.length} LEGENDS`));
  const legendList = el("div", "legend-list");
  const f = finalSkills();
  const rows = [
    ["Height", `${state.height.name} (${state.height.label})`, "", fmtSalary(state.height.cost)],
    ["Athleticism", `${state.athleticism.name} (${state.athleticism.label})`, state.athleticism.rating, fmtSalary(state.athleticism.cost)],
    ...SKILL_ORDER.map(s => [s, state.skills[s].name, f[s], fmtSalary(state.skills[s].cost)]),
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

  const needNote = state.teamNeedMet ? ` &nbsp;·&nbsp; Filled ${state.team.name}'s need ✓` : "";
  wrap.appendChild(el("div", "meta-line",
    `Position: ${state.position} (${POSITIONS[state.position].label}) — ${state.positionFit ? "Fit ✓" : "Anomaly ⚡"}${needNote} &nbsp;·&nbsp; ${state.sandbox ? "Sandbox \u2014 no salary cap" : state.autoPick ? "No salary cap" : `Salary committed: ${fmtSalary(state.budgetSpent)} of ${fmtSalary(BUDGET_CAP)}`}`));

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
  const data = { v: 1, n: state.name, s: state.seed, p: state.position, t: state.team.abbr, sh: state.shadowTarget, ab: state.activeBadges, sb: state.sandbox ? 1 : 0, ap: state.autoPick ? 1 : 0, k: CATEGORIES.map(ref) };
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
      // Math.round: share links minted under older curves can carry decimal costs
      pick = { name: bp.name, era: "—", label: null, rating: bp.rating, cost: Math.round(binCost), team: null };
    } else {
      const team = TEAMS.find(t => t.abbr === abbr);
      const roster = TEAM_ROSTERS[abbr];
      if (!team || !roster || !roster[idx]) throw new Error("unknown pick");
      const pl = roster[idx];
      const rating = categoryRating(pl, cat);
      const label = cat === "height" ? pl.height.label : cat === "athleticism" ? pl.athleticism.label : null;
      pick = { name: pl.name, era: pl.era, label, rating, cost: wheelCost(rating), team };
    }
    if (cat === "height" || cat === "athleticism") state[cat] = pick; else state.skills[cat] = pick;
  });
  state.team = TEAMS.find(t => t.abbr === data.t);
  if (!state.team || !POSITIONS[data.p]) throw new Error("bad team/position");
  state.name = String(data.n || "The Mystery Player").slice(0, 24);
  // Shadow target from the link (older links omit it — the verdict guards for null).
  state.shadowTarget = SHADOW_TARGETS[data.sh] ? data.sh : null;
  state.sandbox = !!data.sb; // a shared sandbox build keeps its banner rather than posing as a real run
  state.autoPick = !!data.ap;
  // Active Signature Traits (older links omit; activeBadgeMods filters to acquired).
  state.activeBadges = Array.isArray(data.ab) ? data.ab.slice(0, 2) : [];
  state.position = data.p;
  state.positionFit = checkPositionFit(data.p);
  // BUG FIXED WHEN THE MIGRATION COMPLETED: this recomputed teamNeedMet from the
  // old historical-roster TEAM_NEEDS while the picker had been using the visible
  // weakest slot since phase 1. The two disagree for most teams, and since the
  // result feeds the +5 SCR bonus straight into simCareer below, a shared link
  // could simulate a different career from the one its author actually saw.
  state.teamNeedMet = teamNeedPosition(state.team.abbr) === data.p;
  state.budgetSpent = CATEGORIES.reduce((a, c) => a + currentPick(c).cost, 0);
  state.seed = data.s >>> 0;
  seedRng(state.seed);
  career = simCareer(computeOVR(), state.team, activeBadgeMods());
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
  const tier = tierForCareer(career);
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
  state.shadowTarget = null;
  state.activeBadges = [];
  state.name = "";
  state.height = null;
  state.athleticism = null;
  state.skills = {};
  state.budgetSpent = 0;
  state.position = null;
  state.positionFit = null;
  state.teamNeedMet = false;
  state.team = null;
  state.scoutTeam = null;
  state.teamRerollsUsed = 0;
  state.spunPlayer = null;
  state.playerRerollsUsed = 0;
  state.pickOrder = [];
  state.editingCategory = null;
  state.seed = null;
  state.sharedView = false;
  state.sandbox = false; // never leak sandbox rules into a real playthrough
  state.autoPick = false;
  sandboxQuery = "";
  wheelRotation = 0;
  wheelSpinning = false;
  playerSpinning = false;
  state.currentStep = 0;
  career = null;
  picksDrawerOpen = false;
  runUnlocks = [];
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
