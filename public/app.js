const state = {
  game: null,
  selectedMovieIdx: null,
  assignments: {},
  locked: false,
  results: null,
  isPastPuzzle: false,
  puzzleDate: null,
  showingBest: false,
};

const STORAGE_KEY = d => `slotflix-assignments-${d}`;
const RESULTS_KEY = d => `slotflix-results-${d}`;
const PAST_PREFIX = 'slotflix-past-';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function show(el) { if (el) el.hidden = false; }
function hide(el) { if (el) el.hidden = true; }

/* ── Countdown ── */
let countdownInterval;

function startCountdown() {
  function tick() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const diff = Math.max(0, tomorrow - now);
    const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
    const text = `${h}:${m}:${s}`;
    const f = $('#f-countdown');
    if (f) f.textContent = text;
    const urgent = diff < 3600000;
    if (f) f.classList.toggle('urgent', urgent);
  }
  tick();
  clearInterval(countdownInterval);
  countdownInterval = setInterval(tick, 1000);
}

/* ── Share ── */
function shareResult() {
  const r = state.results;
  if (!r) return;
  const dateLabel = state.isPastPuzzle ? r.date : 'Today';
  const text = `🎬 SlotFlix — ${dateLabel}: ${r.total}/${r.bestPossible}\n\nPlay at ${location.origin}`;

  if (navigator.share) {
    navigator.share({ title: 'SlotFlix Score', text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      const btn = $('#share-btn');
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    }).catch(() => {});
  }
}

/* ── Scoring Reference ── */
window.toggleScoring = function() {
  const el = $('#scoring-ref');
  el.hidden = !el.hidden;
};

/* ── Init ── */
async function init() {
  startCountdown();
  state.token = null;
  localStorage.removeItem('slotflix-token');

  const res = await fetch('/api/game');
  const game = await res.json();

  if (!game.available) {
    hide($('#loading'));
    $('#no-game-msg').textContent = game.message || 'No game available today.';
    show($('#no-game'));
    return;
  }

  state.game = game;
  hide($('#loading'));
  show($('#game-area'));
  renderGame();
  updateSteps();
}

/* ── Render ── */
function renderGame() {
  const g = state.game;
  renderMovies(g.movies);
  renderSlots(g.slots);

  const storageDate = g.date;
  const assignKey = state.isPastPuzzle ? `${PAST_PREFIX}assign-${storageDate}` : STORAGE_KEY(storageDate);
  const resultKey = state.isPastPuzzle ? `${PAST_PREFIX}result-${storageDate}` : RESULTS_KEY(storageDate);

  const saved = localStorage.getItem(assignKey);
  const savedResults = localStorage.getItem(resultKey);

  if (savedResults) {
    try {
      const parsed = JSON.parse(savedResults);
      if (parsed.bestPossible === undefined || parsed.results === undefined) {
        localStorage.removeItem(resultKey);
      } else {
        state.results = parsed;
        state.locked = true;
        showResults();
        return;
      }
    } catch {
      localStorage.removeItem(resultKey);
    }
  }

  if (saved) {
    try {
      state.assignments = JSON.parse(saved);
      updateSlotDisplay();
      checkLockReady();
    } catch {}
  }
}

function saveAssignments() {
  const key = state.isPastPuzzle
    ? `${PAST_PREFIX}assign-${state.game.date}`
    : STORAGE_KEY(state.game.date);
  localStorage.setItem(key, JSON.stringify(state.assignments));
}

function renderMovies(movies) {
  const el = $('#movie-list');
  el.innerHTML = movies.map((m, i) => `
    <div class="movie-card" data-idx="${i}" draggable="true">
      <div class="poster">
        ${m.poster ? `<img src="${m.poster}" alt="${m.title}" loading="lazy">` : '<span class="no-poster">🎬</span>'}
      </div>
      <div class="title">${m.title}</div>
    </div>
  `).join('');

  el.querySelectorAll('.movie-card').forEach(c => {
    const idx = parseInt(c.dataset.idx);

    c.addEventListener('click', () => selectMovie(idx));

    /* HTML5 DnD */
    c.addEventListener('dragstart', e => {
      if (state.locked) return e.preventDefault();
      if (Object.values(state.assignments).includes(idx)) return e.preventDefault();
      e.dataTransfer.setData('text/plain', idx);
      e.dataTransfer.effectAllowed = 'move';
      c.classList.add('dragging');
    });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));

    /* Touch DnD */
    c.addEventListener('touchstart', e => onTouchStart(e, idx), { passive: false });
    c.addEventListener('touchmove', onTouchMove, { passive: false });
    c.addEventListener('touchend', onTouchEnd, { passive: false });
  });
}

