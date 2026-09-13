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
    const { floor_pct: floor, ceiling_pct: ceilPct } = resolveNutrientBuffer(key);
    // Sodium's ceiling is a CDRR (Chronic Disease Risk Reduction Intake) --
    // NASEM's 2019 DRI report found insufficient evidence for a true
    // toxicological UL for sodium and used cardiovascular/blood-pressure
    // outcome evidence instead. Labeling it the same as iron/vitamin A's UL
    // (acute-toxicity-based) would overstate what the sodium ceiling means.
    const ceilLabel = nd.ul_type === 'CDRR' ? 'CDRR' : 'UL';
    const ceil = uls[key] !== undefined ? `${ceilLabel} ${uls[key]}` : (ceilPct ? `${ceilPct}%` : '—');
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
