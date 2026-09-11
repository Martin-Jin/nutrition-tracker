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
  simplifyVariants: false, // when true, only one representative per SIMPLIFY_GROUPS entry is usable; other variants in the group are hidden from the calculator
  categoryGramLimits: {}, // category name -> max grams per food in that category (solver upper bound); undefined = unbounded
  foodGramLimits: {},     // food name -> max grams, overrides the category default for that one food
};

// Curated groups of foods that are really the same product at different cuts/
// preparations (e.g. chicken breast vs thigh) -- NOT foods that merely share a
// first word but are nutritionally distinct products (almonds vs walnuts,
// salmon vs cod, cheddar vs cottage cheese stay separate). Simplify collapses
// each group down to its `rep` (most common/generic variant) for calculator
// and solver purposes; the other names in the group are excluded from
// selection while simplifyVariants is on, but remain untouched in the raw
// catalogue/JSON.
const SIMPLIFY_GROUPS = [
  { rep: 'Chicken, broilers or fryers, breast, meat only, cooked, roasted',
    members: ['Chicken, broilers or fryers, breast, meat only, cooked, roasted', 'Chicken, broilers or fryers, thigh, meat only, cooked, roasted'] },
  { rep: 'Beef, ground, 85% lean meat / 15% fat, patty, cooked, broiled',
    members: ['Beef, ground, 85% lean meat / 15% fat, patty, cooked, broiled', 'Beef, ground, 93% lean meat / 7% fat, patty, cooked, broiled'] },
  { rep: 'Cabbage, raw',
    members: ['Cabbage, raw', 'Cabbage, chinese (pak-choi), raw', 'Cabbage, chinese (pe-tsai), raw'] },
  { rep: 'Rice, white, long-grain, regular, cooked, enriched, with salt',
    members: ['Rice, white, long-grain, regular, cooked, enriched, with salt', "Rice, brown, long-grain, cooked (Includes foods for USDA's Food Distribution Program)"] },
  { rep: 'Bread, whole-wheat, commercially prepared',
    members: ['Bread, white, commercially prepared (includes soft bread crumbs)', 'Bread, whole-wheat, commercially prepared'] },
  { rep: 'Pasta, cooked, enriched, without added salt',
    members: ['Pasta, cooked, enriched, without added salt', "Pasta, whole-wheat, cooked (Includes foods for USDA's Food Distribution Program)"] },
  { rep: 'Milk, whole, 3.25% milkfat, with added vitamin D',
    members: ['Milk, whole, 3.25% milkfat, with added vitamin D', 'Milk, nonfat, fluid, with added vitamin A and vitamin D (fat free or skim)'] },
  { rep: "Yogurt, Greek, plain, nonfat (Includes foods for USDA's Food Distribution Program)",
    members: ["Yogurt, Greek, plain, nonfat (Includes foods for USDA's Food Distribution Program)", 'Yogurt, plain, whole milk'] },
];

// name -> true for every non-representative member of a simplify group.
const SIMPLIFY_HIDDEN_NAMES = new Set(
  SIMPLIFY_GROUPS.flatMap(g => g.members.filter(m => m !== g.rep))
);

// Standard grocery-aisle grouping used for gram-limit defaults. Foods keep
// their existing `category` field (Meats/Vegetables/Fruits/Nuts/Grains/Dairy)
// for the catalogue/picker grouping -- this is the same field, reused here so
// one limit input per category applies to everything already grouped there.
const GRAM_LIMIT_CATEGORIES = ['Meats', 'Vegetables', 'Fruits', 'Nuts', 'Grains', 'Dairy'];

// ============================================================================
// PERSISTENCE (localStorage) -- profile, overrides, disabled/custom/edited foods
// ============================================================================
const LS_KEY = 'harvestLedger.v1';