function renderSlots(slots) {
  const el = $('#slot-list');
  el.innerHTML = slots.map((s, i) => `
    <div class="slot-card" data-slot="${s.id}">
      <div class="slot-number">${i + 1}</div>
      <div class="slot-info">
        <div class="slot-name">${s.name}</div>
        <div class="slot-desc">${s.desc}</div>
      </div>
      <div class="slot-movie" id="slot-movie-${s.id}"></div>
      <div class="slot-assign-hint" id="slot-hint-${s.id}">tap to assign</div>
    </div>
  `).join('');

  el.querySelectorAll('.slot-card').forEach(c => {
    const slotId = c.dataset.slot;

    c.addEventListener('click', () => selectSlot(slotId));

    /* HTML5 DnD */
    c.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      c.classList.add('drag-over');
    });
    c.addEventListener('dragleave', () => c.classList.remove('drag-over'));
    c.addEventListener('drop', e => {
      e.preventDefault();
      c.classList.remove('drag-over');
      const movieIdx = parseInt(e.dataTransfer.getData('text/plain'));
      if (!isNaN(movieIdx)) assignMovie(slotId, movieIdx);
    });
  });
}

/* ── Selection (tap) ── */
function selectMovie(idx) {
  if (state.locked) return;
  if (Object.values(state.assignments).includes(idx)) return;

  state.selectedMovieIdx = idx;
  $$('.movie-card').forEach(c => c.classList.toggle('selected', parseInt(c.dataset.idx) === idx));
  $('#status-text').textContent = `Selected: ${state.game.movies[idx].title} — tap a slot`;
  updateSteps();
}

function selectSlot(slotId) {
  if (state.locked) return;

  if (state.selectedMovieIdx !== null) {
    assignMovie(slotId, state.selectedMovieIdx);
  } else if (state.assignments[slotId] !== undefined) {
    delete state.assignments[slotId];
    saveAssignments();
    updateSlotDisplay();
    checkLockReady();
    $('#status-text').textContent = 'Removed. Tap a movie, then tap a slot.';
    updateSteps();
  }
}

/* ── Assign (shared by tap + DnD) ── */
function assignMovie(slotId, movieIdx) {
  if (state.locked) return;
  if (Object.values(state.assignments).includes(movieIdx)) return;

  state.assignments[slotId] = movieIdx;
  state.selectedMovieIdx = null;
  $$('.movie-card').forEach(c => c.classList.remove('selected'));
  saveAssignments();
  updateSlotDisplay();
  checkLockReady();

  const remaining = state.game.slots.filter(s => state.assignments[s.id] === undefined).length;
  if (remaining === 0) {
    $('#status-text').textContent = 'All filled! Tap Lock In to reveal your score.';
  } else {
    $('#status-text').textContent = `Assigned! ${remaining} slot${remaining > 1 ? 's' : ''} left — pick another movie`;
  }
  updateSteps();
}

function updateSlotDisplay() {
  const movies = state.game.movies;

  $$('.movie-card').forEach(c => {
    const idx = parseInt(c.dataset.idx);
    const assigned = Object.values(state.assignments).includes(idx);
    c.classList.toggle('assigned', assigned);
    if (assigned) c.classList.remove('selected');
  });

  state.game.slots.forEach(s => {
    const mid = `slot-movie-${s.id}`;
    const hid = `slot-hint-${s.id}`;
    const card = $(`.slot-card[data-slot="${s.id}"]`);

    if (state.assignments[s.id] !== undefined) {
      const movie = movies[state.assignments[s.id]];
      $(`#${mid}`).textContent = movie.title;
      $(`#${hid}`).textContent = '';
      if (card) card.classList.add('filled');
    } else {
      $(`#${mid}`).textContent = '';
      $(`#${hid}`).textContent = 'tap to assign';
      if (card) card.classList.remove('filled');
    }
  });
}

function checkLockReady() {
  const ready = state.game.slots.every(s => state.assignments[s.id] !== undefined);
  $('#lock-btn').disabled = !ready;
}

