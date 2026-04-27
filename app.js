/* Schani's Food Map - App Logic */
'use strict';

// ── Helpers ──────────────────────────────────────────────────

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    console.warn(`Corrupt localStorage key "${key}", using fallback.`);
    return fallback;
  }
}

function formatDate(isoString) {
  const date = new Date(isoString + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

function formatDateLong(isoString) {
  const date = new Date(isoString + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function parseIngredients(str) {
  if (!str) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

function showToast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2000);
}

/** Shift an ISO date string by n days. */
function shiftDate(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Generate array of ISO date strings from start to end inclusive. */
function dateRange(startISO, endISO) {
  const dates = [];
  let cur = startISO;
  while (cur <= endISO) {
    dates.push(cur);
    cur = shiftDate(cur, 1);
  }
  return dates;
}

// ── Storage ──────────────────────────────────────────────────

const KEYS = {
  meals: 'foodmap_meals',
  water: 'foodmap_water_data',
  poop: 'foodmap_poop_data',
};

const FEELINGS = {
  1: { emoji: '\u{1F63F}', label: 'Terrible', cls: 'feeling-terrible' },
  2: { emoji: '\u{1F61F}', label: 'Bad',      cls: 'feeling-bad' },
  3: { emoji: '\u{1F610}', label: 'Okay',     cls: 'feeling-okay' },
  4: { emoji: '\u{1F60A}', label: 'Good',     cls: 'feeling-good' },
  5: { emoji: '\u{1F970}', label: 'Great',    cls: 'feeling-great' },
};

let meals = loadJSON(KEYS.meals, []);
let waterData = loadJSON(KEYS.water, {});
let poopData = loadJSON(KEYS.poop, {});

function saveMeals() { localStorage.setItem(KEYS.meals, JSON.stringify(meals)); }
function saveTracking() {
  localStorage.setItem(KEYS.water, JSON.stringify(waterData));
  localStorage.setItem(KEYS.poop, JSON.stringify(poopData));
}

// ── Router ───────────────────────────────────────────────────

function initRouter() {
  const pages = document.querySelectorAll('.page');
  const links = document.querySelectorAll('.tab-link');

  function navigate() {
    const hash = location.hash.replace('#', '') || 'today';
    pages.forEach(p => p.classList.toggle('active', p.id === `page-${hash}`));
    links.forEach(l => l.classList.toggle('active', l.dataset.page === hash));

    // Trigger page-specific rendering
    if (hash === 'diary') renderDiary();
    if (hash === 'analytics') renderAnalytics();
  }

  window.addEventListener('hashchange', navigate);
  navigate();
}

// ── Daily tracker factory ────────────────────────────────────

function createDailyTracker({ data, displayEl, step, unit, save }) {
  function getValue() { return data[todayISO()] || 0; }
  function render() { displayEl.textContent = unit ? getValue() + unit : String(getValue()); }
  function increment() { const t = todayISO(); data[t] = (data[t] || 0) + step; save(); render(); }
  function decrement() { const t = todayISO(); if ((data[t] || 0) >= step) { data[t] -= step; save(); render(); } }
  render();
  return { increment, decrement, render };
}

// ── Meal card HTML (shared by Today + Diary) ─────────────────

function mealCardHTML(meal, showDelete) {
  const f = FEELINGS[meal.feeling] || FEELINGS[3];
  const ingredients = parseIngredients(meal.ingredients);

  let ingredientHTML = '';
  if (ingredients.length) {
    ingredientHTML =
      '<div class="meal-ingredients">' +
      ingredients.map(i => `<span class="ingredient-tag">${escapeHTML(i)}</span>`).join('') +
      '</div>';
  }

  let notesHTML = meal.notes ? `<div class="meal-notes">${escapeHTML(meal.notes)}</div>` : '';

  const deleteBtn = showDelete
    ? `<button class="meal-delete" data-id="${escapeHTML(meal.id)}" aria-label="Delete meal ${escapeHTML(meal.name)}" title="Delete">&times;</button>`
    : '';

  return (
    '<div class="meal-item">' +
      `<div class="meal-feeling" aria-hidden="true">${f.emoji}</div>` +
      '<div class="meal-content">' +
        `<div class="meal-name">${escapeHTML(meal.name)}</div>` +
        ingredientHTML +
        notesHTML +
        `<div class="meal-date">${escapeHTML(formatDate(meal.date))}</div>` +
      '</div>' +
      deleteBtn +
    '</div>'
  );
}

function attachDeleteHandlers(container) {
  container.querySelectorAll('.meal-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      meals = meals.filter(m => m.id !== btn.dataset.id);
      saveMeals();
      renderTodayMeals();
      // Also refresh diary if it's showing the same date
      renderDiary();
      showToast('Meal deleted');
    });
  });
}

// ── Today page ───────────────────────────────────────────────

function renderTodayMeals() {
  const list = document.getElementById('meal-list');

  if (meals.length === 0) {
    list.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-state-icon">🍽️</div>' +
        '<p>No meals tracked yet~<br>Add your first meal above!</p>' +
      '</div>';
    return;
  }

  const sorted = [...meals].sort((a, b) => new Date(b.date) - new Date(a.date));
  list.innerHTML = sorted.map(m => mealCardHTML(m, true)).join('');
  attachDeleteHandlers(list);
}

function initFeelingSlider() {
  const slider = document.getElementById('meal-feeling');
  const emoji = document.getElementById('feeling-emoji');
  const label = document.getElementById('feeling-label');

  function update(val) {
    const f = FEELINGS[val];
    emoji.textContent = f.emoji;
    label.textContent = f.label;
    label.className = 'feeling-label ' + f.cls;
  }

  slider.addEventListener('input', e => update(e.target.value));
  update(3);
  return { slider, reset: () => { slider.value = 3; update(3); } };
}

function initForm(feelingCtrl) {
  const form = document.getElementById('meal-form');
  const dateInput = document.getElementById('meal-date');
  dateInput.value = todayISO();

  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('meal-name').value.trim();
    if (!name) return;

    meals.unshift({
      id: Date.now().toString(),
      name,
      ingredients: document.getElementById('meal-ingredients').value.trim(),
      feeling: parseInt(document.getElementById('meal-feeling').value, 10),
      date: dateInput.value,
      notes: document.getElementById('meal-notes').value.trim(),
    });

    saveMeals();
    renderTodayMeals();
    showToast('Meal saved!');
    form.reset();
    dateInput.value = todayISO();
    feelingCtrl.reset();
  });
}

