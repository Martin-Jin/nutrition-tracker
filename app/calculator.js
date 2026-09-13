// ============================================================================
// CALCULATOR: LP-based combination solver
// ============================================================================
// Each selected food is a continuous variable: grams used, bounded only by
// [0, unbounded) -- foods are treated as purchasable in any amount, not
// capped to what the user has on hand. Constraints: for every trackable
// nutrient with a target, floor_pct% * target <= sum(food_nutrient_per_g *
// grams) <= ceiling. Ceiling is either an explicit UL (ul_value) or
// ceiling_pct% * target, else unbounded. We solve the same LP with a few
// different objectives (minimize total grams, minimize kcal, maximize
// distinct-food variety) to surface multiple genuinely distinct solutions,
// per spec ("show them all as a list").

function buildLPModel(selectedNames, targets, uls, objectiveType, calorieTarget){
  const variables = {};
  const constraints = {};

  TRACKABLE_KEYS.forEach(key => {
    const target = targets[key];
    if(target === null || target === undefined) return;
    const { floor_pct, ceiling_pct } = resolveNutrientBuffer(key);
    const floorPct = floor_pct / 100;
    constraints[`min_${key}`] = { min: target * floorPct };
    const ceilVal = uls[key] !== undefined ? uls[key] : (ceiling_pct ? target * (ceiling_pct/100) : null);
    if(ceilVal !== null && ceilVal !== undefined){
      constraints[`max_${key}`] = { max: ceilVal };
    }
  });

  // Calorie target isn't a DRI nutrient row -- it's estimated from the
  // profile (Mifflin-St Jeor) -- so it's constrained separately here rather
  // than through the TRACKABLE_KEYS loop above. Only enforced when a profile
  // estimate exists; without one there's nothing to band against.
  if(calorieTarget){
    constraints.min_kcal = { min: calorieTarget * 0.9 };
    constraints.max_kcal = { max: calorieTarget * 1.1 };
  }

  selectedNames.forEach(name => {
    const food = FOODS.find(f => f.name === name);
    const varDef = { total_grams: 1 };
    TRACKABLE_KEYS.forEach(key => {
      const perGram = (food[key] || 0) / 100;
      varDef[`min_${key}`] = perGram;
      varDef[`max_${key}`] = perGram;
      // Same per-gram contribution, reused by bestEffortUsage's "maximize
      // coverage toward each floor" objective -- kept separate from
      // min_/max_ so deleting the min_ constraints there doesn't also
      // remove the coefficients the coverage objective needs.
      varDef[`cov_${key}`] = perGram;
    });
    varDef.kcal_obj = (food.kcal || 0) / 100;
    if(calorieTarget){
      const kcalPerGram = (food.kcal || 0) / 100;
      varDef.min_kcal = kcalPerGram;
      varDef.max_kcal = kcalPerGram;
    }
    // Per-food gram cap (manual override, else its category default, else
    // unbounded) -- modeled as its own single-variable constraint rather than
    // a shared one, since each food's cap is independent of every other
    // food's.
    const gramLimit = resolveGramLimit(food);
    if(gramLimit !== null && gramLimit > 0){
      const capKey = `cap_${name}`;
      varDef[capKey] = 1;
      constraints[capKey] = { max: gramLimit };
    }
    variables[name] = varDef;
  });

  const model = {
    optimize: objectiveType === 'kcal' ? 'kcal_obj' : 'total_grams',
    opType: 'min',
    constraints,
    variables,
  };
  return model;
}

function computeTotalsFromUsage(usage){
  const totals = {}; TRACKABLE_KEYS.forEach(k => totals[k]=0); totals.kcal = 0;
  Object.entries(usage).forEach(([name, grams]) => {
    if(grams <= 1e-6) return;
    const food = FOODS.find(f => f.name === name);
    const factor = grams/100;
    TRACKABLE_KEYS.forEach(k => totals[k] += (food[k]||0)*factor);
    totals.kcal += (food.kcal||0)*factor;
  });
  return totals;
}

function solutionSignature(usage){
  return Object.entries(usage).filter(([,g]) => g > 0.5).map(([n,g]) => `${n}:${Math.round(g)}`).sort().join('|');
}

