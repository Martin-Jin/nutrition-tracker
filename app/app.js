// ============================================================================
// STATE
// ============================================================================
let FOODS = [];       // loaded from data/food_catalogue.json, plus any user-added/edited/disabled foods merged in
let DRI = null;        // loaded from data/dri.json
let NUTRIENT_KEYS = [];
let TRACKABLE_KEYS = []; // NUTRIENT_KEYS minus iodine/biotin (no USDA data)

const DISPLAY_UNIT = {
  kcal:'kcal', protein_g:'g', carb_g:'g', fiber_g:'g', sugar_g:'g', fat_g:'g', sat_fat_g:'g',
  calcium_mg:'mg', phosphorus_mg:'mg', magnesium_mg:'mg', potassium_mg:'mg', sodium_mg:'mg',
  iron_mg:'mg', zinc_mg:'mg', selenium_ug:'µg', copper_ug:'µg', manganese_mg:'mg', iodine_ug:'µg',
  vitA_ug:'µg', vitD_ug:'µg', vitE_mg:'mg', vitK_ug:'µg', vitC_mg:'mg', thiamin_mg:'mg',
  riboflavin_mg:'mg', niacin_mg:'mg', vitB6_mg:'mg', folate_ug:'µg', vitB12_ug:'µg',
  pantothenic_mg:'mg', biotin_ug:'µg', choline_mg:'mg'
};

const NUTRIENT_LABELS_ORDERED = [
  ['kcal','Energy','kcal'], ['protein_g','Protein','g'], ['carb_g','Carbohydrate','g'],
  ['fiber_g','Fiber','g'], ['sugar_g','Sugar','g'], ['fat_g','Fat','g'], ['sat_fat_g','Saturated fat','g'],
  ['calcium_mg','Calcium','mg'], ['phosphorus_mg','Phosphorus','mg'], ['magnesium_mg','Magnesium','mg'],
  ['potassium_mg','Potassium','mg'], ['sodium_mg','Sodium','mg'], ['iron_mg','Iron','mg'], ['zinc_mg','Zinc','mg'],
  ['selenium_ug','Selenium','µg'], ['copper_ug','Copper','µg'], ['manganese_mg','Manganese','mg'], ['iodine_ug','Iodine','µg'],
  ['vitA_ug','Vitamin A','µg'], ['vitD_ug','Vitamin D','µg'], ['vitE_mg','Vitamin E','mg'], ['vitK_ug','Vitamin K','µg'],
  ['vitC_mg','Vitamin C','mg'], ['thiamin_mg','Thiamin (B1)','mg'], ['riboflavin_mg','Riboflavin (B2)','mg'],
  ['niacin_mg','Niacin (B3)','mg'], ['vitB6_mg','Vitamin B6','mg'], ['folate_ug','Folate','µg'],
  ['vitB12_ug','Vitamin B12','µg'], ['pantothenic_mg','Pantothenic acid','mg'], ['biotin_ug','Biotin','µg'],
  ['choline_mg','Choline','mg'],
];

let state = {
  profile: { age: 30, sex: 'male', weight: 70, height: 175, activity: 'moderate' },
  selectedFoods: {}, // name -> { grams }
  catalogueFilter: 'all',
  overrides: {},      // nutrient key -> overridden target value
  disabledFoods: {},  // name -> true (excluded from solver AND hidden from the calculator's food picker)
  customFoods: [],    // user-added foods, same shape as FOODS entries
  editedFoods: {},    // name -> partial food object overriding fetched values
  simplifyCategories: false, // when true, catalogue + calculator show one flat list instead of grouping by Meats/Vegetables/Fruits/Nuts
};

// ============================================================================
// PERSISTENCE (localStorage) -- profile, overrides, disabled/custom/edited foods
// ============================================================================
const LS_KEY = 'harvestLedger.v1';

function saveState(){
  try{
    const toSave = {
      profile: state.profile,
      overrides: state.overrides,
      disabledFoods: state.disabledFoods,
      customFoods: state.customFoods,
      editedFoods: state.editedFoods,
      simplifyCategories: state.simplifyCategories,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(toSave));
  }catch(e){
    console.warn('localStorage save failed', e);
  }
}

function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    if(parsed.profile) state.profile = Object.assign(state.profile, parsed.profile);
    if(parsed.overrides) state.overrides = parsed.overrides;
    if(parsed.disabledFoods) state.disabledFoods = parsed.disabledFoods;
    if(parsed.customFoods) state.customFoods = parsed.customFoods;
    if(parsed.editedFoods) state.editedFoods = parsed.editedFoods;
    if(typeof parsed.simplifyCategories === 'boolean') state.simplifyCategories = parsed.simplifyCategories;
  }catch(e){
    console.warn('localStorage load failed', e);
  }
}

