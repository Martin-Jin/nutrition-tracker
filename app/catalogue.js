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
  if(e.key === 'Escape' && document.getElementById('pieModalBg').classList.contains('show')){
    closePieModal();
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
