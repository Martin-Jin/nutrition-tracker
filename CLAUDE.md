# Nutrition Calculator — Working Agreement

Personal nutrition planning tool: a DRI (Dietary Reference Intake) requirements
workbook, a USDA-sourced food catalogue, and a static HTML/JS/CSS web app that
solves for which combinations of on-hand foods meet daily nutrient targets.
No build step. Correctness check after any change to `data/*.json` or
`scripts/*.py`: re-run the fetch/build script and confirm it exits 0 with the
printed row counts unchanged or explained. Correctness check after any change
to `app/*.js`: open `app/index.html` via a local static server and confirm the
browser console is free of errors on all five views (landing, calculator,
catalogue, requirements, profile).

## First-time setup

Broad allowlist for this project — low-stakes personal tool, single user, no
production deployment. Standard bash/git/gh read+write commands should not
prompt per-call. Destructive/remote operations (force-push, `gh repo delete`,
history rewrite) still confirm — see the explicit `deny` list below.

**Settings shape:** single file, `.claude/settings.json` (no
`settings.local.json`) — this is a genuinely solo project with no CI running
Claude Code against it, so there's no need to split a personal/broad mode out
from a shared/reviewable one. `defaultMode` is `acceptEdits` (not
`bypassPermissions`) with a broad `allow` list plus an explicit `deny` list
covering force-push, hard reset, interactive rebase, history rewrite, `gh
repo/release delete`, and `rm -rf` — this project intentionally keeps those
denied rather than going fully permission-less. If a second contributor or
any automated/CI use of Claude Code is ever added, split personal-only allow
entries (and any move toward `bypassPermissions`) into a gitignored
`settings.local.json` at that point.

**One-time tool installs beyond `pip`/no-install-JS:** Playwright (used for
in-browser console-error verification per the Testing section) needs its
browser binary fetched separately from the npm package:
`npx playwright install chromium`. This installs to a cache directory outside
any `node_modules` here — a fresh clone or container needs to re-run it, `npm
install` alone won't restore it. There's no `package.json` in this repo
tracking `playwright` as a dependency; it's installed ad hoc into the
scratchpad/temp working area per session, not into the project itself.

**Gitignore:** `.claude/` (settings, skills, local session state) and
`.env` are already gitignored (see `.gitignore`) — keep it that way. Nothing
CLAUDE.md-adjacent should be tracked beyond this file itself.

## Model usage (token efficiency)

Default: mid-tier model (Sonnet) for the main session. No subagent tiering
needed at this project's current size — it's a single-developer static app
with a couple of Python data scripts, not a multi-agent workflow. If it grows
enough to warrant delegation, decide tiers then rather than pre-provisioning.
If tiering is introduced later, the one concrete danger zone in this codebase
is the LP-solver math in `app/app.js` (`buildLPModel`, gram-limit/UL
constraint wiring, solution-dedup threshold logic) — a wrong first pass there
is expensive to unwind (silently wrong nutrient combinations, not a crash),
so that's the one place worth the expensive tier over the default. Everything
else here (rendering, catalogue/CRUD, data fetch scripts) is normal-tier work.

## Git workflow

- Never commit directly to `main`. One branch per unit of work
  (`feat/...`, `fix/...`).
- Commit as often as useful while iterating; squash fixups into the commit
  they belong to before merging.
- Squash-merge to `main` with a message describing *why*, delete the branch
  after.
- No separate deploy target yet — local git history and GitHub `origin` are
  the same history. If a hosted deployment (e.g. GitHub Pages) is added
  later, note here how it relates (build artifact vs. same source tree).
- Authorship: commits pushed on the user's behalf show the user as sole
  author — no co-author trailer unless asked.
- Single-developer project — no concurrent-session worktree concerns
  expected. If that ever changes (a second contributor, or two agent
  sessions against this checkout at once), check `git worktree list` and
  `git status` for unrecognized changes before branching, and create a
  separate worktree (`git worktree add ../<name> -b <branch>`) rather than
  branching in the shared directory — plain `git checkout` there would carry
  another session's uncommitted changes along with it.

## Changelog / versioning

No formal version scheme yet (no releases, no package manifest consumers).
If this becomes a published or shared tool, adopt semver at that point and
record where the version string must stay in sync (this section will need
updating then). Until then, skip changelog upkeep.

## Development practices

- Read a file before editing it — never reconstruct from memory.
- No linter/formatter configured. Match surrounding style by eye: 2-space
  indent in JS/HTML/CSS, 4-space in Python, straightforward ES6 (no build
  transpilation — the app runs directly in a browser via `<script>` tags).
- Small personal-scale project: prefer the direct implementation over
  speculative abstraction. No config plumbing "for later."
- Never commit API keys/credentials in plaintext. The USDA FoodData Central
  key in use is the public rate-limited `DEMO_KEY` — fine to commit, but if
  a real API key is ever substituted, move it to an untracked `.env` /
  local-only file first.
