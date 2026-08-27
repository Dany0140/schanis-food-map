/* Schani's Food Map - App Logic */
'use strict';

// ── Helpers ──────────────────────────────────────────────────

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Escape for use inside a double-quoted HTML attribute. */
function escapeAttr(str) {
  return escapeHTML(str).replace(/"/g, '&quot;');
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Current local time as "HH:MM". */
function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

/** Sortable key combining date and time; meals without a time sort first. */
function mealSortKey(meal) {
  return `${meal.date} ${meal.time || '00:00'}`;
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
  stress: 'foodmap_stress_data',
};

const FEELINGS = {
  1: { emoji: '\u{1F63F}', label: 'Terrible', cls: 'feeling-terrible' },
  2: { emoji: '\u{1F61F}', label: 'Bad',      cls: 'feeling-bad' },
  3: { emoji: '\u{1F610}', label: 'Okay',     cls: 'feeling-okay' },
  4: { emoji: '\u{1F60A}', label: 'Good',     cls: 'feeling-good' },
  5: { emoji: '\u{1F970}', label: 'Great',    cls: 'feeling-great' },
};

const STRESS = {
  1: { emoji: '\u{1F60C}', label: 'Relaxed',     cls: 'stress-relaxed' },
  2: { emoji: '\u{1F642}', label: 'Calm',        cls: 'stress-calm' },
  3: { emoji: '\u{1F610}', label: 'Moderate',    cls: 'stress-moderate' },
  4: { emoji: '\u{1F630}', label: 'Tense',       cls: 'stress-tense' },
  5: { emoji: '\u{1F92F}', label: 'Overwhelmed', cls: 'stress-overwhelmed' },
};

const DEFAULT_STRESS = 3;

/** Fill in fields missing from older entries (meals saved before times existed). */
function normalizeMeal(meal) {
  return { ...meal, time: typeof meal.time === 'string' ? meal.time : '' };
}

const storedMeals = loadJSON(KEYS.meals, []);
let meals = Array.isArray(storedMeals) ? storedMeals.map(normalizeMeal) : [];
let waterData = loadJSON(KEYS.water, {});
let poopData = loadJSON(KEYS.poop, {});

/** One entry per day: { "YYYY-MM-DD": { level: 1-5, reason: string } } */
let stressData = normalizeStressData(loadJSON(KEYS.stress, {}));

/** Keep only well-formed day entries, clamping the level into 1-5. */
function normalizeStressData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  Object.keys(raw).forEach(date => {
    const entry = raw[date];
    if (!entry || typeof entry !== 'object') return;
    const level = Math.round(Number(entry.level));
    if (!Number.isFinite(level) || level < 1 || level > 5) return;
    out[date] = { level, reason: typeof entry.reason === 'string' ? entry.reason : '' };
  });
  return out;
}

function saveMeals() { localStorage.setItem(KEYS.meals, JSON.stringify(meals)); }
function saveTracking() {
  localStorage.setItem(KEYS.water, JSON.stringify(waterData));
  localStorage.setItem(KEYS.poop, JSON.stringify(poopData));
}
function saveStress() { localStorage.setItem(KEYS.stress, JSON.stringify(stressData)); }

// ── Router ───────────────────────────────────────────────────

function initRouter() {
  const pages = document.querySelectorAll('.page');
  const links = document.querySelectorAll('.tab-link');

  function navigate() {
    const hash = location.hash.replace('#', '') || 'today';
    pages.forEach(p => p.classList.toggle('active', p.id === `page-${hash}`));
    links.forEach(l => l.classList.toggle('active', l.dataset.page === hash));

    // Trigger page-specific rendering
    // Today's stress control is re-rendered on every visit so it can't hold a
    // stale prefill (edited in the diary, or the day rolled over past midnight).
    if (hash === 'today') renderStressControl(document.getElementById('stress-today'), todayISO);
    if (hash === 'diary') renderDiary();
    if (hash === 'analytics') renderAnalytics();
  }

  window.addEventListener('hashchange', navigate);
  navigate();
}

// ── Daily tracker factory ────────────────────────────────────

/** `getData` is a getter, not the object itself, so an import that swaps the
 *  underlying object (see initImport) doesn't leave the tracker on a stale one. */
function createDailyTracker({ getData, displayEl, step, unit, save }) {
  function getValue() { return getData()[todayISO()] || 0; }
  function render() { displayEl.textContent = unit ? getValue() + unit : String(getValue()); }
  function increment() {
    const t = todayISO();
    const data = getData();
    data[t] = (data[t] || 0) + step;
    save(); render();
  }
  function decrement() {
    const t = todayISO();
    const data = getData();
    if ((data[t] || 0) >= step) { data[t] -= step; save(); render(); }
  }
  render();
  return { increment, decrement, render };
}

let waterTracker = null;
let poopTracker = null;

/** Repaint the Today-page quick trackers after data changed elsewhere. */
function syncTodayTrackers() {
  if (waterTracker) waterTracker.render();
  if (poopTracker) poopTracker.render();
}

// ── Meal card HTML (shared by Today + Diary) ─────────────────

/** id of the meal currently open in the inline editor, or null. */
let editingMealId = null;

function mealCardHTML(meal, showActions) {
  if (showActions && meal.id === editingMealId) return mealEditHTML(meal);

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

  const stamp = meal.time ? `${formatDate(meal.date)} · ${meal.time}` : formatDate(meal.date);

  const actions = showActions
    ? '<div class="meal-actions">' +
        `<button class="meal-edit-btn" data-id="${escapeAttr(meal.id)}" aria-label="Edit meal ${escapeAttr(meal.name)}" title="Edit">&#9999;&#65039;</button>` +
        `<button class="meal-delete" data-id="${escapeAttr(meal.id)}" aria-label="Delete meal ${escapeAttr(meal.name)}" title="Delete">&times;</button>` +
      '</div>'
    : '';

  return (
    '<div class="meal-item">' +
      `<div class="meal-feeling" aria-hidden="true">${f.emoji}</div>` +
      '<div class="meal-content">' +
        `<div class="meal-name">${escapeHTML(meal.name)}</div>` +
        ingredientHTML +
        notesHTML +
        `<div class="meal-date">${escapeHTML(stamp)}</div>` +
      '</div>' +
      actions +
    '</div>'
  );
}

function mealEditHTML(meal) {
  const f = FEELINGS[meal.feeling] || FEELINGS[3];

  return (
    `<form class="meal-item meal-edit" data-id="${escapeAttr(meal.id)}">` +
      '<div class="meal-content">' +
        '<label class="edit-field"><span>Meal name</span>' +
          `<input type="text" class="edit-name" value="${escapeAttr(meal.name)}" required></label>` +
        '<label class="edit-field"><span>Ingredients (comma-separated)</span>' +
          `<input type="text" class="edit-ingredients" value="${escapeAttr(meal.ingredients || '')}"></label>` +
        // Not a <label>: its content model forbids the nested slider markup.
        '<div class="edit-field"><span>How did you feel?</span>' +
          '<div class="feeling-slider">' +
            `<input type="range" class="edit-feeling" min="1" max="5" value="${meal.feeling}" aria-label="How did you feel?">` +
            '<div class="feeling-display" aria-live="polite">' +
              `<span class="feeling-emoji edit-feeling-emoji">${f.emoji}</span>` +
              `<span class="feeling-label edit-feeling-label ${f.cls}">${f.label}</span>` +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="form-row">' +
          '<label class="edit-field"><span>Date</span>' +
            `<input type="date" class="edit-date" value="${escapeAttr(meal.date)}" required></label>` +
          '<label class="edit-field"><span>Time</span>' +
            `<input type="time" class="edit-time" value="${escapeAttr(meal.time || '')}"></label>` +
        '</div>' +
        '<label class="edit-field"><span>Notes</span>' +
          `<input type="text" class="edit-notes" value="${escapeAttr(meal.notes || '')}"></label>` +
        '<div class="edit-actions">' +
          '<button type="submit" class="btn btn-small btn-primary">Save</button>' +
          '<button type="button" class="btn btn-small btn-cancel edit-cancel">Cancel</button>' +
        '</div>' +
      '</div>' +
    '</form>'
  );
}

/** Re-render every view that shows meals (Today list + Diary). */
function refreshMealViews() {
  renderTodayMeals();
  renderDiary();
}

function attachMealHandlers(container) {
  container.querySelectorAll('.meal-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      meals = meals.filter(m => m.id !== btn.dataset.id);
      if (editingMealId === btn.dataset.id) editingMealId = null;
      saveMeals();
      refreshMealViews();
      showToast('Meal deleted');
    });
  });

  container.querySelectorAll('.meal-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      editingMealId = btn.dataset.id;
      refreshMealViews();
    });
  });

  container.querySelectorAll('.meal-edit').forEach(form => {
    const slider = form.querySelector('.edit-feeling');
    const emoji = form.querySelector('.edit-feeling-emoji');
    const label = form.querySelector('.edit-feeling-label');

    slider.addEventListener('input', () => {
      const f = FEELINGS[slider.value] || FEELINGS[3];
      emoji.textContent = f.emoji;
      label.textContent = f.label;
      label.className = `feeling-label edit-feeling-label ${f.cls}`;
    });

    form.querySelector('.edit-cancel').addEventListener('click', () => {
      editingMealId = null;
      refreshMealViews();
    });

    form.addEventListener('submit', e => {
      e.preventDefault();
      const meal = meals.find(m => m.id === form.dataset.id);
      if (!meal) return;

      const name = form.querySelector('.edit-name').value.trim();
      const date = form.querySelector('.edit-date').value;
      if (!name || !date) return;

      meal.name = name;
      meal.ingredients = form.querySelector('.edit-ingredients').value.trim();
      meal.feeling = parseInt(slider.value, 10);
      meal.date = date;
      meal.time = form.querySelector('.edit-time').value;
      meal.notes = form.querySelector('.edit-notes').value.trim();

      saveMeals();
      editingMealId = null;
      refreshMealViews();
      showToast('Meal updated!');
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

  const sorted = [...meals].sort((a, b) => mealSortKey(b).localeCompare(mealSortKey(a)));
  list.innerHTML = sorted.map(m => mealCardHTML(m, true)).join('');
  attachMealHandlers(list);
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
  const timeInput = document.getElementById('meal-time');
  dateInput.value = todayISO();
  timeInput.value = nowTime();

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
      time: timeInput.value,
      notes: document.getElementById('meal-notes').value.trim(),
    });

    saveMeals();
    renderTodayMeals();
    showToast('Meal saved!');
    form.reset();
    dateInput.value = todayISO();
    timeInput.value = nowTime();
    feelingCtrl.reset();
  });
}