// Two solutions count as "the same combination" (not worth showing both) when
// they use the same set of foods and every food's gram amount is within 20%
// of the other solution's amount for that food. A differing food set is
// always a genuinely distinct combination regardless of gram closeness.
function solutionsAreSimilar(usageA, usageB, threshold = 0.2){
  const namesA = Object.keys(usageA).filter(n => usageA[n] > 0.5).sort();
  const namesB = Object.keys(usageB).filter(n => usageB[n] > 0.5).sort();
  if(namesA.length !== namesB.length) return false;
  for(let i = 0; i < namesA.length; i++){
    if(namesA[i] !== namesB[i]) return false;
  }
  return namesA.every(name => {
    const gA = usageA[name], gB = usageB[name];
    const denom = Math.max(gA, gB);
    return denom === 0 || Math.abs(gA - gB) / denom <= threshold;
  });
}

function setCalcTab(tab){
  document.querySelectorAll('.calc-tab').forEach(b => b.classList.toggle('active', b.dataset.calctab === tab));
  document.getElementById('calcTabSelect').classList.toggle('active', tab === 'select');
  document.getElementById('calcTabSettings').classList.toggle('active', tab === 'settings');
  document.getElementById('calcTabResults').classList.toggle('active', tab === 'results');
  if(tab === 'settings'){ renderCategoryLimitsList(); renderFoodLimitsList(); renderNutrientBufferList(); }
}

// ============================================================================
// CALCULATOR: serving-limit settings (category defaults + per-food overrides)
// ============================================================================
function renderCategoryLimitsList(){
  const container = document.getElementById('categoryLimitsList');
  if(!container) return;
  const catsPresent = GRAM_LIMIT_CATEGORIES.filter(cat => FOODS.some(f => f.category === cat));
  container.innerHTML = catsPresent.map(cat => {
    const val = state.categoryGramLimits[cat];
    return `<div class="field-row">
      <label>${cat}</label>
      <div>
        <input type="number" min="0" step="any" placeholder="no limit" value="${val ?? ''}"
          onchange="onCategoryLimitChange('${escName(cat)}', this.value)">
        <div class="field-hint">grams per food, per day</div>
      </div>
    </div>`;
  }).join('');
}

function onCategoryLimitChange(category, value){
  if(value === ''){ delete state.categoryGramLimits[category]; }
  else { state.categoryGramLimits[category] = value; }
  saveState();
}

function renderFoodLimitsList(){
  const container = document.getElementById('foodLimitsList');
  if(!container) return;
  const q = (document.getElementById('foodLimitSearch').value || '').toLowerCase();
  const list = FOODS.filter(f => f.enabled && !f.hiddenByVariant && (!q || foodMatchesQuery(f, q)));
  if(list.length === 0){
    container.innerHTML = '<div class="field-hint">No foods match your search.</div>';
    return;
  }
  container.innerHTML = list.map(f => {
    const override = state.foodGramLimits[f.name];
    const catDefault = state.categoryGramLimits[f.category];
    const placeholder = (catDefault !== undefined && catDefault !== null && catDefault !== '') ? `category: ${catDefault}g` : 'no limit';
    return `<div class="field-row">
      <label>${f.name} <span class="field-hint" style="display:block;">${f.category}</span></label>
      <div>
        <input type="number" min="0" step="any" placeholder="${placeholder}" value="${override ?? ''}"
          onchange="onFoodLimitChange('${escName(f.name)}', this.value)">
      </div>
    </div>`;
  }).join('');
}

function onFoodLimitChange(name, value){
  if(value === ''){ delete state.foodGramLimits[name]; }
  else { state.foodGramLimits[name] = value; }
  saveState();
}

// Short per-nutrient note explaining WHY its default buffer is what it is,
// shown next to the override inputs -- without this the widened macro
// buffers (70-150%) look arbitrary next to everything else's 90-110%.
const NUTRIENT_BUFFER_NOTES = {
  protein_g: 'AMDR (10–35% of energy, NASEM) reflects broad tolerance for total protein intake — wider default than a micronutrient floor.',
  carb_g: 'AMDR (45–65% of energy, NASEM) reflects broad tolerance for total carbohydrate intake — wider default than a micronutrient floor.',
  fat_g: 'AMDR (20–35% of energy, NASEM) reflects broad tolerance for total fat intake — wider default than a micronutrient floor.',
  sodium_mg: "Ceiling here is the CDRR (Chronic Disease Risk Reduction Intake), based on cardiovascular/blood-pressure outcome evidence — NASEM's 2019 DRI report found insufficient evidence for a toxicological UL for sodium.",
};

