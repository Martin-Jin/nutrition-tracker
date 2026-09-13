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
  nutrientBufferOverrides: {}, // nutrient key -> { floor_pct, ceiling_pct }, overrides dri.json's shipped default for that nutrient
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
  { rep: 'Rice, white, long-grain, regular, enriched, cooked',
    members: ['Rice, white, long-grain, regular, enriched, cooked', "Rice, brown, long-grain, cooked (Includes foods for USDA's Food Distribution Program)"] },
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
      nutrientBufferOverrides: state.nutrientBufferOverrides,
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
    if(parsed.nutrientBufferOverrides) state.nutrientBufferOverrides = parsed.nutrientBufferOverrides;
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

// Resolves the floor/ceiling percent band the solver should enforce for one
// nutrient: a user override (set in the Settings tab) always wins; otherwise
// dri.json's shipped default (see each nutrient's floor_pct/ceiling_pct and,
// for macros, the AMDR-informed comment explaining the wider default band).
// Nutrients with a real UL/CDRR always keep that as their hard ceiling
// regardless of ceiling_pct -- this only resolves the percent-of-target band
// used when no UL/CDRR applies, or as the floor either way.
function resolveNutrientBuffer(key){
  const nd = DRI.nutrients[key];
  const override = state.nutrientBufferOverrides[key];
  const floor_pct = (override && override.floor_pct !== undefined && override.floor_pct !== null && override.floor_pct !== '')
    ? parseFloat(override.floor_pct) : (nd.floor_pct ?? 90);
  const ceiling_pct = (override && override.ceiling_pct !== undefined && override.ceiling_pct !== null && override.ceiling_pct !== '')
    ? parseFloat(override.ceiling_pct) : (nd.ceiling_pct ?? null);
  return { floor_pct: isNaN(floor_pct) ? (nd.floor_pct ?? 90) : floor_pct, ceiling_pct: (ceiling_pct !== null && isNaN(ceiling_pct)) ? (nd.ceiling_pct ?? null) : ceiling_pct };
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