// ── Diary page ───────────────────────────────────────────────

let currentDiaryDate = shiftDate(todayISO(), -1); // default: yesterday

function renderDiary() {
  const dateInput = document.getElementById('diary-date');
  const summary = document.getElementById('diary-summary');
  const mealList = document.getElementById('diary-meals');

  dateInput.value = currentDiaryDate;

  const dayMeals = meals
    .filter(m => m.date === currentDiaryDate)
    .sort((a, b) => b.id.localeCompare(a.id));

  const water = waterData[currentDiaryDate] || 0;
  const poop = poopData[currentDiaryDate] || 0;

  summary.innerHTML =
    `<div class="diary-stat"><span class="diary-stat-emoji">🥛</span> ${water}L</div>` +
    `<div class="diary-stat"><span class="diary-stat-emoji">💩</span> ${poop}</div>` +
    `<div class="diary-stat"><span class="diary-stat-emoji">🍽️</span> ${dayMeals.length} meal${dayMeals.length !== 1 ? 's' : ''}</div>`;

  if (dayMeals.length === 0) {
    mealList.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-state-icon">📅</div>' +
        `<p>No meals tracked on ${escapeHTML(formatDateLong(currentDiaryDate))}</p>` +
      '</div>';
    return;
  }

  mealList.innerHTML = dayMeals.map(m => mealCardHTML(m, true)).join('');
  attachDeleteHandlers(mealList);
}