function renderNutrientBufferList(){
  const container = document.getElementById('nutrientBufferList');
  if(!container || !DRI) return;
  container.innerHTML = TRACKABLE_KEYS.map(key => {
    const nd = DRI.nutrients[key];
    const override = state.nutrientBufferOverrides[key] || {};
    const note = NUTRIENT_BUFFER_NOTES[key];
    const hasUl = Object.values(nd.ul_value || {}).some(v => v !== null && v !== undefined);
    return `<div class="field-row">
      <label>${nd.label}${hasUl ? ` <span class="field-hint" style="display:block;">has a ${nd.ul_type === 'CDRR' ? 'CDRR' : 'UL'} — always kept as the hard ceiling regardless of this setting</span>` : ''}${note ? `<span class="field-hint" style="display:block;">${note}</span>` : ''}</label>
      <div style="display:flex; gap:8px; align-items:center;">
        <input type="number" min="0" max="100" step="any" placeholder="${nd.floor_pct ?? 90}" value="${override.floor_pct ?? ''}"
          style="width:70px;" title="Floor %" onchange="onNutrientBufferChange('${escName(key)}', 'floor_pct', this.value)">
        <span class="field-hint">floor%</span>
        <input type="number" min="100" step="any" placeholder="${nd.ceiling_pct ?? '—'}" value="${override.ceiling_pct ?? ''}"
          style="width:70px;" title="Ceiling %" ${hasUl ? 'disabled' : ''} onchange="onNutrientBufferChange('${escName(key)}', 'ceiling_pct', this.value)">
        <span class="field-hint">ceiling%</span>
      </div>
    </div>`;
  }).join('');
}

function onNutrientBufferChange(key, field, value){
  const entry = state.nutrientBufferOverrides[key] || {};
  if(value === ''){ delete entry[field]; }
  else { entry[field] = value; }
  if(Object.keys(entry).length === 0){ delete state.nutrientBufferOverrides[key]; }
  else { state.nutrientBufferOverrides[key] = entry; }
  saveState();
}

function resetNutrientBuffers(){
  state.nutrientBufferOverrides = {};
  saveState();
  renderNutrientBufferList();
  showToast('Nutrient buffers reset to defaults');
}

