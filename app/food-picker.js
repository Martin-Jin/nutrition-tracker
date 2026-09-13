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