// ── Stress level (one entry per day) ─────────────────────────

/** Every place a stress control lives. Today and Diary can point at the same
 *  day, so a commit in one has to refresh the other — otherwise the stale one
 *  would overwrite the fresh entry from its outdated prefill. */
const STRESS_VIEWS = [
  { id: 'stress-today', getDate: todayISO },
  { id: 'stress-diary', getDate: () => currentDiaryDate },
];

function renderStressControls(exceptId) {
  STRESS_VIEWS.forEach(view => {
    if (view.id === exceptId) return;   // never re-render the one being edited
    renderStressControl(document.getElementById(view.id), view.getDate);
  });
}

/**
 * Render the stress control for a day into `container`.
 * `getDate` is read lazily so the diary control follows the selected day.
 */
function renderStressControl(container, getDate) {
  // Missing container = a cached older index.html paired with this script.
  // Degrade quietly instead of breaking the rest of the page.
  if (!container) return;

  const entry = stressData[getDate()];
  const level = entry ? entry.level : DEFAULT_STRESS;
  const s = STRESS[level] || STRESS[DEFAULT_STRESS];

  container.innerHTML =
    '<div class="stress-head">' +
      '<span class="stress-title">Stress level</span>' +
      '<span class="stress-display" aria-live="polite">' +
        `<span class="stress-emoji" aria-hidden="true">${s.emoji}</span>` +
        `<span class="stress-label ${entry ? s.cls : 'stress-none'}">${entry ? s.label : 'Not logged'}</span>` +
      '</span>' +
    '</div>' +
    `<input type="range" class="stress-slider" min="1" max="5" value="${level}" aria-label="Stress level">` +
    '<label class="edit-field stress-reason-field"><span>Why?</span>' +
      `<input type="text" class="stress-reason" value="${escapeAttr(entry ? entry.reason : '')}" placeholder="What caused it?"></label>` +
    `<button type="button" class="btn-text stress-clear"${entry ? '' : ' hidden'}>Clear stress entry</button>`;

  attachStressHandlers(container, getDate);
}

