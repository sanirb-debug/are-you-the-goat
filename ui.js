// ===== ARE YOU THE GOAT? — UI CONTROLLER =====

const app = document.getElementById("app");
let career = null;
let picksDrawerOpen = false; // mobile drawer toggle, persists across renders
let simRunToken = 0; // invalidates sim-screen timers from earlier runs
let runUnlocks = []; // achievements earned during THIS playthrough (for the verdict toast)
let sandboxQuery = ""; // Sandbox roster search text, persists across re-renders within a pick
let autoAssigned = null; // Auto-assign mode: the player this spin landed on, awaiting Lock It In
let prevBestAtSim = 0;   // personal best as it stood BEFORE this run (see the Simulate handler)

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
  bar.appendChild(left);

  bar.appendChild(el("div", "brand", "🏀 ARE YOU THE GOAT?"));

  const right = el("div", "topbar-side right");
  if (!state.sandbox && !state.autoPick && (step === "height" || step === "athleticism" || SKILL_ORDER.includes(step))) {
    right.appendChild(el("div", "budget-pill", budgetPillHTML()));
  }
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
    // Landing on an attribute screen means that pick is being re-made, so
    // un-make it: unlockPick refunds the cost so the replacement is charged
    // once, not stacked on the old one. Restoring the team it was scouted from
    // means the player re-picks from the SAME roster — going back must not
    // hand out a free extra spin on top of the 3 rerolls a build gets.
    const removed = unlockPick(step);
    if (removed) {
      state.scoutTeam = removed.team;
      // Auto-assign has no roster list to return to, so re-show the spin result
      // it had landed on: the player can re-lock it or spend a reroll respinning.
      autoAssigned = state.autoPick ? removed : null;
    }
  } else {
    autoAssigned = null;
  }
  sandboxQuery = "";
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

function showHowToPlay(trigger) {
  const body = el("div", "howto", `
    <p class="modal-text">Build a player from scratch, run their career, and see where they land.</p>
    <ol class="howto-list">
      <li><b>Pick your shadow.</b> Choose an all-time great to measure yourself against. The <b>Chasing the Shadow</b> tracker compares your final stats to theirs, category by category.</li>
      <li><b>Name your player.</b></li>
      <li><b>Make 8 attribute picks</b> — Height, Athleticism, and the five skills. Each pick spins up a scouted team, and you buy from that team's roster. Every player costs cap space against one shared <b>$100M budget</b>, so a max-rated pick early means bargain-bin picks later.</li>
      <li><b>Claim trait badges.</b> Some legends carry a signature trait (★). Land one and you choose two to activate for stat bonuses.</li>
      <li><b>Pick a position and a career team.</b> Fitting your position and filling the team's need both help.</li>
      <li><b>Simulate.</b> Watch the career play out season by season, then read the verdict.</li>
    </ol>
    <p class="modal-text">Your career earns a spot on the ladder — awards and rings matter as much as ratings:</p>
    <div class="howto-ladder">${TIERS.map(t => `<span>${t.name}</span>`).join("")}</div>
  `);
  openModal("How to Play", body, null, trigger);
}

// Picks are editable while choosing attributes and on the confirm screen;
// from the career team step onward they lock in for good (Position depends
// on final Height/Athleticism).
function inPickingPhase() {
  const step = STEPS[state.currentStep];
  return step === "height" || step === "athleticism" || step === "confirm" || step === "chooseBadges" || SKILL_ORDER.includes(step);
}

const CATEGORY_LABELS = { height: "Height", athleticism: "Athleticism" };
// Display labels for Signature-Trait stat modifiers.
const STAT_LABEL = { ppg: "PPG", apg: "APG", rpg: "RPG", spg: "SPG", bpg: "BPG", tpg: "3PM", fgPct: "FG%", tptPct: "3PT%" };
const fmtMods = mods => Object.entries(mods).map(([k, v]) => `${STAT_LABEL[k]} +${v}`).join(" · ");
function categoryLabel(cat) { return CATEGORY_LABELS[cat] || cat; }
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