/* ── Steps ── */
function updateSteps() {
  const steps = $$('.step');
  const count = Object.keys(state.assignments).length;
  if (state.selectedMovieIdx !== null) {
    steps[0].classList.add('active');
    steps[1].classList.remove('active');
    steps[2].classList.remove('active');
  }
  if (count > 0) {
    steps[0].classList.add('active');
    steps[1].classList.add('active');
  } else if (!state.selectedMovieIdx) {
    steps[0].classList.remove('active');
    steps[1].classList.remove('active');
    steps[2].classList.remove('active');
  }
  if (count >= 5) {
    steps[2].classList.add('active');
  }
}

/* ── Touch Drag & Drop ── */
let touchState = null;

function onTouchStart(e, idx) {
  if (state.locked) return;
  if (Object.values(state.assignments).includes(idx)) return;

  const touch = e.touches[0];
  const card = e.currentTarget;
  const rect = card.getBoundingClientRect();

  touchState = { idx, offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top };

  const ghost = $('#drag-ghost');
  ghost.textContent = state.game.movies[idx].title;
  ghost.hidden = false;
  ghost.style.left = `${touch.clientX}px`;
  ghost.style.top = `${touch.clientY}px`;
  card.classList.add('dragging');
}

function onTouchMove(e) {
  if (!touchState) return;
  e.preventDefault();
  const touch = e.touches[0];
  const ghost = $('#drag-ghost');
  ghost.style.left = `${touch.clientX}px`;
  ghost.style.top = `${touch.clientY}px`;

  /* highlight nearest slot */
  $$('.slot-card').forEach(c => c.classList.remove('drag-over'));
  const slot = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.slot-card');
  if (slot) slot.classList.add('drag-over');
}

function onTouchEnd(e) {
  if (!touchState) return;

  const ghost = $('#drag-ghost');
  ghost.hidden = true;
  $$('.movie-card').forEach(c => c.classList.remove('dragging'));
  $$('.slot-card').forEach(c => c.classList.remove('drag-over'));

  const touch = e.changedTouches[0];
  const slot = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.slot-card');
  if (slot) {
    assignMovie(slot.dataset.slot, touchState.idx);
  }

  touchState = null;
}

/* ── Lock In ── */
$('#lock-btn').addEventListener('click', async () => {
  if (state.locked) return;
  state.locked = true;
  const btn = $('#lock-btn');
  btn.textContent = 'Submitting…';
  btn.disabled = true;

  try {
    const endpoint = state.isPastPuzzle
      ? `/api/puzzle/${state.puzzleDate}/submit`
      : '/api/game/submit';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments: state.assignments }),
    });
    const data = await res.json();
    state.results = data;
    const key = state.isPastPuzzle
      ? `${PAST_PREFIX}result-${state.puzzleDate}`
      : RESULTS_KEY(state.game.date);
    localStorage.setItem(key, JSON.stringify(data));
    showResults();
  } catch (err) {
    state.locked = false;
    btn.textContent = 'Lock In';
    btn.disabled = false;
    $('#status-text').textContent = 'Error submitting. Try again.';
  }
});

function getSlotCalcText(ri) {
  switch (ri.slotId) {
    case 'year':      return `Last digit of ${ri.year} → <strong>${ri.year % 10}</strong>`;
    case 'rating':    return `${ri.rating} → <strong>${Math.floor(ri.rating)}</strong>`;
    case 'boxOffice': const m = Math.floor(ri.revenue / 1000000); const fd = parseInt(String(m)[0]) || 0; return `$${m}M → <strong>${fd}</strong>`;
    case 'genres':    return `<strong>${ri.genreCount}</strong> genre${ri.genreCount !== 1 ? 's' : ''}`;
    case 'runtime':   const rt = Math.floor(ri.runtime / 10); return `${ri.runtime} min → <strong>${rt}</strong>`;
    default:          return '';
  }
}