function saveState(){
  try{
    const toSave = {
      profile: state.profile,
      selectedFoods: state.selectedFoods,
      overrides: state.overrides,
      disabledFoods: state.disabledFoods,
      customFoods: state.customFoods,
      editedFoods: state.editedFoods,
      simplifyVariants: state.simplifyVariants,
      categoryGramLimits: state.categoryGramLimits,
      foodGramLimits: state.foodGramLimits,
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
    if(parsed.selectedFoods) state.selectedFoods = parsed.selectedFoods;
    if(parsed.overrides) state.overrides = parsed.overrides;
    if(parsed.disabledFoods) state.disabledFoods = parsed.disabledFoods;
    if(parsed.customFoods) state.customFoods = parsed.customFoods;
    if(parsed.editedFoods) state.editedFoods = parsed.editedFoods;
    if(typeof parsed.simplifyVariants === 'boolean') state.simplifyVariants = parsed.simplifyVariants;
    if(parsed.categoryGramLimits) state.categoryGramLimits = parsed.categoryGramLimits;
    if(parsed.foodGramLimits) state.foodGramLimits = parsed.foodGramLimits;
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
    // hiddenByVariant: true for non-representative members of a SIMPLIFY_GROUPS
    // entry while simplifyVariants is on -- kept in FOODS (catalogue still
    // shows every USDA entry) but excluded from the calculator's food picker
    // and solver, same treatment as a disabled food gets there.
    food.hiddenByVariant = state.simplifyVariants && SIMPLIFY_HIDDEN_NAMES.has(f.name);
    return food;
  });
  FOODS = merged;
}

// Resolves the gram cap the solver should enforce for one food: a manual
// per-food override always wins; otherwise the food's category default;
// otherwise unbounded (null). Both override and default are just a number on
// the same "max grams for this food" concept -- there's no separate
// mechanism, the override simply takes precedence when set.
function resolveGramLimit(food){
  const override = state.foodGramLimits[food.name];
  if(override !== undefined && override !== null && override !== ''){
    const n = parseFloat(override);
    return isNaN(n) ? null : n;
  }
  const catDefault = state.categoryGramLimits[food.category];
  if(catDefault !== undefined && catDefault !== null && catDefault !== ''){
    const n = parseFloat(catDefault);
    return isNaN(n) ? null : n;
  }
  return null;
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
  if(name === 'landing'){ renderHeroCard(); renderMacroPie(); }
}

// ============================================================================
// TOAST (transient button-press feedback)
// ============================================================================
function showToast(message, { error = false } = {}){
  const container = document.getElementById('toastContainer');
  if(!container) return;
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' toast-error' : '');
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.remove(), 250);
  }, 2200);
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
  renderMacroPie();
  showToast('Profile saved');
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

