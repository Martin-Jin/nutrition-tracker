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
  renderNutrientBufferList();
  renderLandingCatStrip();
  renderLandingStats();
  renderHeroCard();
  renderMacroPie();
}

init();