// ============================================================================
// DATA LOAD
// ============================================================================
function applyFoodOverrides(){
  // merge fetched catalogue + custom foods + per-food edits + disabled flags
  const merged = [...window.__RAW_FOODS__, ...state.customFoods].map(f => {
    const edited = state.editedFoods[f.name];
    const food = edited ? Object.assign({}, f, edited) : Object.assign({}, f);
    food.enabled = !state.disabledFoods[f.name];
    return food;
  });
  FOODS = merged;
}

async function loadData(){
  const [foods, dri] = await Promise.all([
    fetch('data/food_catalogue.json').then(r => r.json()),
    fetch('data/dri.json').then(r => r.json()),
  ]);
  window.__RAW_FOODS__ = foods;
  DRI = dri;
  NUTRIENT_KEYS = Object.keys(DRI.nutrients);
  TRACKABLE_KEYS = NUTRIENT_KEYS.filter(k => DRI.nutrients[k].trackable !== false);
  loadState();
  applyFoodOverrides();
}

// ============================================================================
// NAV
// ============================================================================
function showView(name){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(name).classList.add('active');
  document.querySelectorAll('.navlink').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo(0,0);
  if(name === 'requirements') renderRequirementsTable();
  if(name === 'catalogue') renderCatalogueTable();
  if(name === 'profile') renderProfileMatch();
}

// ============================================================================
// PROFILE / LIFE STAGE MATCHING
// ============================================================================
function matchLifeStage(profile){
  const sexKey = profile.sex;
  const age = profile.age;
  const candidates = DRI.lifeStages.filter(ls => {
    const sexOk = ls.sex === sexKey || ls.sex === 'any';
    return sexOk && age >= ls.age_min && age <= ls.age_max;
  });
  return candidates.length ? candidates[0] : null;
}

function getTargets(){
  const stage = matchLifeStage(state.profile);
  const targets = {};
  const uls = {};
  NUTRIENT_KEYS.forEach(key => {
    const nd = DRI.nutrients[key];
    let val = stage ? nd.values[stage.id] : undefined;
    if(state.overrides[key] !== undefined && state.overrides[key] !== null && state.overrides[key] !== ''){
      val = parseFloat(state.overrides[key]);
    }
    targets[key] = (val === undefined || val === null) ? null : val;
    // ul_value in dri.json is keyed per life-stage (UL varies by age/sex,
    // e.g. iron UL is 40mg for children but 45mg for adults) -- resolve it
    // to the single number for the matched stage, same as `values` above.
    // Storing the whole object here would make every UL comparison in the
    // solver silently no-op (comparing a number to an object is never
    // true in JS), so every ceiling would go unenforced without an error.
    if(nd.ul_value && stage){
      const resolvedUl = nd.ul_value[stage.id];
      if(resolvedUl !== undefined && resolvedUl !== null) uls[key] = resolvedUl;
    }
  });
  return { stage, targets, uls };
}

function saveProfile(){
  state.profile.age = parseFloat(document.getElementById('pAge').value) || 0;
  state.profile.sex = document.getElementById('pSex').value;
  state.profile.weight = parseFloat(document.getElementById('pWeight').value) || 0;
  state.profile.height = parseFloat(document.getElementById('pHeight').value) || 0;
  state.profile.activity = document.getElementById('pActivity').value;
  saveState();
  renderProfileMatch();
  renderHeroCard();
}

function renderProfileMatch(){
  const { stage, targets } = getTargets();
  const el = document.getElementById('profileMatchedStage');
  if(!stage){
    el.innerHTML = `<span style="color:var(--bad)">No matching life stage found for this age/sex combination.</span>`;
    return;
  }
  const proteinCheck = (state.profile.weight * 0.8).toFixed(1);
  el.innerHTML = `
    <div style="margin-bottom:10px;"><strong style="color:var(--forest)">${stage.label}</strong></div>
    <div style="font-size:13px; line-height:1.8;">
      Protein target: <span class="mono">${fmtVal(targets.protein_g)} g/d</span><br>
      Protein by body weight (0.8 g/kg): <span class="mono">${proteinCheck} g/d</span><br>
      Fiber target: <span class="mono">${fmtVal(targets.fiber_g)} g/d</span><br>
      Calcium target: <span class="mono">${fmtVal(targets.calcium_mg)} mg/d</span>
    </div>
  `;
}

function fmtVal(v){ return (v === null || v === undefined) ? '—' : v; }

