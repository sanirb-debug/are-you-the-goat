# Are You the GOAT? 🐐

Build a Frankenstein NBA player one wheel spin at a time, drop them on a random team, and simulate their entire career to see how close they get to the Mount Rushmore of basketball.

## How it works

1. **Name your player**
2. **Spin Height, then Body Frame** — sets your player's physical identity first
3. **Spin the 5 skill wheels** (Shooting, Finishing, Playmaking, Defense, Rebounding) against a **100-point budget cap** — you can't max every category, and you've got **3 total rerolls** to use wherever you want
4. **Choose a position** — fit your build for a bonus, or gamble on a positional anomaly
5. **Spin for a team** — you're randomly dropped onto one of 30 rosters
6. **Simulate the career** — 8–18 seasons of wins, playoffs, and awards
7. **Get the Verdict** — tier ladder (Draft Bust → Bench Piece → Starter → All-Star → Superstar → Legend → GOAT), percentile rank, career totals, and a recap headline

Full design doc with all formulas: see `/docs` (or the original brainstorm PDF).

## Running it locally

No build step — it's plain HTML/CSS/JS.

```bash
# from the project folder
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` directly in a browser.

## Project structure

```
├── index.html      # entry point
├── style.css        # dark navy/gold theme
├── data.js           # player pools, teams, positions
├── game.js           # core game logic (wheels, budget, sim, GOAT score)
├── ui.js              # DOM rendering + step controller
```

## Formulas at a glance

- **Wheel cost**: `round(rating × 0.15)` — spent against a 100-pt cap
- **Height/Frame modifiers**: nudge Shooting/Finishing/Playmaking/Defense/Rebounding up or down based on how extreme the build is
- **OVR**: weighted average of the 5 final skills + Height/Frame + position fit bonus
- **Season wins**: `41 + (OVR-75)×0.9 + (SCR-60)×0.35 + variance`
- **GOAT Score**: `PeakOVR×4 + Rings×15 + MVPs×12 + FinalsMVPs×10 + AllNBA×3 + AllStars×1 + CareerWins/10`

## Status

🚧 v1 prototype — core loop is playable, no backend, no accounts. Personal best stored in browser localStorage.

## Roadmap ideas

- Shareable verdict card export
- Achievement badge polish
- Daily theme mode (rotating constraints)
- Historical benchmark comparisons (peak Jordan, peak Wilt run through the same formula)
- Alt draft mode (manual point-cap draft instead of wheel spins)