function initDiary() {
  document.getElementById('diary-prev').addEventListener('click', () => {
    currentDiaryDate = shiftDate(currentDiaryDate, -1);
    renderDiary();
  });
  document.getElementById('diary-next').addEventListener('click', () => {
    currentDiaryDate = shiftDate(currentDiaryDate, 1);
    renderDiary();
  });
  document.getElementById('diary-date').addEventListener('change', e => {
    if (e.target.value) {
      currentDiaryDate = e.target.value;
      renderDiary();
    }
  });
}

// ── Analytics page ───────────────────────────────────────────

let chartFeeling = null;
let chartTracking = null;
let chartIngredients = null;
let analyticsRange = 7;

function getAnalyticsDateRange() {
  const end = todayISO();
  if (analyticsRange === 'all') {
    // Find earliest date across all data
    const allDates = [
      ...meals.map(m => m.date),
      ...Object.keys(waterData),
      ...Object.keys(poopData),
    ].filter(Boolean).sort();
    const start = allDates.length ? allDates[0] : end;
    return dateRange(start, end);
  }
  const start = shiftDate(end, -(analyticsRange - 1));
  return dateRange(start, end);
}

function chartColors() {
  return {
    pink: 'rgba(244, 143, 177, 1)',
    pinkFill: 'rgba(244, 143, 177, 0.2)',
    blue: 'rgba(100, 181, 246, 1)',
    blueFill: 'rgba(100, 181, 246, 0.3)',
    brown: 'rgba(188, 143, 107, 1)',
    brownFill: 'rgba(188, 143, 107, 0.3)',
    green: 'rgba(168, 230, 207, 1)',
    red: 'rgba(255, 158, 158, 1)',
    yellow: 'rgba(255, 229, 160, 1)',
  };
}

function destroyCharts() {
  if (chartFeeling) { chartFeeling.destroy(); chartFeeling = null; }
  if (chartTracking) { chartTracking.destroy(); chartTracking = null; }
  if (chartIngredients) { chartIngredients.destroy(); chartIngredients = null; }
}