function getSlotIcon(slotId) {
  const icons = {
    year: '<svg viewBox="0 0 16 16" fill="none" width="13" height="13"><rect x="1" y="3" width="14" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M1 6h14" stroke="currentColor" stroke-width="1.3"/><circle cx="5" cy="9.5" r="1" fill="currentColor"/><circle cx="11" cy="9.5" r="1" fill="currentColor"/></svg>',
    rating: '<svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M8 1.5l1.76 3.57 3.94.57-2.85 2.78.67 3.93L8 10.75l-3.52 1.86.67-3.93L2.3 5.64l3.94-.57L8 1.5z" fill="currentColor"/></svg>',
    boxOffice: '<svg viewBox="0 0 16 16" fill="none" width="13" height="13"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><text x="8" y="11" text-anchor="middle" font-size="9.5" font-weight="700" fill="currentColor">$</text></svg>',
    genres: '<svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M2 4l4-2 4 2v8l-4 2-4-2V4z" stroke="currentColor" stroke-width="1.2"/><path d="M8 4l4-2 4 2v8l-4 2-4-2V4z" stroke="currentColor" stroke-width="1.2" opacity="0.45"/></svg>',
    runtime: '<svg viewBox="0 0 16 16" fill="none" width="13" height="13"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.5V8h3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  };
  return icons[slotId] || '';
}

/* ── Results ── */
function animateScore(el, total, bestPossible, onDone, duration = 800) {
  el.textContent = `0 / ${bestPossible}`;
  const start = performance.now();
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const current = Math.round(total * eased);
    el.textContent = `${current} / ${bestPossible}`;
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = `${total} / ${bestPossible}`;
      if (onDone) onDone();
    }
  }
  requestAnimationFrame(tick);
}

function getPerformanceTier(ratio) {
  if (ratio >= 0.9) return '🎬 Masterpiece';
  if (ratio >= 0.75) return '🏆 Film Scholar';
  if (ratio >= 0.5) return '🎟️ Matinee';
  return '🍿 Bootleg';
}

function showResults() {
  const r = state.results;
  if (r.bestPossible === undefined) r.bestPossible = 0;
  if (r.isHighScore === undefined) r.isHighScore = false;
  hide($('#status-bar'));
  hide($('#game-area'));
  show($('#results-area'));

  const titleEl = $('#result-date');
  if (state.isPastPuzzle) {
    titleEl.textContent = `${state.game.date}`;
    $('#rh-title-label').textContent = 'Your Score';
    show($('#rh-best-possible'));
    $('#rh-best-possible').textContent = `Best Possible: ${r.bestPossible}`;
    hide($('#high-score-badge'));
    show($('#reveal-best-btn'));
  } else {
    titleEl.textContent = state.game.date;
    $('#rh-title-label').textContent = "Today's Score";
    hide($('#rh-best-possible'));
    hide($('#reveal-best-btn'));
    if (r.isHighScore) {
      show($('#high-score-badge'));
    } else {
      hide($('#high-score-badge'));
    }
  }

  const totalEl = $('#total-score');
  const tierEl = $('#performance-tier');
  totalEl.textContent = `0 / ${r.bestPossible}`;
  tierEl.textContent = '';
  animateScore(totalEl, r.total, r.bestPossible, () => {
    const ratio = r.total / r.bestPossible;
    tierEl.textContent = getPerformanceTier(ratio);
  });

  renderResultList(r.results);
  state.showingBest = false;
}

function renderResultItems(results) {
  return results.map(ri => {
    const calcText = getSlotCalcText(ri);
    const icon = getSlotIcon(ri.slotId);
    return `
      <div class="result-item">
        <div class="ri-poster-col">
          <div class="ri-poster-sm">
            ${ri.moviePoster
              ? `<img src="${ri.moviePoster}" alt="${ri.movieTitle}">`
              : '<span class="no-poster">🎬</span>'}
          </div>
        </div>
        <div class="ri-info-col">
          <div class="ri-movie-title">${ri.movieTitle}</div>
          <div class="ri-meta-row">
            <span class="ri-meta-icon">${icon}</span>
            <span class="ri-meta-label">${ri.slotName}</span>
            <span class="ri-meta-sep">•</span>
            <span class="ri-meta-calc">${calcText}</span>
          </div>
        </div>
        <div class="ri-score-col">${ri.score}<span class="ri-max">/${ri.maxScore}</span></div>
      </div>
    `;
  }).join('');
}

function renderResultList(results) {
  const el = $('#results-list');
  el.classList.remove('split');
  el.innerHTML = renderResultItems(results);
}