// ============================================================================
// REQUIREMENTS TABLE (editable)
// ============================================================================
function renderRequirementsTable(){
  const { stage, targets, uls } = getTargets();
  document.getElementById('reqLifeStageLabel').textContent = stage ? stage.label : 'no match';
  const tbody = document.getElementById('reqTbody');
  tbody.innerHTML = '';
  const notTracked = [];

  NUTRIENT_KEYS.forEach(key => {
    const nd = DRI.nutrients[key];
    if(nd.trackable === false){ notTracked.push(key); return; }
    const val = targets[key];
    const tr = document.createElement('tr');
    tr.className = 'dri-editable-row';
    const catTag = `<span class="tag tag-${nd.category}">${nd.category}</span>`;
    const floor = nd.floor_pct ?? 90;
    const ceil = uls[key] !== undefined ? `UL ${uls[key]}` : (nd.ceiling_pct ? `${nd.ceiling_pct}%` : '—');
    tr.innerHTML = `
      <td>${nd.label}</td>
      <td>${catTag}</td>
      <td class="mono" style="font-size:12px;">${nd.unit}</td>
      <td style="font-size:12px; color:var(--ink-soft);">${nd.type}</td>
      <td><input type="number" step="any" data-key="${key}" value="${val ?? ''}" onchange="onOverrideChange(this)"></td>
      <td style="font-size:12px; color:var(--ink-soft);">${stage ? (nd.values[stage.id] ?? 'n/a') : '—'}</td>
      <td style="font-size:11.5px; color:var(--ink-soft);">${floor}%–${ceil}</td>
    `;
    tbody.appendChild(tr);
  });

  const panel = document.getElementById('notTrackedPanel');
  const list = document.getElementById('notTrackedList');
  if(notTracked.length){
    panel.style.display = '';
    list.innerHTML = notTracked.map(key => {
      const nd = DRI.nutrients[key];
      const val = targets[key];
      return `<div class="hero-nutrient-row" style="border-bottom:1px solid var(--line);">
        <span class="n">${nd.label} <span class="tag tag-nodata">no USDA data</span></span>
        <span class="v mono" style="color:var(--ink);">${fmtVal(val)} ${nd.unit}</span>
      </div>`;
    }).join('');
  } else {
    panel.style.display = 'none';
  }
}

function onOverrideChange(input){
  const key = input.dataset.key;
  state.overrides[key] = input.value;
  saveState();
}

// ============================================================================
// LANDING
// ============================================================================
function renderHeroCard(){
  const { stage, targets } = getTargets();
  const title = document.getElementById('heroCardTitle');
  if(stage) title.textContent = `TODAY'S TARGET — ${stage.label.toUpperCase()}`;
  const rows = document.getElementById('heroNutrientRows');
  const highlight = ['protein_g','fiber_g','iron_mg','calcium_mg','vitC_mg','vitB12_ug','potassium_mg'];
  rows.innerHTML = highlight.filter(k => DRI.nutrients[k]).map(k => {
    const nd = DRI.nutrients[k];
    const val = targets[k];
    return `<div class="hero-nutrient-row"><span class="n">${nd.label}</span><span class="v">${fmtVal(val)} ${DISPLAY_UNIT[k]||''}</span></div>`;
  }).join('');
}

function renderLandingStats(){
  document.getElementById('statFoods').textContent = FOODS.length;
  document.getElementById('statNutrients').textContent = TRACKABLE_KEYS.length;
  document.getElementById('statStages').textContent = DRI.lifeStages.length;
}

function renderLandingCatStrip(){
  const cats = {};
  FOODS.forEach(f => cats[f.category] = (cats[f.category]||0)+1);
  const icons = {Meats:'🥩', Vegetables:'🥬', Fruits:'🍎', Nuts:'🌰'};
  const strip = document.getElementById('landingCatStrip');
  strip.innerHTML = Object.keys(cats).map(cat => `
    <div class="cat-block" onclick="showView('catalogue'); setCatalogueFilter('${cat}')">
      <span class="cat-icon">${icons[cat]||'🍽️'}</span>
      <h4>${cat}</h4>
      <div class="cat-count">${cats[cat]} items</div>
    </div>
  `).join('');
}

// ============================================================================
// CALCULATOR: food picker
// ============================================================================
function renderFoodPicker(){
  const q = (document.getElementById('calcFoodSearch').value || '').toLowerCase();
  const list = document.getElementById('foodPickerList');
  // Foods disabled in the catalogue are not just unselectable here, they're
  // not shown at all -- what's enabled in the catalogue is exactly what's
  // available in the calculator, with nothing left to "re-enable" per view.
  const available = FOODS.filter(f => f.enabled && (!q || foodMatchesQuery(f, q)));

  const renderItem = (f) => {
    const checked = state.selectedFoods[f.name] ? 'checked' : '';
    const sel = state.selectedFoods[f.name] ? 'selected' : '';
    return `<label class="food-item ${sel}">
      <input type="checkbox" ${checked} onchange="toggleFood('${escName(f.name)}', this.checked)">
      <span>${f.name}</span>
    </label>`;
  };

  let html = '';
  if(state.simplifyCategories){
    html = available.map(renderItem).join('');
  } else {
    const byCat = {};
    available.forEach(f => (byCat[f.category] = byCat[f.category] || []).push(f));
    Object.keys(byCat).forEach(cat => {
      html += `<div class="food-cat-label">${cat}</div>`;
      html += byCat[cat].map(renderItem).join('');
    });
  }
  list.innerHTML = html || '<div class="field-hint">No foods match your search.</div>';
}

