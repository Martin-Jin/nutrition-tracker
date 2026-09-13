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