// Plain SVG pie/donut, no charting library -- keeps the app dependency-free.
// `slices` is [{label, value, color}]; values are normalized to the circle.
function svgPieChart(slices, { size = 120, donut = true, holeRatio = 0.55 } = {}){
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = size / 2;
  const cx = r, cy = r;
  if(total <= 0){
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${cx}" cy="${cy}" r="${r-1}" fill="none" stroke="var(--line-strong)" stroke-width="1"/></svg>`;
  }
  let angle = -Math.PI / 2;
  const paths = slices.filter(s => s.value > 0).map(s => {
    const frac = s.value / total;
    const start = angle;
    const end = angle + frac * Math.PI * 2;
    angle = end;
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    const large = (end - start) > Math.PI ? 1 : 0;
    if(frac >= 0.9999){
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${s.color}"><title>${s.label}: ${Math.round(frac*100)}%</title></circle>`;
    }
    return `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${s.color}"><title>${s.label}: ${Math.round(frac*100)}%</title></path>`;
  }).join('');
  const hole = donut ? `<circle cx="${cx}" cy="${cy}" r="${r*holeRatio}" fill="var(--paper)"/>` : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths}${hole}</svg>`;
}

const ACTIVITY_FACTORS = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
};

// Mifflin-St Jeor BMR, scaled by activity factor. Returns null if weight/height/age
// are missing or zero -- there is no sane fallback estimate to show instead.
function estimateCalorieTarget(profile){
  const { weight, height, age, sex, activity } = profile;
  if(!weight || !height || !age) return null;
  const sexOffset = (sex === 'female' || sex === 'pregnant' || sex === 'lactating') ? -161 : 5;
  const bmr = 10 * weight + 6.25 * height - 5 * age + sexOffset;
  const factor = ACTIVITY_FACTORS[activity] || ACTIVITY_FACTORS.moderate;
  return bmr * factor;
}

function renderMacroPie(){
  const el = document.getElementById('macroPieChart');
  if(!el) return;
  const { targets } = getTargets();
  const calorieTarget = estimateCalorieTarget(state.profile);
  if(!calorieTarget){
    el.innerHTML = '<div class="field-hint">Enter your weight, height and age in your profile to see your macro split and calorie target.</div>';
    return;
  }
  const p = targets.protein_g || 0, c = targets.carb_g || 0;
  const kcalP = p * 4, kcalC = c * 4;
  // Fat has no fixed DRI gram target for adults (AMDR is a % range, not an
  // RDA/AI) -- see fat_g in dri.json. Deriving it as the remainder keeps the
  // three slices summing to the actual estimated calorie target instead of
  // silently treating the missing fat value as 0.
  const kcalF = Math.max(0, calorieTarget - kcalP - kcalC);
  const slices = [
    { label: 'Protein', value: kcalP, color: 'var(--forest)' },
    { label: 'Carbohydrate', value: kcalC, color: 'var(--gold)' },
    { label: 'Fat', value: kcalF, color: 'var(--brick)' },
  ];
  el.innerHTML = `
    <div class="pie-chart-row pie-chart-row-centered">
      ${svgPieChart(slices, { size: 220 })}
      <div class="pie-legend">
        ${slices.map(s => `<div class="pie-legend-row"><span class="pie-swatch" style="background:${s.color}"></span>${s.label} <span class="pie-legend-pct">${Math.round(s.value/calorieTarget*100)}%</span></div>`).join('')}
        <div class="pie-legend-total">${Math.round(calorieTarget)} kcal/day estimated target</div>
      </div>
    </div>`;
}

function renderHeroCard(){
  const { stage, targets } = getTargets();
  const title = document.getElementById('heroCardTitle');
  if(stage) title.textContent = `TODAY'S TARGET — ${stage.label.toUpperCase()}`;
  const rows = document.getElementById('heroNutrientRows');
  rows.innerHTML = TRACKABLE_KEYS.map(k => {
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
  const available = FOODS.filter(f => f.enabled && !f.hiddenByVariant && (!q || foodMatchesQuery(f, q)));

  const renderItem = (f) => {
    const checked = state.selectedFoods[f.name] ? 'checked' : '';
    const sel = state.selectedFoods[f.name] ? 'selected' : '';
    // A <label> wrapping a checkbox natively forwards any click on the label
    // (including on the "span" text) into a synthetic click on its checkbox
    // -- that forwarding fires *after* our own onmousedown handler already
    // toggled state.selectedFoods via applyDragSelect, so it immediately
    // toggles the checkbox right back and re-fires onchange with the
    // opposite value, undoing what the drag/click just did (visible as
    // "clicking a row to unselect it doesn't work"). Blocking the label's
    // own click event stops that native forwarding; it does not stop clicks
    // that land directly on the checkbox, which keep working via their own
    // native toggle + onchange.
    return `<label class="food-item ${sel}" data-name="${escAttr(f.name)}"
        onmousedown="foodPickerMouseDown('${escName(f.name)}', event)"
        onmouseenter="foodPickerMouseEnter('${escName(f.name)}')"
        onclick="if(event.target.tagName !== 'INPUT') event.preventDefault()">
      <input type="checkbox" ${checked} onchange="toggleFood('${escName(f.name)}', this.checked)">
      <span>${f.name}</span>
    </label>`;
  };

  let html = '';
  const byCat = {};
  available.forEach(f => (byCat[f.category] = byCat[f.category] || []).push(f));
  Object.keys(byCat).forEach(cat => {
    const allSelected = byCat[cat].every(f => state.selectedFoods[f.name]);
    html += `<div class="food-cat-label">
      <label class="cat-select-toggle" title="${allSelected ? 'Unselect' : 'Select'} all ${cat}">
        <input type="checkbox" ${allSelected ? 'checked' : ''} onchange="toggleCategorySelection('${escName(cat)}', this.checked)">
      </label>
      <span>${cat}</span>
    </div>`;
    html += byCat[cat].map(renderItem).join('');
  });
  list.innerHTML = html || '<div class="field-hint">No foods match your search.</div>';
}

// Used inside a JS string literal that itself sits inside a double-quoted
// HTML attribute (onclick="fn('...')") -- must escape both the JS quote (')
// and the HTML attribute quote ("), since a food name can contain either
// (e.g. the Lamb entry's literal 1/4" fat cut). Escaping only one of the two
// leaves the other free to break out of its respective quoting.
function escName(name){ return name.replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function escAttr(name){ return name.replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

function selectAllFoods(){
  const q = (document.getElementById('calcFoodSearch').value || '').toLowerCase();
  FOODS.filter(f => f.enabled && !f.hiddenByVariant && (!q || foodMatchesQuery(f, q))).forEach(f => {
    state.selectedFoods[f.name] = state.selectedFoods[f.name] || {};
  });
  saveState();
  renderFoodPicker();
  renderSelectedFoods();
}

function toggleCategorySelection(category, checked){
  const q = (document.getElementById('calcFoodSearch').value || '').toLowerCase();
  FOODS.filter(f => f.enabled && !f.hiddenByVariant && f.category === category && (!q || foodMatchesQuery(f, q))).forEach(f => {
    if(checked){
      state.selectedFoods[f.name] = state.selectedFoods[f.name] || {};
    } else {
      delete state.selectedFoods[f.name];
    }
  });
  saveState();
  renderFoodPicker();
  renderSelectedFoods();
}

function toggleFood(name, checked){
  if(checked){
    state.selectedFoods[name] = {};
  } else {
    delete state.selectedFoods[name];
  }
  saveState();
  renderFoodPicker();
  renderSelectedFoods();
}

// ---- drag-to-select in the food picker ----
// Mousedown on a food row starts a drag; the *first* row touched decides the
// target state (select if it was unselected, unselect if it was selected),
// and every row the pointer passes over while the button is held gets set to
// that same state. A plain click (no movement) still works via the row's own
// onchange handler -- drag tracking here does not preventDefault on mousedown,
// it only listens for mouseenter while dragging.
let dragSelectActive = false;
let dragSelectTargetState = true;

function foodPickerMouseDown(name, e){
  if(e.button !== 0) return; // left button only
  // A mousedown that started directly on the checkbox is a plain click --
  // let the checkbox's own native toggle + onchange handle it (fighting that
  // with a manual state write here causes the checked state to flip back on
  // the following click event). Drag-select only takes over when the press
  // starts on the label/row itself.
  if(e.target.tagName === 'INPUT') return;
  dragSelectActive = true;
  dragSelectTargetState = !state.selectedFoods[name];
  applyDragSelect(name);
  e.preventDefault(); // avoid text selection while dragging across labels
}

function foodPickerMouseEnter(name){
  if(!dragSelectActive) return;
  applyDragSelect(name);
}

function applyDragSelect(name){
  if(dragSelectTargetState){
    state.selectedFoods[name] = state.selectedFoods[name] || {};
  } else {
    delete state.selectedFoods[name];
  }
  const row = document.querySelector(`.food-item[data-name="${cssEscape(name)}"]`);
  if(row){
    row.classList.toggle('selected', dragSelectTargetState);
    const cb = row.querySelector('input[type=checkbox]');
    if(cb) cb.checked = dragSelectTargetState;
  }
  renderSelectedFoods();
}

document.addEventListener('mouseup', () => {
  if(dragSelectActive){
    dragSelectActive = false;
    saveState();
  }
});

function cssEscape(s){ return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'); }

function renderSelectedFoods(){
  const container = document.getElementById('selectedFoodsList');
  const names = Object.keys(state.selectedFoods);
  if(names.length === 0){
    container.innerHTML = '<div class="empty-state">No foods selected yet. Choose from the list on the left.</div>';
    return;
  }
  container.innerHTML = names.map(name => {
    return `<div class="selected-food-row">
      <div class="name">${name}</div>
      <button class="remove-btn" onclick="toggleFood('${escName(name)}', false)" title="Remove" aria-label="Remove ${name}">✕</button>
    </div>`;
  }).join('');
}

function clearSelection(){
  state.selectedFoods = {};
  saveState();
  renderFoodPicker();
  renderSelectedFoods();
  document.getElementById('resultsPanel').innerHTML = '';
}

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
    const nd = DRI.nutrients[key];
    const floorPct = (nd.floor_pct ?? 90) / 100;
    constraints[`min_${key}`] = { min: target * floorPct };
    const ceilVal = uls[key] !== undefined ? uls[key] : (nd.ceiling_pct ? target * (nd.ceiling_pct/100) : null);
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
  if(tab === 'settings'){ renderCategoryLimitsList(); renderFoodLimitsList(); }
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
  Object.keys(model.constraints).forEach(cKey => {
    if(cKey.startsWith('min_')) delete model.constraints[cKey].min;
  });

  TRACKABLE_KEYS.forEach(key => {
    const target = targets[key];
    if(target === null || target === undefined) return;
    const nd = DRI.nutrients[key];
    const floor = target * ((nd.floor_pct ?? 90) / 100);
    if(!floor) return;
    // link_<key>: (per-gram contribution summed over foods) - floor*cov_<key> = 0,
    // i.e. cov_<key> = actual/floor once solved -- expressed as an equality
    // constraint so the solver can freely trade grams against the bounded
    // cov_<key> variable instead of cov_<key> being computed after the fact.
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
    const nd = DRI.nutrients[key];
    const floor = target * ((nd.floor_pct ?? 90) / 100);
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
      Ranked by average coverage across all tracked nutrients (target band: 90%–110%, or the published upper limit where one exists). Hover a combination to see its own nutrient breakdown.
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
      const barClass = over ? 'over' : (pct >= 90 ? '' : 'under');
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
      <p style="font-size:13px; color:var(--ink-soft); margin-bottom:20px;">For each nutrient you're still short on (below the 90% floor), foods from the full catalogue ranked highest-to-lowest by content per 100g. Disabled foods are excluded.</p>`;
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
  let list = FOODS.filter(f => state.catalogueFilter === 'all' || f.category === state.catalogueFilter);
  if(q) list = list.filter(f => foodMatchesQuery(f, q));
  tbody.innerHTML = list.map(f => `
    <tr class="${f.enabled ? '' : 'row-disabled'} ${f.hiddenByVariant ? 'row-variant-hidden' : ''}">
      <td onclick="openFoodModal('${escName(f.name)}')" style="cursor:pointer;"><strong>${f.name}</strong>${f.hiddenByVariant ? ' <span class="tag tag-nodata">simplified out</span>' : ''}</td>
      <td>${f.category}</td>
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
  `).join('') || `<tr><td colspan="14" style="text-align:center; padding:30px; color:var(--ink-soft);">No foods match.</td></tr>`;
}

// "Simplify" collapses SIMPLIFY_GROUPS variants (e.g. chicken breast vs
// thigh) down to one representative for the calculator/solver -- the other
// variants stay visible in the catalogue (greyed out, tagged "simplified
// out") but can't be selected. This does NOT affect genuinely distinct foods
// (nuts, seeds, cheeses, fish species) -- see SIMPLIFY_GROUPS for the exact
// curated list.
function toggleSimplifyVariants(){
  state.simplifyVariants = !state.simplifyVariants;
  saveState();
  applyFoodOverrides();
  renderSimplifyVariantsUI();
  renderCatalogueTable();
  renderFoodPicker();
}

function renderSimplifyVariantsUI(){
  const btn = document.getElementById('simplifyVariantsBtn');
  const hint = document.getElementById('simplifyVariantsHint');
  if(btn) btn.classList.toggle('active', !!state.simplifyVariants);
  if(hint) hint.style.display = state.simplifyVariants ? '' : 'none';
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

document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && document.getElementById('foodModalBg').classList.contains('show')){
    closeFoodModal();
  }
});

// ---- food detail modal: view, edit, disable, source link ----
function openFoodModal(name){
  const f = FOODS.find(x => x.name === name);
  if(!f) return;
  const content = document.getElementById('foodModalContent');
  content.innerHTML = `
    <button class="modal-close" onclick="closeFoodModal()" aria-label="Close">✕</button>
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
    <button class="modal-close" onclick="closeFoodModal()" aria-label="Close">✕</button>
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
  if(!confirm(`Delete "${name}"? This cannot be undone.`)) return;
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
    <button class="modal-close" onclick="closeFoodModal()" aria-label="Close">✕</button>
    <h3>Add a custom food</h3>
    <div class="field-row"><label>Name</label><input type="text" id="newFoodName" placeholder="e.g. Homemade granola"></div>
    <div class="field-row"><label>Category</label>
      <select id="newFoodCategory">
        <option>Meats</option><option>Vegetables</option><option>Fruits</option><option>Nuts</option><option>Grains</option><option>Dairy</option>
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
  if(!name){ showToast('Please enter a food name.', { error: true }); return; }
  if(FOODS.some(f => f.name === name)){ showToast('A food with that name already exists.', { error: true }); return; }
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
  renderSimplifyVariantsUI();

  renderFoodPicker();
  renderSelectedFoods();
  renderCategoryLimitsList();
  renderFoodLimitsList();
  renderLandingCatStrip();
  renderLandingStats();
  renderHeroCard();
  renderMacroPie();
}

init();