function shortLabel(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderAnalytics() {
  if (typeof Chart === 'undefined') return; // Chart.js not loaded yet

  destroyCharts();
  const c = chartColors();
  const dates = getAnalyticsDateRange();
  const labels = dates.map(shortLabel);

  // ── Feeling trend ──
  const feelingByDate = {};
  meals.forEach(m => {
    if (!feelingByDate[m.date]) feelingByDate[m.date] = [];
    feelingByDate[m.date].push(m.feeling);
  });
  const feelingAvg = dates.map(d => {
    const vals = feelingByDate[d];
    if (!vals || !vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  });

  chartFeeling = new Chart(document.getElementById('chart-feeling'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Avg Feeling',
        data: feelingAvg,
        borderColor: c.pink,
        backgroundColor: c.pinkFill,
        fill: true,
        tension: 0.3,
        spanGaps: true,
        pointRadius: 3,
        pointHoverRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { min: 1, max: 5, ticks: { stepSize: 1, callback: v => (FEELINGS[v] || {}).emoji || v } },
        x: { ticks: { maxTicksLimit: 10 } },
      },
      plugins: { legend: { display: false } },
    },
  });

  // ── Water & Poop ──
  const waterVals = dates.map(d => waterData[d] || 0);
  const poopVals = dates.map(d => poopData[d] || 0);

  chartTracking = new Chart(document.getElementById('chart-tracking'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Water (L)', data: waterVals, backgroundColor: c.blueFill, borderColor: c.blue, borderWidth: 1 },
        { label: 'Poop', data: poopVals, backgroundColor: c.brownFill, borderColor: c.brown, borderWidth: 1 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true },
        x: { ticks: { maxTicksLimit: 10 } },
      },
      plugins: { legend: { position: 'top' } },
    },
  });

  // ── Ingredient-feeling correlation ──
  const ingredientFeelings = {};
  meals.forEach(m => {
    parseIngredients(m.ingredients).forEach(ing => {
      const key = ing.toLowerCase();
      if (!ingredientFeelings[key]) ingredientFeelings[key] = { name: ing, feelings: [] };
      ingredientFeelings[key].feelings.push(m.feeling);
    });
  });

  const filtered = Object.values(ingredientFeelings)
    .filter(i => i.feelings.length >= 3)
    .map(i => ({
      name: i.name,
      avg: i.feelings.reduce((a, b) => a + b, 0) / i.feelings.length,
      count: i.feelings.length,
    }))
    .sort((a, b) => b.avg - a.avg);

  const ingLabels = filtered.map(i => `${i.name} (${i.count}x)`);
  const ingData = filtered.map(i => Math.round(i.avg * 100) / 100);
  const ingColors = filtered.map(i => {
    if (i.avg >= 4) return c.green;
    if (i.avg >= 3) return c.yellow;
    return c.red;
  });

  chartIngredients = new Chart(document.getElementById('chart-ingredients'), {
    type: 'bar',
    data: {
      labels: ingLabels,
      datasets: [{
        label: 'Avg Feeling',
        data: ingData,
        backgroundColor: ingColors,
        borderWidth: 0,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      scales: {
        x: { min: 1, max: 5, ticks: { stepSize: 1 } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function initAnalytics() {
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      analyticsRange = btn.dataset.range === 'all' ? 'all' : parseInt(btn.dataset.range, 10);
      renderAnalytics();
    });
  });
}

// ── Import / Export ──────────────────────────────────────────

function validateMeal(m) {
  return m && typeof m.id === 'string' && typeof m.name === 'string' &&
    typeof m.feeling === 'number' && typeof m.date === 'string';
}

function initExport() {
  document.getElementById('export-btn').addEventListener('click', () => {
    const payload = { version: 1, exportedAt: new Date().toISOString(), meals, waterData, poopData };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `foodmap-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported!');
  });
}

function initImport(waterTracker, poopTracker) {
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const data = JSON.parse(event.target.result);

        if (Array.isArray(data.meals)) {
          const valid = data.meals.filter(validateMeal);
          if (valid.length) { meals = valid; saveMeals(); renderTodayMeals(); }
        }

        if (data.waterData && typeof data.waterData === 'object' && !Array.isArray(data.waterData)) {
          waterData = data.waterData;
        } else if (typeof data.waterDrank === 'number') {
          waterData[todayISO()] = data.waterDrank;
        }

        if (data.poopData && typeof data.poopData === 'object' && !Array.isArray(data.poopData)) {
          poopData = data.poopData;
        } else if (Array.isArray(data.pooped)) {
          poopData[todayISO()] = data.pooped.length;
        } else if (typeof data.dailyPoopCount === 'number') {
          poopData[todayISO()] = data.dailyPoopCount;
        }

        saveTracking();
        waterTracker.render();
        poopTracker.render();
        showToast('Data imported!');
      } catch {
        showToast('Import failed — invalid file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

// ── Boot ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const feelingCtrl = initFeelingSlider();
  initForm(feelingCtrl);

  const waterTracker = createDailyTracker({
    data: waterData,
    displayEl: document.getElementById('water-total'),
    step: 0.5, unit: 'L', save: saveTracking,
  });

  const poopTracker = createDailyTracker({
    data: poopData,
    displayEl: document.getElementById('poop-count'),
    step: 1, unit: '', save: saveTracking,
  });

  document.getElementById('water-plus').addEventListener('click', waterTracker.increment);
  document.getElementById('water-minus').addEventListener('click', waterTracker.decrement);
  document.getElementById('poop-plus').addEventListener('click', poopTracker.increment);
  document.getElementById('poop-minus').addEventListener('click', poopTracker.decrement);

  renderTodayMeals();
  initDiary();
  initAnalytics();
  initExport();
  initImport(waterTracker, poopTracker);
  initRouter();
});