/* ── Reveal Best Solution ── */
function toggleBestSolution() {
  const r = state.results;
  if (!r.bestResults) return;
  const list = $('#results-list');
  if (state.showingBest) {
    list.classList.remove('split');
    list.innerHTML = renderResultItems(r.results);
    $('#reveal-best-btn').textContent = 'Reveal Perfect Score';
    state.showingBest = false;
  } else {
    list.classList.add('split');
    list.innerHTML = `
      <div class="results-column">
        <div class="results-col-header">Your Score</div>
        ${renderResultItems(r.results)}
      </div>
      <div class="results-col-divider"></div>
      <div class="results-column">
        <div class="results-col-header">Best Solution</div>
        ${renderResultItems(r.bestResults)}
      </div>
    `;
    $('#reveal-best-btn').textContent = 'Show My Results';
    state.showingBest = true;
  }
}

/* ── Try Again ── */
function tryAgain() {
  const date = state.game.date;
  if (state.isPastPuzzle) {
    localStorage.removeItem(`${PAST_PREFIX}assign-${date}`);
    localStorage.removeItem(`${PAST_PREFIX}result-${date}`);
  } else {
    localStorage.removeItem(STORAGE_KEY(date));
    localStorage.removeItem(RESULTS_KEY(date));
  }
  state.assignments = {};
  state.locked = false;
  state.results = null;
  state.selectedMovieIdx = null;
  hide($('#results-area'));
  show($('#game-area'));
  show($('#status-bar'));
  updateSlotDisplay();
  checkLockReady();
  $('#status-text').textContent = 'Tap a movie to get started';
  updateSteps();
}

/* ── Back to Today ── */
async function backToToday() {
  state.isPastPuzzle = false;
  state.puzzleDate = null;
  const res = await fetch('/api/game');
  const game = await res.json();
  state.game = game;
  hide($('#results-area'));
  hide($('#past-puzzles-modal'));
  hide($('#past-puzzle-bar'));
  show($('#game-area'));
  show($('#status-bar'));
  $('#lock-btn').textContent = 'Lock In';
  renderGame();
  updateSteps();
}

/* ── Past Puzzles ── */
async function openPastPuzzles() {
  const res = await fetch('/api/puzzles');
  const dates = await res.json();
  const el = $('#pp-list');
  if (dates.length === 0) {
    el.innerHTML = '<p class="pp-empty">No past puzzles available yet.</p>';
  } else {
    el.innerHTML = dates.map(d => `
      <div class="pp-item" data-date="${d}">
        <span class="pp-date">${d}</span>
        <span class="pp-play-btn">Play</span>
      </div>
    `).join('');
    el.querySelectorAll('.pp-item').forEach(item => {
      item.addEventListener('click', () => loadPastPuzzle(item.dataset.date));
    });
  }
  show($('#past-puzzles-modal'));
}

async function loadPastPuzzle(date) {
  const res = await fetch(`/api/puzzle/${date}`);
  const game = await res.json();
  if (!game.available) return;
  state.isPastPuzzle = true;
  state.puzzleDate = date;
  state.game = game;
  state.assignments = {};
  state.locked = false;
  state.results = null;
  state.selectedMovieIdx = null;
  hide($('#past-puzzles-modal'));
  hide($('#results-area'));
  show($('#game-area'));
  show($('#status-bar'));
  show($('#past-puzzle-bar'));
  $('#pp-bar-date').textContent = `Playing: ${date}`;
  $('#lock-btn').textContent = 'Lock In';
  renderGame();
  updateSteps();
}

$('#back-to-today-btn').addEventListener('click', backToToday);

$('#past-puzzles-btn').addEventListener('click', openPastPuzzles);
$('#pp-close-btn').addEventListener('click', () => hide($('#past-puzzles-modal')));
$('#pp-close-bg').addEventListener('click', () => hide($('#past-puzzles-modal')));
$('#try-again-btn').addEventListener('click', tryAgain);

/* ── Share ── */
$('#share-btn').addEventListener('click', shareResult);

/* ── Scoring Reference ── */
$('#scoring-btn').addEventListener('click', toggleScoring);

/* ── Reveal Best Solution ── */
$('#reveal-best-btn').addEventListener('click', toggleBestSolution);

/* ── Prevent page scroll on touch drag ── */
document.addEventListener('touchmove', e => {
  if (touchState) e.preventDefault();
}, { passive: false });

/* ── Start ── */
init();