function escName(name){ return name.replace(/'/g, "\\'"); }

function toggleFood(name, checked){
  if(checked){
    state.selectedFoods[name] = { grams: 100 };
  } else {
    delete state.selectedFoods[name];
  }
  renderFoodPicker();
  renderSelectedFoods();
}

function renderSelectedFoods(){
  const container = document.getElementById('selectedFoodsList');
  const names = Object.keys(state.selectedFoods);
  if(names.length === 0){
    container.innerHTML = '<div class="empty-state">No foods selected yet. Choose from the list on the left.</div>';
    return;
  }
  container.innerHTML = names.map(name => {
    const item = state.selectedFoods[name];
    return `<div class="selected-food-row">
      <div class="name">${name}</div>
      <input type="number" min="0" step="1" value="${item.grams}" onchange="updateGrams('${escName(name)}', this.value)">
      <button class="remove-btn" onclick="toggleFood('${escName(name)}', false)" title="Remove">✕</button>
    </div>`;
  }).join('');
}

function updateGrams(name, grams){
  if(state.selectedFoods[name]) state.selectedFoods[name].grams = parseFloat(grams) || 0;
}

function clearSelection(){
  state.selectedFoods = {};
  renderFoodPicker();
  renderSelectedFoods();
  document.getElementById('resultsPanel').innerHTML = '';
}

// ============================================================================
// CALCULATOR: LP-based combination solver
// ============================================================================
// Each selected food is a continuous variable: grams used, bounded by
// [0, gramsOnHand]. Constraints: for every trackable nutrient with a target,
// floor_pct% * target <= sum(food_nutrient_per_g * grams) <= ceiling.
// Ceiling is either an explicit UL (ul_value) or ceiling_pct% * target, else
// unbounded. We solve the same LP with a few different objectives (minimize
// total grams, minimize kcal, maximize distinct-food variety) to surface
// multiple genuinely distinct solutions, per spec ("show them all as a list").

function buildLPModel(selectedNames, targets, uls, objectiveType){
  const variables = {};
  const constraints = {};

  TRACKABLE_KEYS.forEach(key => {
    const target = targets[key];
    if(target === null || target === undefined) return;
    const nd = DRI.nutrients[key];
    const floorPct = (nd.floor_pct ?? 90) / 100;
    constraints[`min_${key}`] = { min: target * floorPct };
    const ceilVal = uls[key] !== undefined ? uls[key] : (nd.ceiling_pct ? target * (nd.ceiling_pct/100) : null);
    if(ceilVal !== null && ceilVal !== undefined){
      constraints[`max_${key}`] = { max: ceilVal };
    }
  });

  selectedNames.forEach(name => {
    const food = FOODS.find(f => f.name === name);
    const onHand = state.selectedFoods[name].grams;
    const varDef = { total_grams: 1 };
    TRACKABLE_KEYS.forEach(key => {
      const perGram = (food[key] || 0) / 100;
      varDef[`min_${key}`] = perGram;
      varDef[`max_${key}`] = perGram;
    });
    varDef.kcal_obj = (food.kcal || 0) / 100;
    variables[name] = varDef;
    constraints[`cap_${name}`] = { max: onHand };
    varDef[`cap_${name}`] = 1;
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

function runCalculation(){
  const names = Object.keys(state.selectedFoods).filter(name => {
    const food = FOODS.find(f => f.name === name);
    return food && food.enabled;
  });
  const resultsPanel = document.getElementById('resultsPanel');
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

  // Try a few objectives to surface multiple distinct feasible solutions.
  const objectives = ['grams', 'kcal'];
  const solutions = [];
  const seen = new Set();

  objectives.forEach(obj => {
    const model = buildLPModel(names, targets, uls, obj);
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
      const model = buildLPModel(subset, targets, uls, 'grams');
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
    renderSuccessResults(solutions, targets, uls);
    return;
  }

  // Infeasible: solve the "use everything you have, minimize shortfall"
  // relaxation to report best-effort coverage, then rank gap-filling foods.
  renderInfeasibleResults(names, targets, uls);
}

function renderSuccessResults(solutions, targets, uls){
  const panel = document.getElementById('resultsPanel');
  let html = `<h3 style="margin-bottom:14px;">✓ ${solutions.length} combination${solutions.length>1?'s':''} that meet${solutions.length>1?'':'s'} all your daily targets</h3>`;
  solutions.forEach((sol, idx) => {
    const items = Object.entries(sol.usage).filter(([,g]) => g > 0.5);
    html += `<div class="combo-card status-full">
      <div class="combo-title">
        <span>Combination ${idx+1}</span>
        <span class="combo-badge badge-full">meets all targets (90%–110% band)</span>
      </div>
      <div class="combo-items">
        ${items.map(([name, g]) => `<div><span class="qty">${Math.round(g)} g</span> — ${name}</div>`).join('')}
      </div>
      <div style="margin-top:12px; font-size:12px; color:var(--ink-soft);">Total: ${Math.round(sol.totals.kcal)} kcal</div>
    </div>`;
  });
  panel.innerHTML = html;
}

function renderInfeasibleResults(names, targets, uls){
  const panel = document.getElementById('resultsPanel');
  // Best-effort: use full amount of everything on hand, see how close we get.
  const usage = {};
  names.forEach(name => usage[name] = state.selectedFoods[name].grams);
  const totals = computeTotalsFromUsage(usage);

  const gaps = {};
  let infeasibleReason = null;
  TRACKABLE_KEYS.forEach(k => {
    const target = targets[k];
    if(target === null || target === undefined) return;
    const nd = DRI.nutrients[k];
    const floor = target * ((nd.floor_pct ?? 90)/100);
    const ceil = uls[k] !== undefined ? uls[k] : (nd.ceiling_pct ? target*(nd.ceiling_pct/100) : null);
    const have = totals[k] || 0;
    if(have + 1e-9 < floor){
      gaps[k] = floor - have;
    } else if(ceil !== null && have > ceil + 1e-9){
      gaps[k] = -(have - ceil); // negative = overshoot past ceiling
    }
  });

  let html = `<div class="combo-card status-partial">
    <div class="combo-title"><span>No combination of your selected foods meets all daily targets</span>
    <span class="combo-badge badge-partial">partial coverage</span></div>
    <div style="font-size:13px; color:var(--ink-soft); margin-bottom:14px;">
      Using everything you have on hand gets you closest — here's that coverage (target band: 90%–110%, or the published upper limit where one exists), plus what's still missing.
    </div>`;

  html += `<div style="margin-top:10px;">`;
  TRACKABLE_KEYS.forEach(k => {
    const target = targets[k];
    if(target === null || target === undefined) return;
    const have = totals[k] || 0;
    const pct = Math.min(999, Math.round((have/target)*100));
    const over = gaps[k] !== undefined && gaps[k] < 0;
    const barClass = over ? 'over' : (pct >= 90 ? '' : 'under');
    html += `<div class="nutrient-bar-row">
      <div class="nutrient-bar-label">${DRI.nutrients[k].label}</div>
      <div class="nutrient-bar-track"><div class="nutrient-bar-fill ${barClass}" style="width:${Math.min(100,pct)}%"></div></div>
      <div class="nutrient-bar-pct">${pct}%</div>
    </div>`;
  });
  html += `</div></div>`;

  const shortfalls = Object.entries(gaps).filter(([,v]) => v > 0);
  const overshoots = Object.entries(gaps).filter(([,v]) => v < 0);

  if(shortfalls.length > 0){
    html += `<div class="missing-section"><h3>Foods ranked by missing nutrient</h3>
      <p style="font-size:13px; color:var(--ink-soft); margin-bottom:20px;">For each nutrient you're still short on (below the 90% floor), foods from the full catalogue ranked highest-to-lowest by content per 100g. Disabled foods are excluded.</p>`;
    shortfalls.forEach(([k, gapAmt]) => {
      const nd = DRI.nutrients[k];
      const ranked = [...FOODS].filter(f => f.enabled).sort((a,b) => (b[k]||0) - (a[k]||0)).slice(0, 8);
      html += `<div class="missing-nutrient-block">
        <h4>${nd.label} <span style="font-weight:400; color:var(--ink-soft); font-size:12px;">— short by ${gapAmt.toFixed(1)} ${DISPLAY_UNIT[k]||''}</span></h4>
        <ul class="missing-food-list">
          ${ranked.map(f => `<li><span class="amt">${(f[k]??0)} ${DISPLAY_UNIT[k]||''}</span> per 100g — ${f.name} <span style="color:#9A947F">(${f.category})</span></li>`).join('')}
        </ul>
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

// ============================================================================
// CATALOGUE
// ============================================================================
function setCatalogueFilter(cat){
  state.catalogueFilter = cat;
  document.querySelectorAll('.cat-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  renderCatalogueTable();
}

function renderCatalogueTable(){
  const tbody = document.getElementById('catalogueTbody');
  const q = (document.getElementById('catalogueSearch').value || '').toLowerCase();
  const simplified = state.simplifyCategories;
  let list = simplified ? FOODS.slice() : FOODS.filter(f => state.catalogueFilter === 'all' || f.category === state.catalogueFilter);
  if(q) list = list.filter(f => foodMatchesQuery(f, q));
  const colspan = simplified ? 13 : 14;
  tbody.innerHTML = list.map(f => `
    <tr class="${f.enabled ? '' : 'row-disabled'}">
      <td onclick="openFoodModal('${escName(f.name)}')" style="cursor:pointer;"><strong>${f.name}</strong></td>
      ${simplified ? '' : `<td>${f.category}</td>`}
      <td class="mono">${fmtVal(f.kcal)}</td>
      <td class="mono">${fmtVal(f.protein_g)}</td>
      <td class="mono">${fmtVal(f.carb_g)}</td>
      <td class="mono">${fmtVal(f.fiber_g)}</td>
      <td class="mono">${fmtVal(f.fat_g)}</td>
      <td class="mono">${fmtVal(f.calcium_mg)}</td>
      <td class="mono">${fmtVal(f.iron_mg)}</td>
      <td class="mono">${fmtVal(f.potassium_mg)}</td>
      <td class="mono">${fmtVal(f.vitC_mg)}</td>
      <td class="mono">${fmtVal(f.vitA_ug)}</td>
      <td>${f.source_url ? `<a href="${f.source_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">USDA</a>` : '—'}</td>
      <td><input type="checkbox" ${f.enabled ? 'checked' : ''} onclick="event.stopPropagation()" onchange="toggleFoodEnabled('${escName(f.name)}', this.checked)"></td>
    </tr>
  `).join('') || `<tr><td colspan="${colspan}" style="text-align:center; padding:30px; color:var(--ink-soft);">No foods match.</td></tr>`;

  // category filter pills and the table's Category header are meaningless
  // once categories are hidden from the row data -- toggle them together.
  document.querySelectorAll('.cat-filter-btn[data-cat]').forEach(b => { b.hidden = simplified; });
  const catHeader = document.getElementById('catalogueCategoryHeader');
  if(catHeader) catHeader.hidden = simplified;
}

function onSimplifyCategoriesChange(checked){
  state.simplifyCategories = checked;
  if(checked) state.catalogueFilter = 'all';
  saveState();
  renderCatalogueTable();
  renderFoodPicker();
}

function toggleFoodEnabled(name, checked){
  if(checked){ delete state.disabledFoods[name]; }
  else { state.disabledFoods[name] = true; }
  saveState();
  applyFoodOverrides();
  renderCatalogueTable();
  renderFoodPicker();
}

function enableAllFoods(){
  state.disabledFoods = {};
  saveState();
  applyFoodOverrides();
  renderCatalogueTable();
  renderFoodPicker();
}

// ---- fuzzy matching for autofill ----
// A food's search text is its name plus any common_names (e.g. USDA's
// official name for bok choy is "Cabbage, chinese (pak-choi), raw" --
// searching just the name would never find it under "bok choy").
//
// Matching is substring-first: a plain substring hit against name or any
// alias is always preferred and is what most queries will get. Only when
// NO substring hit exists anywhere do we fall back to subsequence-based
// fuzzy matching (query chars appear in order, not necessarily contiguous).
// Subsequence-only matching against long strings is too loose to use as
// the primary check -- e.g. "choy" is a subsequence of many unrelated
// names -- so it's a fallback for typos/partial words, not the default.
function foodSearchText(food){
  return [food.name, food.common_names || ''].join(' | ').toLowerCase();
}

function foodMatchesQuery(food, query){
  const text = foodSearchText(food);
  if(text.includes(query)) return true;
  // Subsequence fallback only against individual words (not the whole
  // comma/paren-laden description) and only for short queries (typo-length
  // words) -- matching a short query as a loose subsequence of a long
  // multi-clause string produces mostly noise (e.g. "bok" or "napa"
  // matching half the meat aisle by coincidence).
  if(query.length > 6) return false;
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  return words.some(w => fuzzySubsequence(w, query));
}

function fuzzySubsequence(target, query){
  if(!query) return true;
  let ti = 0;
  for(let qi = 0; qi < query.length; qi++){
    const ch = query[qi];
    let found = false;
    while(ti < target.length){
      if(target[ti] === ch){ found = true; ti++; break; }
      ti++;
    }
    if(!found) return false;
  }
  return true;
}

function fuzzyHighlight(target, query){
  if(!query) return target;
  const lowerTarget = target.toLowerCase();
  const idx = lowerTarget.indexOf(query);
  if(idx !== -1){
    // Direct substring match: highlight the exact contiguous run. This is
    // the common case and reads far better than a scattered subsequence
    // highlight would for the same match.
    return target.slice(0, idx) + `<mark>${target.slice(idx, idx+query.length)}</mark>` + target.slice(idx+query.length);
  }
  // No substring in the name itself -- either a subsequence match on the
  // name, or the match came entirely from a common_names alias (in which
  // case this highlight will show nothing marked; the alias is shown
  // separately by the caller).
  let out = '';
  let ti = 0, qi = 0;
  while(ti < target.length){
    if(qi < query.length && lowerTarget[ti] === query[qi]){
      out += `<mark>${target[ti]}</mark>`;
      qi++;
    } else {
      out += target[ti];
    }
    ti++;
  }
  return out;
}

let acActiveIndex = -1;
let acCurrentMatches = [];

function onCatalogueSearchInput(){
  renderCatalogueTable();
  const q = (document.getElementById('catalogueSearch').value || '').toLowerCase();
  const box = document.getElementById('catalogueAutocomplete');
  acActiveIndex = -1;
  if(!q){ box.classList.remove('show'); box.innerHTML=''; acCurrentMatches=[]; return; }
  acCurrentMatches = FOODS
    .filter(f => foodMatchesQuery(f, q))
    .slice(0, 10);
  if(acCurrentMatches.length === 0){ box.classList.remove('show'); box.innerHTML=''; return; }
  renderAutocompleteBox(q);
  box.classList.add('show');
}

function renderAutocompleteBox(q){
  const box = document.getElementById('catalogueAutocomplete');
  box.innerHTML = acCurrentMatches.map((f, i) => {
    const nameHasMatch = f.name.toLowerCase().includes(q);
    // If the query only hit a common_names alias (e.g. "napa" against
    // "Cabbage, chinese (pe-tsai), raw"), surface that alias so the match
    // is explainable rather than showing an unrelated-looking name alone.
    const aliasNote = (!nameHasMatch && f.common_names)
      ? `<div style="font-size:11px; color:var(--ink-soft);">aka ${fuzzyHighlight(f.common_names, q)}</div>`
      : '';
    return `<div class="ac-item ${i===acActiveIndex?'ac-active':''}" onclick="selectAutocomplete('${escName(f.name)}')">
      <span>
        <span class="ac-name">${fuzzyHighlight(f.name, q)}</span>
        ${aliasNote}
      </span>
      <span class="ac-cat">${f.category}${f.enabled?'':' · disabled'}</span>
    </div>`;
  }).join('');
}

function onCatalogueSearchKeydown(e){
  const box = document.getElementById('catalogueAutocomplete');
  if(!box.classList.contains('show') || acCurrentMatches.length === 0) return;
  if(e.key === 'ArrowDown'){
    e.preventDefault();
    acActiveIndex = Math.min(acActiveIndex+1, acCurrentMatches.length-1);
    renderAutocompleteBox((document.getElementById('catalogueSearch').value||'').toLowerCase());
  } else if(e.key === 'ArrowUp'){
    e.preventDefault();
    acActiveIndex = Math.max(acActiveIndex-1, -1);
    renderAutocompleteBox((document.getElementById('catalogueSearch').value||'').toLowerCase());
  } else if(e.key === 'Enter' && acActiveIndex >= 0){
    e.preventDefault();
    selectAutocomplete(acCurrentMatches[acActiveIndex].name);
  } else if(e.key === 'Escape'){
    box.classList.remove('show');
  }
}

function selectAutocomplete(name){
  document.getElementById('catalogueSearch').value = name;
  document.getElementById('catalogueAutocomplete').classList.remove('show');
  renderCatalogueTable();
  openFoodModal(name);
}

document.addEventListener('click', (e) => {
  if(!e.target.closest('.autocomplete-wrap')){
    const box = document.getElementById('catalogueAutocomplete');
    if(box) box.classList.remove('show');
  }
});

// ---- food detail modal: view, edit, disable, source link ----
function openFoodModal(name){
  const f = FOODS.find(x => x.name === name);
  if(!f) return;
  const content = document.getElementById('foodModalContent');
  content.innerHTML = `
    <button class="modal-close" onclick="closeFoodModal()">✕</button>
    <h3>${f.name}</h3>
    <div class="fd-cat">${f.category} · per 100g ${f.enabled ? '' : '· <span style="color:var(--bad)">disabled</span>'}</div>
    <div class="fd-grid">
      ${NUTRIENT_LABELS_ORDERED.map(([key,label,unit]) => `
        <div class="fd-row"><span>${label}</span><span class="fd-val ${f[key]==null?'no-data':''}">${f[key]==null ? 'no data' : f[key]+unit}</span></div>
      `).join('')}
    </div>
    <div class="fd-actions">
      <button class="btn btn-secondary btn-sm" onclick="openEditFoodModal('${escName(f.name)}')">Edit values</button>
      <button class="btn ${f.enabled?'btn-danger':'btn-secondary'} btn-sm" onclick="toggleFoodEnabled('${escName(f.name)}', ${!f.enabled}); closeFoodModal();">${f.enabled ? 'Disable (exclude from solver)' : 'Re-enable'}</button>
      ${f.isCustom ? `<button class="btn btn-danger btn-sm" onclick="deleteCustomFood('${escName(f.name)}')">Delete</button>` : ''}
    </div>
    ${f.source_url ? `<div class="fd-source">Source: <a href="${f.source_url}" target="_blank" rel="noopener">${f.source_name || 'USDA FoodData Central'}</a>${f.fdc_id ? ` · FDC ID ${f.fdc_id}` : ''}${f.published_date ? ` · published ${f.published_date}` : ''}</div>` : '<div class="fd-source">No source recorded (custom food).</div>'}
  `;
  document.getElementById('foodModalBg').classList.add('show');
}
function closeFoodModal(){
  document.getElementById('foodModalBg').classList.remove('show');
}

function openEditFoodModal(name){
  const f = FOODS.find(x => x.name === name);
  if(!f) return;
  const content = document.getElementById('foodModalContent');
  content.innerHTML = `
    <button class="modal-close" onclick="closeFoodModal()">✕</button>
    <h3>Edit — ${f.name}</h3>
    <div class="fd-cat">${f.category} · per 100g</div>
    <div class="fd-edit-grid">
      ${NUTRIENT_LABELS_ORDERED.map(([key,label,unit]) => `
        <label>${label} (${unit})</label>
        <input type="number" step="any" data-key="${key}" value="${f[key] ?? ''}" placeholder="no data">
      `).join('')}
    </div>
    <div class="fd-actions">
      <button class="btn btn-primary btn-sm" onclick="saveEditedFood('${escName(f.name)}')">Save changes</button>
      <button class="btn btn-secondary btn-sm" onclick="openFoodModal('${escName(f.name)}')">Cancel</button>
    </div>
    <div class="field-hint" style="margin-top:10px;">Edits are stored locally in this browser and override the fetched USDA value for this food.</div>
  `;
}

function saveEditedFood(name){
  const inputs = document.querySelectorAll('#foodModalContent input[data-key]');
  const edits = {};
  inputs.forEach(inp => {
    const key = inp.dataset.key;
    edits[key] = inp.value === '' ? null : parseFloat(inp.value);
  });
  state.editedFoods[name] = Object.assign({}, state.editedFoods[name]||{}, edits);
  saveState();
  applyFoodOverrides();
  renderCatalogueTable();
  openFoodModal(name);
}

function deleteCustomFood(name){
  state.customFoods = state.customFoods.filter(f => f.name !== name);
  delete state.editedFoods[name];
  delete state.disabledFoods[name];
  saveState();
  applyFoodOverrides();
  renderCatalogueTable();
  closeFoodModal();
}

function openAddFoodModal(){
  const content = document.getElementById('foodModalContent');
  content.innerHTML = `
    <button class="modal-close" onclick="closeFoodModal()">✕</button>
    <h3>Add a custom food</h3>
    <div class="field-row"><label>Name</label><input type="text" id="newFoodName" placeholder="e.g. Homemade granola"></div>
    <div class="field-row"><label>Category</label>
      <select id="newFoodCategory">
        <option>Meats</option><option>Vegetables</option><option>Fruits</option><option>Nuts</option>
      </select>
    </div>
    <div class="fd-edit-grid" style="margin-top:14px;">
      ${NUTRIENT_LABELS_ORDERED.map(([key,label,unit]) => `
        <label>${label} (${unit})</label>
        <input type="number" step="any" data-key="${key}" placeholder="0">
      `).join('')}
    </div>
    <div class="fd-actions">
      <button class="btn btn-primary btn-sm" onclick="saveNewFood()">Add food</button>
      <button class="btn btn-secondary btn-sm" onclick="closeFoodModal()">Cancel</button>
    </div>
    <div class="field-hint" style="margin-top:10px;">Custom foods have no USDA source — values are whatever you enter here.</div>
  `;
  document.getElementById('foodModalBg').classList.add('show');
}

function saveNewFood(){
  const name = document.getElementById('newFoodName').value.trim();
  if(!name){ alert('Please enter a food name.'); return; }
  if(FOODS.some(f => f.name === name)){ alert('A food with that name already exists.'); return; }
  const category = document.getElementById('newFoodCategory').value;
  const inputs = document.querySelectorAll('#foodModalContent input[data-key]');
  const food = { name, category, isCustom: true, source_url: null, source_name: null };
  inputs.forEach(inp => {
    const key = inp.dataset.key;
    food[key] = inp.value === '' ? null : parseFloat(inp.value);
  });
  state.customFoods.push(food);
  saveState();
  applyFoodOverrides();
  renderCatalogueTable();
  renderFoodPicker();
  closeFoodModal();
}

// ============================================================================
// INIT
// ============================================================================
async function init(){
  await loadData();

  document.getElementById('pAge').value = state.profile.age;
  document.getElementById('pSex').value = state.profile.sex;
  document.getElementById('pWeight').value = state.profile.weight;
  document.getElementById('pHeight').value = state.profile.height;
  document.getElementById('pActivity').value = state.profile.activity;
  document.getElementById('simplifyCategoriesToggle').checked = state.simplifyCategories;

  renderFoodPicker();
  renderSelectedFoods();
  renderLandingCatStrip();
  renderLandingStats();
  renderHeroCard();
}

init();