function attachStressHandlers(container, getDate) {
  const slider = container.querySelector('.stress-slider');
  const reason = container.querySelector('.stress-reason');
  const clearBtn = container.querySelector('.stress-clear');
  const emoji = container.querySelector('.stress-emoji');
  const label = container.querySelector('.stress-label');

  function paint(level, logged) {
    const s = STRESS[level] || STRESS[DEFAULT_STRESS];
    emoji.textContent = s.emoji;
    label.textContent = logged ? s.label : 'Not logged';
    label.className = `stress-label ${logged ? s.cls : 'stress-none'}`;
    clearBtn.hidden = !logged;
  }

  // Autosave: one entry per day, overwritten in place.
  function commit() {
    const level = parseInt(slider.value, 10);
    stressData[getDate()] = { level, reason: reason.value.trim() };
    saveStress();
    paint(level, true);
    renderStressControls(container.id);
  }

  slider.addEventListener('input', commit);
  reason.addEventListener('input', commit);

  clearBtn.addEventListener('click', () => {
    delete stressData[getDate()];
    saveStress();
    slider.value = DEFAULT_STRESS;
    reason.value = '';
    paint(DEFAULT_STRESS, false);
    renderStressControls(container.id);
  });
}

// ── Diary page ───────────────────────────────────────────────