// ---- Trait-pill info tooltip: click-to-toggle (primary), hover-preview (bonus) ----
// The roster list is a scroll container that would clip a CSS ::after tooltip,
// so this floats a single element on <body> positioned to the clicked pill.
// Delegated capture-phase click handling means tapping a pill toggles its info
// WITHOUT the surrounding roster-row button also selecting that player.
let traitTipEl = null;
let pinnedPill = null; // the pill whose tip is "pinned" open by a click/tap

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
    const pill = e.target.closest && e.target.closest(".trait-pill");
    if (pill) { e.preventDefault(); e.stopPropagation(); toggleTraitTip(pill); return; }
    if (!(e.target.closest && e.target.closest(".trait-tip"))) hideTraitTip();
  }, true);
  document.addEventListener("keydown", e => {
    const pill = e.target.closest && e.target.closest(".trait-pill");
    if (pill && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); toggleTraitTip(pill); }
    else if (e.key === "Escape") hideTraitTip();
  }, true);
  // Hover preview (desktop bonus) — only when nothing is pinned by a click.
  document.addEventListener("mouseover", e => {
    const pill = e.target.closest && e.target.closest(".trait-pill");
    if (pill && !pinnedPill) showTraitTip(pill, false);
  });
  document.addEventListener("mouseout", e => {
    const pill = e.target.closest && e.target.closest(".trait-pill");
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
      const badgeLine = b ? `<span class="picks-badge" title="${b.name} — ${b.effect}">★ ${b.name}</span>` : "";
      const row = el("button", "picks-row" + (state.editingCategory === cat ? " editing" : "") + (state.autoPick ? " locked-in" : ""),
        `<span class="picks-cat">${categoryLabel(cat)}</span>
         <span class="picks-player">${pick.name}</span>
         <span class="picks-meta">${pick.team ? pick.team.abbr : "—"} &nbsp;·&nbsp; ${fmtSalary(pick.cost)}</span>
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
    const display = opt.label ? `${opt.label} <span class="sub-rating">${opt.rating}</span>` : opt.rating;
    const row = el("button", "roster-row" + (opt.affordable ? "" : " locked") + (isCurrent ? " current" : ""),
      `<span class="roster-name">${opt.name} <span class="era-tag">${opt.era}</span>${isCurrent ? ' <span class="era-tag current-tag">current</span>' : ""}${traitPillHTML(opt.name, category)}</span>
       <span class="roster-rating">${display}</span>
       <span class="roster-cost">${fmtSalary(opt.cost)}</span>`);
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
  const grid = el("div", "shadow-select");
  SHADOW_ORDER.forEach(name => {
    const t = SHADOW_TARGETS[name];
    // DPOY segment only for legends who actually won one — keeps the common
    // 0-DPOY case from cluttering the line with "0× DPOY".
    const dpoySeg = t.dpoys > 0 ? `${t.dpoys}× DPOY &middot; ` : "";
    const btn = el("button", "shadow-option",
      `<span class="shadow-opt-name">${name}</span>
       <span class="shadow-opt-line">${t.rings}× Ring${t.rings === 1 ? "" : "s"} &middot; ${t.mvps}× MVP &middot; ${dpoySeg}${t.peakPPG} peak PPG</span>`);
    btn.onclick = () => {
      state.shadowTarget = name;
      state.currentStep++;
      render();
    };
    grid.appendChild(btn);
  });
  wrap.appendChild(grid);
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
  ACHIEVEMENTS.forEach(a => {
    const got = !!p.unlocked[a.id];
    grid.appendChild(el("div", "ach-card" + (got ? " unlocked" : " locked"),
      `<span class="ach-icon">${got ? "🏆" : "🔒"}</span>
       <span class="ach-name">${a.name}</span>
       <span class="ach-desc">${a.desc}</span>`));
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

// ---- Shared roster picker (Height, Athleticism, and all 5 skills) ----
// Each pick gets its own independent team spin. Spinning reveals the team's
// FULL roster for the category right away — sorted best to worst, clickable
// to lock in. "Spin Again" (3 shared rerolls per build) sits above the list.
function renderRosterStep(category, title, sub, onLock) {
  // Sandbox browses freely, so there is nothing to spin for: seed a team on
  // entry so a roster is visible straight away and let the dropdown drive.
  if (state.sandbox && !state.scoutTeam) state.scoutTeam = pickRandom(TEAMS);
  const team = state.scoutTeam;
  const rerollsLeft = TEAM_REROLLS - state.teamRerollsUsed;

  const wrap = el("div", "card");
  wrap.appendChild(el("h1", "step-title center", `Pick: ${title}`));
  const teamNote = team
    ? `<span class="scout-team-name">${team.name}</span> legends`
    : "Spin for the franchise you're scouting this pick from.";
  wrap.appendChild(el("p", "step-sub center",
    `${sub} &nbsp;·&nbsp; ${teamNote} &nbsp;·&nbsp; ${state.sandbox ? "Sandbox \u2014 no cap" : state.autoPick ? "No salary cap \u2014 the spin decides" : "Cap space: " + fmtSalary(budgetRemaining())}`));

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
    if (state.autoPick) {
      // the spin IS the pick: assign immediately, skipping any already-used player
      const used = CATEGORIES.map(c => currentPick(c)).filter(Boolean).map(p => p.name);
      autoAssigned = autoAssignPick(category, used);
    }
    render();
  };
  // Sandbox replaces the spin with a browse: team dropdown + league-wide search.
  if (state.sandbox) wrap.appendChild(renderSandboxBrowser(category));
  else wrap.appendChild(spinBtn);

  // ---- Auto-assign mode: the spin picks the player, there is no list ----
  if (state.autoPick) {
    if (!autoAssigned) {
      wrap.appendChild(el("div", "spin-result", team ? "\u2014" : "?"));
    } else {
      const a = autoAssigned;
      const ratingLine = a.label ? `${a.label} <span class="sub-rating">${a.rating}</span>` : a.rating;
      wrap.appendChild(el("div", "auto-pick-card",
        `<div class="ap-team">${a.team.abbr} &middot; ${a.team.name}</div>
         <div class="ap-name">${a.name}</div>
         <div class="ap-meta"><span class="era-tag">${a.era}</span> ${traitPillHTML(a.name, category)}</div>
         <div class="ap-rating">${ratingLine}</div>`));
      const lockBtn = el("button", "btn-primary", "Lock It In \u2192");
      lockBtn.onclick = () => {
        onLock(a);            // a.cost is 0 and carries its own .team
        autoAssigned = null;
        state.scoutTeam = null; // next pick spins its own team
        state.currentStep++;
        render();
      };
      wrap.appendChild(lockBtn);
    }
    app.appendChild(wrap);
    return;
  }

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
    // In sandbox an active search pulls from every team; otherwise the scouted one.
    const q = state.sandbox ? sandboxQuery.trim().toLowerCase() : "";
    const source = q
      ? getAllRosterOptions(category).filter(o => o.name.toLowerCase().includes(q)).slice(0, 50)
      : getRosterOptions(category);
    if (q && !source.length) list.appendChild(el("div", "roster-empty", `No player matches \u201C${sandboxQuery.trim()}\u201D`));
    source.forEach(opt => {
      // Height/Athleticism show their real-world label plus the individual rating;
      // skills show the rating alone.
      const display = opt.label ? `${opt.label} <span class="sub-rating">${opt.rating}</span>` : opt.rating;
      const row = el("button", "roster-row" + (opt.affordable ? "" : " locked"),
        `<span class="roster-name">${opt.name} <span class="era-tag">${opt.era}</span>${q ? ` <span class="era-tag team-tag">${opt.team.abbr}</span>` : ""}${traitPillHTML(opt.name, category)}</span>
         <span class="roster-rating">${display}</span>
         <span class="roster-cost">${fmtSalary(opt.cost)}</span>`);
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
    const display = p.label ? `${p.label} <span class="sub-rating">${p.rating}</span>` : p.rating;
    const row = el("button", "roster-row",
      `<span class="roster-name">${categoryLabel(cat)}: ${p.name} <span class="era-tag">${p.team ? p.team.abbr : "—"}</span></span>
       <span class="roster-rating">${display}</span>
       <span class="roster-cost">${fmtSalary(p.cost)}</span>`);
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
  };
}

// ---- Simulating: animated highlight reel from the real career data ----
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
      const row = el("div", "shadow-track-row");
      row.appendChild(el("span", "stl", r.label));
      const build = el("span", "stb", r.decimals ? "0.0" : "0");
      row.appendChild(build);
      row.appendChild(el("span", "sts", `/ ${cmp.targetLabel} ${r.target.toFixed(r.decimals)}`));
      grid.appendChild(row);
      return { el: build, row, final: r.build, decimals: r.decimals, beat: r.beat };
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
      spans.forEach(s => { s.el.textContent = (s.final * t).toFixed(s.decimals); });
      if (t >= 1) {
        spans.forEach(s => { s.el.textContent = s.final.toFixed(s.decimals); s.row.classList.add(s.beat ? "beat" : "short"); });
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
function renderCareerTeamStep() {
  const posLabel = POSITIONS[state.position].label;
  const wrap = el("div", "card");
  wrap.appendChild(el("h1", "step-title center", "Choose Your Career Team"));
  wrap.appendChild(el("p", "step-sub center",
    `You're a <span class="scout-team-name">${posLabel}</span>. Their supporting cast (SCR) decides your win totals — and a team that <strong>needs a ${posLabel}</strong> gives you a bonus for filling it.`));

  const list = el("div", "roster-list team-list");
  // sort so teams that need YOUR position float to the top
  const sorted = [...TEAMS].sort((a, b) => {
    const am = TEAM_NEEDS[a.abbr] === state.position ? 0 : 1;
    const bm = TEAM_NEEDS[b.abbr] === state.position ? 0 : 1;
    return am - bm || b.scr - a.scr;
  });
  sorted.forEach(team => {
    const need = TEAM_NEEDS[team.abbr];
    const match = need === state.position;
    const row = el("button", "roster-row team-row" + (match ? " need-match" : ""),
      `<span class="roster-name">${team.name} <span class="era-tag">${team.abbr}</span></span>
       <span class="team-need${match ? " match" : ""}">need a ${POSITIONS[need].label}${match ? " ✓" : ""}</span>
       <span class="roster-rating">${team.scr}</span>`);
    row.onclick = () => {
      state.team = team;
      state.teamNeedMet = match;
      state.currentStep++;
      render();
    };
    list.appendChild(row);
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

  // Achievement toast: only for a real playthrough that unlocked something new.
  // A shared ?build= view never records, so runUnlocks is empty there.
  if (!state.sharedView && runUnlocks.length) {
    const toast = el("div", "ach-toast");
    toast.appendChild(el("div", "ach-toast-head",
      `🏆 Achievement${runUnlocks.length > 1 ? "s" : ""} Unlocked`));
    const names = el("div", "ach-toast-names");
    runUnlocks.forEach(a => names.appendChild(el("span", "ach-toast-pill", a.name)));
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
    const grid = el("div", "shadow-cmp-grid");
    shadow.rows.forEach(r => {
      const cell = el("div", "shadow-cmp" + (r.beat ? " beat" : " short"));
      cell.innerHTML =
        `<span class="scl">${r.label}</span>
         <span class="scv">${r.build.toFixed(r.decimals)} <span class="scvs">/ ${r.target.toFixed(r.decimals)}</span></span>
         <span class="scm">${r.beat ? "✓" : "✕"}</span>`;
      grid.appendChild(cell);
    });
    box.appendChild(grid);
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

  wrap.appendChild(el("div", "seasons-line", `${career.numSeasons} season${career.numSeasons === 1 ? "" : "s"} &middot; Peak OVR ${career.peakOVR} &middot; GOAT Score ${career.goatScore}`));

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
  yearPanel.appendChild(el("div", "season-panel-head",
    `All ${career.numSeasons} Seasons &nbsp;·&nbsp; ${state.team.name}`));
  career.seasons.forEach((s, i) => {
    const st = s.stats;
    const honors = [
      s.mvp ? '<span class="sp-tag mvp">MVP</span>' : "",
      s.ring ? '<span class="sp-tag ring">CHAMPION</span>' : "",
      s.roty ? '<span class="sp-tag roty">ROTY</span>' : "",
      s.dpoy ? '<span class="sp-tag dpoy">DPOY</span>' : "",
      s.allNBA ? `<span class="sp-tier tier-${s.allNBA.replace(/\D/g, "")}">All-NBA ${s.allNBA}</span>` : "",
      s.allDefensive ? `<span class="sp-tag alldef">ALL-DEF ${s.allDefensive}</span>` : "",
      s.allStar ? '<span class="sp-tag allstar">ALL-STAR</span>' : "",
    ].join("");
    yearPanel.appendChild(el("div", "season-row",
      `<span class="sp-year">Year ${i + 1}</span>
       <span class="sp-team">${state.team.abbr}</span>
       ${honors}
       <span class="sp-line">${st.ppg} PPG &middot; ${st.rpg} RPG &middot; ${st.apg} APG &middot; ${st.spg} SPG &middot; ${st.bpg} BPG &middot; ${st.tpg} 3PM &middot; ${st.fgPct} FG% &middot; ${st.tptPct} 3PT%</span>`));
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
    ["Height", `${state.height.name} (${state.height.label})`, state.height.rating, fmtSalary(state.height.cost)],
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
    `Position: ${state.position} (${POSITIONS[state.position].label}) — ${state.positionFit ? "Fit ✓" : "Anomaly ⚡"}${needNote} &nbsp;·&nbsp; ${state.sandbox ? "Sandbox \u2014 no salary cap" : state.autoPick ? "No salary cap \u2014 players auto-assigned" : `Salary committed: ${fmtSalary(state.budgetSpent)} of ${fmtSalary(BUDGET_CAP)}`}`));

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
  state.teamNeedMet = TEAM_NEEDS[state.team.abbr] === data.p;
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
  state.editingCategory = null;
  state.seed = null;
  state.sharedView = false;
  state.sandbox = false; // never leak sandbox rules into a real playthrough
  state.autoPick = false;
  sandboxQuery = "";
  autoAssigned = null;
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