function runCalculation(){
  const names = Object.keys(state.selectedFoods).filter(name => {
    const food = FOODS.find(f => f.name === name);
    return food && food.enabled && !food.hiddenByVariant;
  });
  const resultsPanel = document.getElementById('resultsPanel');
  setCalcTab('results');
  if(names.length === 0){
    resultsPanel.innerHTML = '<div class="empty-state">Select at least one enabled food first.</div>';
    return;
  }
  const { stage, targets, uls } = getTargets();
  if(!stage){
    resultsPanel.innerHTML = '<div class="empty-state">No matching life-stage target found — check your profile.</div>';
    return;
  }

  if(typeof window.solver === 'undefined'){
    resultsPanel.innerHTML = '<div class="empty-state">Solver library failed to load (check your connection) — cannot calculate combinations.</div>';
    return;
  }

  // Weight/height/age in the profile drive a maintenance-calorie estimate;
  // without them there's no sane band to enforce, so kcal goes unconstrained
  // (buildLPModel treats a falsy calorieTarget as "don't constrain kcal").
  const calorieTarget = estimateCalorieTarget(state.profile);

  // Try a few objectives to surface multiple distinct feasible solutions.
  const objectives = ['grams', 'kcal'];
  const solutions = [];
  const seen = new Set();

  objectives.forEach(obj => {
    const model = buildLPModel(names, targets, uls, obj, calorieTarget);
    let result;
    try{
      result = window.solver.Solve(model);
    }catch(e){
      console.error('LP solve failed', e);
      return;
    }
    if(!result || !result.feasible) return;
    const usage = {};
    names.forEach(name => { usage[name] = result[name] || 0; });
    const sig = solutionSignature(usage);
    if(sig && !seen.has(sig)){
      seen.add(sig);
      solutions.push({ usage, totals: computeTotalsFromUsage(usage) });
    }
  });

  // Also try single-food and small-subset solves so we surface genuinely
  // different combinations, not just the same subset under two objectives.
  if(names.length > 1){
    for(let i = 0; i < names.length && solutions.length < 8; i++){
      const subset = names.filter((_, idx) => idx !== i);
      if(subset.length === 0) continue;
      const model = buildLPModel(subset, targets, uls, 'grams', calorieTarget);
      let result;
      try{ result = window.solver.Solve(model); } catch(e){ continue; }
      if(!result || !result.feasible) continue;
      const usage = {};
      subset.forEach(name => { usage[name] = result[name] || 0; });
      const sig = solutionSignature(usage);
      if(sig && !seen.has(sig)){
        seen.add(sig);
        solutions.push({ usage, totals: computeTotalsFromUsage(usage) });
      }
    }
  }

  if(solutions.length > 0){
    // Solutions found under different objectives/subsets can still land on
    // essentially the same combination (same foods, gram amounts a few
    // percent apart) -- collapse those before showing the list.
    const distinctSolutions = [];
    solutions.forEach(sol => {
      const dupe = distinctSolutions.some(kept => solutionsAreSimilar(kept.usage, sol.usage));
      if(!dupe) distinctSolutions.push(sol);
    });
    renderSuccessResults(distinctSolutions, targets, uls, calorieTarget);
    return;
  }

  // Infeasible: solve the "use everything you have, minimize shortfall"
  // relaxation to report best-effort coverage, then rank gap-filling foods.
  renderInfeasibleResults(names, targets, uls, calorieTarget);
}