let currentDiaryDate = shiftDate(todayISO(), -1); // default: yesterday

function renderDiary() {
  const dateInput = document.getElementById('diary-date');
  const summary = document.getElementById('diary-summary');
  const mealList = document.getElementById('diary-meals');

  dateInput.value = currentDiaryDate;

  // Chronological within the day, so a day reads top-to-bottom.
  const dayMeals = meals
    .filter(m => m.date === currentDiaryDate)
    .sort((a, b) => mealSortKey(a).localeCompare(mealSortKey(b)));

  const water = waterData[currentDiaryDate] || 0;
  const poop = poopData[currentDiaryDate] || 0;

  summary.innerHTML =
    diaryStatHTML('water', '🥛', `${water}L`) +
    diaryStatHTML('poop', '💩', String(poop)) +
    `<div class="diary-stat"><span class="diary-stat-emoji">🍽️</span> ${dayMeals.length} meal${dayMeals.length !== 1 ? 's' : ''}</div>`;
  attachDiaryStatHandlers(summary);

  renderStressControl(document.getElementById('stress-diary'), () => currentDiaryDate);

  if (dayMeals.length === 0) {
    mealList.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-state-icon">📅</div>' +
        `<p>No meals tracked on ${escapeHTML(formatDateLong(currentDiaryDate))}</p>` +
      '</div>';
    return;
  }

  mealList.innerHTML = dayMeals.map(m => mealCardHTML(m, true)).join('');
  attachMealHandlers(mealList);
}

/** An editable water/poop stat for the day currently shown in the diary. */
function diaryStatHTML(kind, emoji, value) {
  return (
    '<div class="diary-stat">' +
      `<span class="diary-stat-emoji" aria-hidden="true">${emoji}</span>` +
      `<button class="diary-stat-btn" data-kind="${kind}" data-dir="-1" aria-label="Decrease ${kind}">&minus;</button>` +
      `<span class="diary-stat-value">${escapeHTML(value)}</span>` +
      `<button class="diary-stat-btn" data-kind="${kind}" data-dir="1" aria-label="Increase ${kind}">+</button>` +
    '</div>'
  );
}

function attachDiaryStatHandlers(container) {
  container.querySelectorAll('.diary-stat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const isWater = btn.dataset.kind === 'water';
      const data = isWater ? waterData : poopData;
      const step = (isWater ? 0.5 : 1) * Number(btn.dataset.dir);
      const next = Math.max(0, Math.round(((data[currentDiaryDate] || 0) + step) * 10) / 10);

      if (next === 0) delete data[currentDiaryDate];
      else data[currentDiaryDate] = next;

      saveTracking();
      renderDiary();
      if (currentDiaryDate === todayISO()) syncTodayTrackers();
    });
  });
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
    const payload = { version: 2, exportedAt: new Date().toISOString(), meals, waterData, poopData, stressData };
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

function initImport() {
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
          const valid = data.meals.filter(validateMeal).map(normalizeMeal);
          if (valid.length) {
            meals = valid;
            editingMealId = null;
            saveMeals();
            renderTodayMeals();
          }
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

        // Absent in v1 exports — leave existing stress entries untouched then.
        if (data.stressData !== undefined) {
          stressData = normalizeStressData(data.stressData);
          saveStress();
        }

        saveTracking();
        syncTodayTrackers();
        renderStressControl(document.getElementById('stress-today'), todayISO);
        renderDiary();
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

  waterTracker = createDailyTracker({
    getData: () => waterData,
    displayEl: document.getElementById('water-total'),
    step: 0.5, unit: 'L', save: saveTracking,
  });

  poopTracker = createDailyTracker({
    getData: () => poopData,
    displayEl: document.getElementById('poop-count'),
    step: 1, unit: '', save: saveTracking,
  });

  document.getElementById('water-plus').addEventListener('click', waterTracker.increment);
  document.getElementById('water-minus').addEventListener('click', waterTracker.decrement);
  document.getElementById('poop-plus').addEventListener('click', poopTracker.increment);
  document.getElementById('poop-minus').addEventListener('click', poopTracker.decrement);

  renderStressControl(document.getElementById('stress-today'), todayISO);

  renderTodayMeals();
  initDiary();
  initAnalytics();
  initExport();
  initImport();
  initRouter();
});
