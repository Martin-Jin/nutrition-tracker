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