- UI must be usable on mobile (single-column layouts already in the design;
  don't regress this when adding views).
- Before changing `app/data/dri.json` or `app/data/food_catalogue.json`
  shape, check every place in `app/app.js` and `scripts/build_workbook.py`
  that reads those fields — both consume the same files and must stay in
  sync (see Cross-cutting concerns below). This is the general rule for any
  change to something with dependents in this repo, not just the data files:
  check callers before changing a shared shape.
- Deletions: move removed files to a `deleted/` folder mirroring their
  original path rather than `rm`, so a wrong removal is recoverable.

### Cross-cutting concerns

This project has one real cross-cutting system: **the nutrient data
pipeline**, which fans out from a single source into three consumers that
must stay numerically identical.

- **Owns it:** `app/data/` is the single source of truth — both
  `scripts/fetch_foods.py` (catalogue) and `scripts/build_dri.py` (requirements)
  write directly there, and `app/app.js` fetches straight from it at runtime.
  There is no separate root-level `data/` copy; don't reintroduce one, it
  drifts. `app/data/food_catalogue.csv` is a plain-text export of the same
  catalogue. `scripts/build_workbook.py` also reads from `app/data/` to build
  `nutrition_workbook.xlsx`.
- **Silently breaks if forgotten:** adding/renaming a nutrient key in one
  consumer without updating the others causes silent `undefined`/blank cells
  rather than an error — nothing crashes, values just go missing.
- **Watch for:** adding a new nutrient field, changing a unit (e.g. mg → µg),
  or changing which foods are "trackable" (see iodine/biotin note below) —
  these change the data shape all three consumers assume.

### Known, deferred issues

- **Iodine and biotin have zero USDA SR Legacy coverage** (verified: 0/200
  sampled foods carry either nutrient). These are marked `trackable: false`
  in `data/dri.json` and excluded from the solver's pass/fail logic —
  otherwise every combination would be reported infeasible, always, on these
  two nutrients alone. Shown to the user separately as "not tracked — no
  USDA data" rather than silently dropped. Do not re-enable them for the
  solver without first sourcing real per-food values from elsewhere.
- **Vitamin D, B12, choline, vitamin K, selenium** have sparse (not absent)
  coverage in SR Legacy. A food missing one of these stores `null`, not `0`
  — the app must keep treating "no data" and "zero" as visually distinct.
  This was deliberately deferred rather than backfilled with estimates,
  per the user's "never guess a nutrient value" rule.

### Data retention

No database, no unbounded storage. `localStorage` holds only the current
user's profile + DRI overrides (small, fixed-size, single user) — no
retention policy needed. `.cache/` (raw USDA API pages) is a local build
cache, safe to delete anytime, and is gitignored.

## Testing

No automated test suite. Correctness bar per change:
- Data/script change → re-run the script, confirm exit 0 and sane row counts.
- App change → load in a real browser (not just a static read of the HTML),
  exercise the affected view, confirm no console errors. Given this is a
  handful of interactive views, not a deep multi-step flow, manual
  browser-based verification is the right level — full E2E automation would
  be overkill for this project's size.
- Before declaring the solver "done," run the three cases from the build
  plan: a food set that should succeed, one that should fail, and a check
  that iodine/biotin never appear as a false shortfall.
- If a check seems flaky rather than genuinely broken, re-run it up to three
  times total before concluding either way — don't loop indefinitely
  chasing a clean signal.

## Design direction

Palette and typography are fixed (see `app/styles.css`): warm paper
background, deep forest green + brick + gold accents, Source Serif 4 for
headings, IBM Plex Sans for body, IBM Plex Mono for numeric/data display.
Hierarchy comes from type weight and hairline rules, not shadows or cards
stacked on cards.

**Never violate:**
- Never render a missing nutrient value as `0` or blank — always show it as
  "no data" (see iodine/biotin issue above); collapsing that distinction
  breaks the solver's correctness, not just the display.
- Never invent/guess a nutrient number to fill a gap — cite USDA FoodData
  Central or state it's missing.

**Deliberately not doing:**
- Not building a backend/database — static JSON + client-side JS is
  sufficient for a single-user local tool.
- Not adding a JS build pipeline (webpack/vite/etc.) — plain `<script>` tags
  are adequate at this scale and keep the project runnable with zero install.

## Code review checklist

- Idiomatic vanilla JS/Python for this stack — no framework dependencies
  introduced without discussion.
- Comments explain non-obvious *why* (e.g. why iodine is excluded from the
  solver), not restating the code.
- No duplicated nutrient-formatting or DRI-lookup logic — reuse the existing
  helpers in `app/app.js` rather than re-deriving them.
- Any one-off migration/fetch script is left in `scripts/` only while still
  needed to regenerate data; note in its header if/when it becomes obsolete.
- No dead code left behind (e.g. the old grid-search solver once the LP
  solver replaces it).
- Every consumer of `data/*.json` listed above actually re-checked after a
  schema change, not just the one being edited.
- No secrets committed in plaintext.