function renderSuccessResults(solutions, targets, uls, calorieTarget){
  const panel = document.getElementById('resultsPanel');
  let html = `<h3 style="margin-bottom:14px;">✓ ${solutions.length} combination${solutions.length>1?'s':''} that meet${solutions.length>1?'':'s'} all your daily targets</h3>`;
  if(!calorieTarget){
    html += `<div class="field-hint" style="margin-bottom:14px;">Enter your weight, height and age in your profile to also enforce a maintenance-calorie band (90%–110%) on these combinations.</div>`;
  }
  solutions.forEach((sol, idx) => {
    const items = Object.entries(sol.usage).filter(([,g]) => g > 0.5);
    const maxGrams = Math.max(...items.map(([,g]) => g), 1);
    const badgeLabel = calorieTarget ? 'meets all targets, incl. calories (90%–110% band)' : 'meets all targets (90%–110% band)';
    html += `<div class="combo-card status-full" onmouseenter="showComboPie(this, ${idx})" onmouseleave="hideComboPie(this)">
      <div class="combo-title">
        <span>Combination ${idx+1}</span>
        <span class="combo-badge badge-full">${badgeLabel}</span>
      </div>
      <div class="combo-items">
        ${items.map(([name, g]) => {
          const pct = Math.max((g / maxGrams) * 100, 2);
          return `<div class="combo-item-row">
            <span class="combo-item-name">${name}</span>
            <span class="combo-item-track"><span class="combo-item-fill" style="width:${pct}%"></span></span>
            <span class="combo-item-qty">${Math.round(g)} g</span>
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:12px; font-size:12px; color:var(--ink-soft);">Total: ${Math.round(sol.totals.kcal)} kcal${calorieTarget ? ` (target ${Math.round(calorieTarget)} kcal)` : ''}</div>
      <div class="combo-pie-popover"></div>
    </div>`;
  });
  panel.innerHTML = html;
  window.__lastSolutions = solutions;
}

// Nutrient-composition pie shown on hover over a combination card: each
// TRACKABLE_KEYS nutrient's share of that combination's total, normalized to
// the DRI daily target so nutrients of very different units (mg vs µg vs g)
// are still comparable slices of "how much of today's need this combo
// covers." Built lazily on hover rather than for every card up front --
// there can be several combinations, and most are never hovered.
function showComboPie(cardEl, idx, isBestEffort){
  const source = isBestEffort ? window.__lastBestEffortCombos : window.__lastSolutions;
  const sol = source && source[idx];
  if(!sol) return;
  const targets = isBestEffort ? window.__lastBestEffortTargets : getTargets().targets;
  const slices = [];
  const palette = ['#1F3A2E','#A8462F','#C89B3C','#5B4E9E','#2E7D4F','#B4772A','#5B5748','#2E5442','#C25A3F','#8C7A3C'];
  let colorIdx = 0;
  TRACKABLE_KEYS.forEach(key => {
    const target = targets[key];
    const have = sol.totals[key] || 0;
    if(!target || have <= 0) return;
    slices.push({ label: DRI.nutrients[key].label, value: have / target, color: palette[colorIdx++ % palette.length] });
  });
  const popover = cardEl.querySelector('.combo-pie-popover');
  if(!popover) return;
  if(slices.length === 0){
    popover.innerHTML = '<div class="field-hint">No nutrient data to chart.</div>';
  } else {
    popover.innerHTML = `
      <div class="pie-chart-row">
        ${svgPieChart(slices, { size: 150 })}
        <div class="pie-legend">
          ${slices.map(s => `<div class="pie-legend-row"><span class="pie-swatch" style="background:${s.color}"></span>${s.label}</div>`).join('')}
        </div>
      </div>
      <div class="field-hint" style="margin-top:8px;">Each slice is this combination's share of your daily target for that nutrient — larger slices are nutrients this combination contributes most of.</div>
    `;
  }
  popover.classList.add('show');
}

function hideComboPie(cardEl){
  const popover = cardEl.querySelector('.combo-pie-popover');
  if(popover) popover.classList.remove('show');
}

// Best-effort relaxation when no feasible combination exists: maximize
// coverage toward each nutrient's floor rather than requiring all of them at
// once. Used only to report "how close can we get" -- there's no "amount on
// hand" to fall back to now that foods are unbounded, so an infeasible
// result here means the selected foods' nutrient ratios can never satisfy
// every target simultaneously, not that the user doesn't have enough of
// something.
function buildCoverageModel(names, targets, uls, calorieTarget){
  const model = buildLPModel(names, targets, uls, 'grams', calorieTarget);
  // The floor (min_) constraints are exactly what made the original solve
  // infeasible, so they're dropped here -- but simply dropping them and
  // minimizing total grams (the model's normal objective) has a trivial
  // optimum of zero grams of everything, which is why this used to report a
  // flat 0% on every nutrient regardless of what was actually achievable:
  // there was nothing left in the model telling the solver to use any food
  // at all once the floors were gone.
  //
  // Fix: maximize the summed coverage fraction (amount achieved / floor)
  // across every nutrient, each fraction capped at 1.0 via its own auxiliary
  // variable (cov_<key>, bounded [0,1]) tied to the real nutrient total by an
  // equality-style constraint. The cap keeps a food that blows way past one
  // nutrient's floor from "banking" that surplus to inflate the objective
  // while other nutrients stay at zero -- each nutrient can contribute at
  // most 1 to the sum, so the solver is pushed toward covering all of them,
  // not just the cheapest one. Ceiling (max_) constraints stay in place.
  //
  // cov_<key> alone gives literally zero objective credit for going past the
  // floor, so once a nutrient reaches 100% of its floor the solver has no
  // reason to push it further -- it reallocates grams elsewhere even when
  // overshoot would've been free (nothing else was competing for those
  // grams). That made unrelated, easily-covered nutrients flatline at
  // exactly floor_pct% and look artificially capped. over_<key> is a second
  // variable fed by the same link_<key> total, weighted at OVERSHOOT_WEIGHT
  // (small relative to 1.0 per nutrient-at-floor, so a shortfall on one
  // nutrient always outweighs padding an already-met one -- this must never
  // let "pad the easy nutrients" outbid "fix the worst shortfall") so any
  // slack the solver would otherwise waste still buys a little extra
  // headroom on nutrients that can afford it.
  //
  // over_<key> is bounded at OVERSHOOT_CAP (extra multiples of the floor, on
  // top of the 1.0 cov_<key> already provides) rather than left unbounded.
  // Nutrients with no established UL (vitamin K, B12, etc. -- see dri.json)
  // have no max_<key> ceiling constraint at all, so an unbounded over_<key>
  // would let the solver pile arbitrary grams of one dense food (e.g. liver
  // for B12/copper) to farm free objective credit, reporting a misleading
  // "closest combination" that's actually 700-900% of target on nutrients
  // that were never the problem. Capping it keeps overshoot in a plausible
  // range (roughly 2x the floor) without needing a real UL to bound it.
  const OVERSHOOT_WEIGHT = 0.01;
  const OVERSHOOT_CAP = 1;
  Object.keys(model.constraints).forEach(cKey => {
    if(cKey.startsWith('min_')) delete model.constraints[cKey].min;
  });

  TRACKABLE_KEYS.forEach(key => {
    const target = targets[key];
    if(target === null || target === undefined) return;
    const floor = target * (resolveNutrientBuffer(key).floor_pct / 100);
    if(!floor) return;
    // link_<key>: (per-gram contribution summed over foods) - floor*cov_<key> - floor*over_<key> = 0,
    // i.e. cov_<key>+over_<key> = actual/floor once solved -- expressed as an
    // equality constraint so the solver can freely trade grams against the
    // bounded cov_<key>/unbounded over_<key> variables instead of computing
    // them after the fact.
    model.constraints[`link_${key}`] = { equal: 0 };
    names.forEach(name => {
      const food = FOODS.find(f => f.name === name);
      const perGram = (food[key] || 0) / 100;
      model.variables[name][`link_${key}`] = perGram;
    });
    model.constraints[`cov_ub_${key}`] = { max: 1 };
    model.variables[`cov_${key}`] = {
      [`link_${key}`]: -floor,
      [`cov_ub_${key}`]: 1,
      coverage_obj: 1,
    };
    model.constraints[`over_ub_${key}`] = { max: OVERSHOOT_CAP };
    model.variables[`over_${key}`] = {
      [`link_${key}`]: -floor,
      [`over_ub_${key}`]: 1,
      coverage_obj: OVERSHOOT_WEIGHT,
    };
  });

  model.optimize = 'coverage_obj';
  model.opType = 'max';
  return model;
}

function solveCoverageUsage(names, targets, uls, calorieTarget){
  const model = buildCoverageModel(names, targets, uls, calorieTarget);
  let result;
  try{ result = window.solver.Solve(model); }catch(e){ result = null; }
  const usage = {};
  names.forEach(name => { usage[name] = (result && result[name]) || 0; });
  return usage;
}

// Average nutrient coverage (0..1, each nutrient capped at 1.0 -- an
// overshoot on one nutrient shouldn't inflate the average past what a
// balanced combination would score) -- used to rank best-effort combinations
// against each other the same way "meets all targets" isn't a single
// yes/no for the feasible case either.
function averageCoverage(totals, targets){
  let sum = 0, count = 0;
  TRACKABLE_KEYS.forEach(key => {
    const target = targets[key];
    if(target === null || target === undefined) return;
    const floor = target * (resolveNutrientBuffer(key).floor_pct / 100);
    if(!floor) return;
    count++;
    sum += Math.min((totals[key] || 0) / floor, 1);
  });
  return count > 0 ? sum / count : 0;
}

// Surfaces several distinct best-effort combinations, not just one, so the
// user can compare closest-coverage options the same way the feasible path
// already lists multiple combinations. Reuses the feasible path's approach:
// solve with the full selection, then with each single food dropped, to
// surface genuinely different combinations rather than the same subset
// twice; collapse near-duplicates and rank the rest by average coverage.
function bestEffortUsages(names, targets, uls, calorieTarget, maxResults = 5){
  const candidates = [];
  const seen = new Set();

  const tryUsage = (subset) => {
    if(subset.length === 0) return;
    const usage = solveCoverageUsage(subset, targets, uls, calorieTarget);
    const sig = solutionSignature(usage);
    if(!sig || seen.has(sig)) return;
    seen.add(sig);
    const totals = computeTotalsFromUsage(usage);
    candidates.push({ usage, totals, coverage: averageCoverage(totals, targets) });
  };

  tryUsage(names);
  if(names.length > 1){
    for(let i = 0; i < names.length; i++){
      tryUsage(names.filter((_, idx) => idx !== i));
    }
  }

  const distinct = [];
  candidates
    .sort((a, b) => b.coverage - a.coverage)
    .forEach(cand => {
      const dupe = distinct.some(kept => solutionsAreSimilar(kept.usage, cand.usage));
      if(!dupe) distinct.push(cand);
    });

  return distinct.slice(0, maxResults);
}

// Computes each nutrient's gap against its floor/ceiling for one combo's
// totals -- shared by the ranked list (each card shows its own bars) and by
// the gap-filling section below (based on the single closest combo).
function computeGaps(totals, targets, uls){
  const gaps = {};
  TRACKABLE_KEYS.forEach(k => {
    const target = targets[k];
    if(target === null || target === undefined) return;
    const { floor_pct, ceiling_pct } = resolveNutrientBuffer(k);
    const floor = target * (floor_pct/100);
    const ceil = uls[k] !== undefined ? uls[k] : (ceiling_pct ? target*(ceiling_pct/100) : null);
    const have = totals[k] || 0;
    if(have + 1e-9 < floor){
      gaps[k] = floor - have;
    } else if(ceil !== null && have > ceil + 1e-9){
      gaps[k] = -(have - ceil); // negative = overshoot past ceiling
    }
  });
  return gaps;
}

function renderInfeasibleResults(names, targets, uls, calorieTarget){
  const panel = document.getElementById('resultsPanel');
  const combos = bestEffortUsages(names, targets, uls, calorieTarget);

  if(combos.length === 0){
    panel.innerHTML = `<div class="combo-card status-partial">
      <div class="combo-title"><span>No combination of your selected foods meets all daily targets</span>
      <span class="combo-badge badge-partial">partial coverage</span></div>
      <div style="font-size:13px; color:var(--ink-soft);">The solver couldn't find any usable combination — try selecting different foods.</div>
    </div>`;
    return;
  }

  let html = `<h3 style="margin-bottom:6px;">No combination meets all your daily targets — closest ${combos.length > 1 ? `${combos.length} combinations` : 'combination'} by coverage</h3>
    <div style="font-size:13px; color:var(--ink-soft); margin-bottom:14px;">
      Ranked by average coverage across all tracked nutrients (each nutrient's own floor/ceiling — see Settings for the buffer used, or the published upper limit where one exists). Hover a combination to see its own nutrient breakdown.
    </div>`;

  combos.forEach((combo, idx) => {
    const { usage, totals } = combo;
    const gaps = computeGaps(totals, targets, uls);
    const items = Object.entries(usage).filter(([,g]) => g > 0.5);
    const maxGrams = Math.max(...items.map(([,g]) => g), 1);
    const pctLabel = `${Math.round(combo.coverage * 100)}% average coverage`;

    html += `<div class="combo-card status-partial" onmouseenter="showComboPie(this, ${idx}, true)" onmouseleave="hideComboPie(this)">
      <div class="combo-title">
        <span>Combination ${idx+1}</span>
        <span class="combo-badge badge-partial">${pctLabel}</span>
      </div>`;

    if(items.length > 0){
      html += `<div class="combo-items">
        ${items.map(([name, g]) => {
          const pct = Math.max((g / maxGrams) * 100, 2);
          return `<div class="combo-item-row">
            <span class="combo-item-name">${name}</span>
            <span class="combo-item-track"><span class="combo-item-fill" style="width:${pct}%"></span></span>
            <span class="combo-item-qty">${Math.round(g)} g</span>
          </div>`;
        }).join('')}
      </div>`;
    }

    html += `<div style="margin-top:12px;">`;
    if(calorieTarget){
      const havekcal = totals.kcal || 0;
      const pctKcal = Math.min(999, Math.round((havekcal/calorieTarget)*100));
      const barClassKcal = pctKcal > 110 ? 'over' : (pctKcal >= 90 ? '' : 'under');
      html += `<div class="nutrient-bar-row">
        <div class="nutrient-bar-label">Calories</div>
        <div class="nutrient-bar-track"><div class="nutrient-bar-fill ${barClassKcal}" style="width:${Math.min(100,pctKcal)}%"></div></div>
        <div class="nutrient-bar-pct">${pctKcal}%</div>
      </div>`;
    }
    TRACKABLE_KEYS.forEach(k => {
      const target = targets[k];
      if(target === null || target === undefined) return;
      const have = totals[k] || 0;
      const pct = Math.min(999, Math.round((have/target)*100));
      const over = gaps[k] !== undefined && gaps[k] < 0;
      const barClass = over ? 'over' : (pct >= resolveNutrientBuffer(k).floor_pct ? '' : 'under');
      html += `<div class="nutrient-bar-row">
        <div class="nutrient-bar-label">${DRI.nutrients[k].label}</div>
        <div class="nutrient-bar-track"><div class="nutrient-bar-fill ${barClass}" style="width:${Math.min(100,pct)}%"></div></div>
        <div class="nutrient-bar-pct">${pct}%</div>
      </div>`;
    });
    html += `</div>
      <div class="combo-pie-popover"></div>
    </div>`;
  });

  window.__lastBestEffortCombos = combos;
  window.__lastBestEffortTargets = targets;

  // Gap-filling suggestions below are based on the single closest (top-
  // ranked) combination -- showing "foods ranked by missing nutrient" for
  // every listed combination separately would be redundant noise, and the
  // top-ranked one is the most actionable starting point regardless.
  const bestCombo = combos[0];
  const gaps = computeGaps(bestCombo.totals, targets, uls);
  const shortfalls = Object.entries(gaps).filter(([,v]) => v > 0);
  const overshoots = Object.entries(gaps).filter(([,v]) => v < 0);

  if(shortfalls.length > 0){
    html += `<div class="missing-section"><h3>Foods ranked by missing nutrient</h3>
      <p style="font-size:13px; color:var(--ink-soft); margin-bottom:20px;">For each nutrient you're still short on (below its own floor — see Settings for the buffer used), foods from the full catalogue ranked highest-to-lowest by content per 100g. Disabled foods are excluded.</p>`;
    shortfalls.forEach(([k, gapAmt]) => {
      const nd = DRI.nutrients[k];
      const ranked = [...FOODS].filter(f => f.enabled && !f.hiddenByVariant).sort((a,b) => (b[k]||0) - (a[k]||0)).slice(0, 8);
      const maxAmt = ranked.length ? (ranked[0][k] || 0) : 0;
      html += `<div class="missing-nutrient-block">
        <h4>${nd.label} <span style="font-weight:400; color:var(--ink-soft); font-size:12px;">— short by ${gapAmt.toFixed(1)} ${DISPLAY_UNIT[k]||''}</span></h4>
        <div class="ranked-food-list">
          ${ranked.map(f => {
            const amt = f[k] ?? 0;
            const pct = maxAmt > 0 ? Math.max((amt / maxAmt) * 100, 2) : 0;
            return `<div class="ranked-food-row">
              <span class="ranked-food-name">${f.name} <span class="ranked-food-cat">(${f.category})</span></span>
              <span class="ranked-food-track"><span class="ranked-food-fill" style="width:${pct}%"></span></span>
              <span class="ranked-food-amt">${amt} ${DISPLAY_UNIT[k]||''}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  if(overshoots.length > 0){
    html += `<div class="missing-section"><h3>Nutrients over the upper limit</h3>
      <p style="font-size:13px; color:var(--ink-soft); margin-bottom:14px;">Reduce the amount of foods high in these to bring them back in range.</p>`;
    overshoots.forEach(([k, over]) => {
      const nd = DRI.nutrients[k];
      html += `<div class="missing-nutrient-block"><h4>${nd.label} <span style="font-weight:400; color:var(--ink-soft); font-size:12px;">— over by ${Math.abs(over).toFixed(1)} ${DISPLAY_UNIT[k]||''}</span></h4></div>`;
    });
    html += `</div>`;
  }

  const notTracked = NUTRIENT_KEYS.filter(k => DRI.nutrients[k].trackable === false);
  if(notTracked.length){
    html += `<div class="not-tracked-note">Not included above (no USDA food-composition data exists to check them): ${notTracked.map(k=>DRI.nutrients[k].label).join(', ')}.</div>`;
  }

  panel.innerHTML = html;
}
