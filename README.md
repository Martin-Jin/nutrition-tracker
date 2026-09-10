# Harvest Ledger — Nutrition Calculator

A personal nutrition planning tool: a DRI (Dietary Reference Intake)
requirements workbook, a USDA-sourced food catalogue, and a static
HTML/JS/CSS web app that solves for which combinations of on-hand foods meet
daily nutrient targets.

**Live app:** deployed via GitHub Pages from `app/` — see the "Deployments"
section on the repo page, or the Actions tab for the current URL.

## What it does

- **Calculator** — pick foods you have on hand and the app solves for a
  combination that meets your daily nutrient requirements.
- **Food Catalogue** — a curated set of common foods (meats, vegetables,
  fruits, nuts) with full nutrient profiles sourced from USDA FoodData
  Central (SR Legacy).
- **Requirements** — DRI values across all nutrients and life stages.
- **Profile** — set age, sex, weight, height, and activity level to resolve
  your personal daily targets; stored locally in your browser only.

## Project structure

```
app/            Static web app (open app/index.html — no build step)
  data/         Single source of truth: dri.json, food_catalogue.json/.csv
scripts/        Python scripts that fetch/build app/data/ and the workbook
nutrition_workbook.xlsx   Offline Excel version of the same data
```

## Running locally

No build step — serve `app/` with any static file server and open it in a
browser:

```
cd app
python -m http.server 8000
# open http://localhost:8000
```

## Regenerating data

```
python scripts/fetch_foods.py     # rebuilds app/data/food_catalogue.json/.csv
python scripts/build_workbook.py  # rebuilds nutrition_workbook.xlsx
```

`fetch_foods.py` uses the USDA FoodData Central API. Set `FDC_API_KEY` for a
real key, or it falls back to the public, heavily rate-limited `DEMO_KEY`.

## Data integrity notes

- Every nutrient value comes directly from USDA FoodData Central — nothing
  is estimated or guessed. A missing value is stored as `null` ("no data"),
  never `0`.
- Iodine and biotin have no USDA SR Legacy coverage and are excluded from
  the solver's pass/fail logic (shown separately as "not tracked").
- Vitamin D, B12, choline, vitamin K, and selenium have sparse (not absent)
  coverage — the app preserves the distinction between "no data" and "zero."

## Tech

Vanilla HTML/CSS/JS (no framework, no build pipeline), Python data scripts,
static JSON as the data layer. No backend, no database — this is a
single-user, client-side tool.
