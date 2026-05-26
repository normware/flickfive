const SLOT_RULES = {
  year: {
    name: 'Year Closer',
    short: 'Year',
    desc: 'Last digit of release year',
    maxScore: 9,
    value: movie => movie.year % 10,
  },
  rating: {
    name: 'Critic Darling',
    short: 'Rating',
    desc: 'TMDB rating rounded down',
    maxScore: 10,
    value: movie => Math.floor(movie.rating),
  },
  boxOffice: {
    name: 'Box Office Muscle',
    short: 'Gross',
    desc: 'First digit of worldwide gross in millions',
    maxScore: 9,
    value: movie => {
      const millions = Math.floor(movie.revenue / 1000000);
      return parseInt(String(millions)[0], 10) || 0;
    },
  },
  genres: {
    name: 'Genre Blender',
    short: 'Genres',
    desc: 'Number of genres from TMDB',
    maxScore: 8,
    value: movie => movie.genreCount,
  },
  runtime: {
    name: 'Runtime King',
    short: 'Runtime',
    desc: 'Runtime divided by 10',
    maxScore: 30,
    value: movie => Math.floor(movie.runtime / 10),
  },
};

const BRAND = 'FlickFive';
const STORAGE_NS = 'flickfive';
const PROGRESS_KEY = date => `${STORAGE_NS}:board:${date}`;
const COMPLETE_DATES_KEY = `${STORAGE_NS}:completedDates`;
const ONBOARDING_KEY = `${STORAGE_NS}:onboarded`;
const STATS_KEY = `${STORAGE_NS}:stats`;
const MAX_ATTEMPTS = 3;

const state = {
  index: null,
  game: null,
  selectedMovieIdx: null,
  attempts: [],
  activeAttempt: 0,
  activeSlotIndex: 0,
  gameOver: false,
  best: null,
  view: 'week',
  activeDate: null,
  showingBest: false,
  revealAttemptIndex: null,
  revealCount: 0,
  scoreCountValue: null,
  resultCountdownTimer: null,
  weekCountdownTimer: null,
  lastDialogTrigger: null,
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function show(el) { if (el) el.hidden = false; }
function hide(el) { if (el) el.hidden = true; }

function localISODate(date = new Date()) {
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 10);
}

function posterURL(path) {
  return path ? `https://image.tmdb.org/t/p/w342${path}` : null;
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(revenue) {
  const millions = Math.floor(revenue / 1000000);
  if (millions >= 1000) return `$${(millions / 1000).toFixed(1)}B`;
  return `$${millions}M`;
}

function emptyAttempts() {
  return Array.from({ length: MAX_ATTEMPTS }, () => ({
    assignments: {},
    submitted: false,
    score: null,
    results: null,
  }));
}

function progressKey() {
  return PROGRESS_KEY(state.game.date);
}

function getWeekRange(date = new Date()) {
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

function formatDateLabel(date) {
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  return date.toLocaleDateString('en-US', opts);
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function fetchJSON(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return response.json();
}

async function loadPuzzle(date) {
  const data = await fetchJSON(`./data/puzzles/${date}.json`);
  return {
    available: true,
    date: data.date,
    slots: data.slots.map(id => ({ id, ...SLOT_RULES[id] })),
    movies: data.movies,
  };
}

async function init() {
  try {
    state.index = await fetchJSON('./data/index.json');
    hide($('#loading'));
    const today = localISODate();
    if (state.index.dates.includes(today)) {
      await playDate(today);
      return;
    }
    renderWeekView();
    show($('#week-view'));
  } catch (err) {
    hide($('#loading'));
    $('#no-game-msg').textContent = 'Static puzzle data could not be loaded. Run npm run build before publishing.';
    show($('#no-game'));
  }
}

function getWeekDateStr(date) {
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 10);
}

function renderWeekView() {
  stopWeekCountdown();
  const today = localISODate();
  const dates = state.index.dates;
  const completed = new Set(getCompletedDates());
  const stats = getStats();
  const now = Date.now();

  const weekDays = getWeekRange();
  $('#week-label').textContent = `${formatDateLabel(weekDays[0])}  —  ${formatDateLabel(weekDays[6])}`;

  const html = weekDays.map((day, i) => {
    const dateStr = getWeekDateStr(day);
    const isToday = dateStr === today;
    const exists = dates.includes(dateStr);
    const done = completed.has(dateStr);
    const dayStats = stats.byDate[dateStr];
    const dayName = DAY_NAMES[day.getDay()];
    const dayNum = day.getDate();

    let statusText = '';
    let statusClass = '';

    if (dateStr > today) {
      const unlockAt = new Date(`${dateStr}T00:00:00`).getTime();
      const initial = formatUnlockCountdown(unlockAt - now);
      statusText = `Unlock ${initial}`;
      statusClass = 'day-locked';
      return `
        <button class="day-card ${statusClass}" data-date="${dateStr}" data-unlock-ts="${unlockAt}" type="button" disabled>
          <span class="day-name">${dayName}</span>
          <span class="day-num">${dayNum}</span>
          <span class="day-status">${statusText}</span>
        </button>
      `;
    }

    if (!exists) {
      statusText = '—';
      statusClass = 'day-unavailable';
    } else if (done) {
      statusText = dayStats ? `${dayStats.score}/${dayStats.bestTotal}` : '✓';
      statusClass = 'day-done';
    } else if (isToday) {
      statusText = '★';
      statusClass = 'day-today';
    } else {
      statusText = '\u00A0';
    }

    return `
      <button class="day-card ${statusClass}" data-date="${dateStr}" type="button" ${!exists ? 'disabled' : ''}>
        <span class="day-name">${dayName}</span>
        <span class="day-num">${dayNum}</span>
        <span class="day-status">${statusText}</span>
        ${dayStats ? `<span class="day-substatus">${dayStats.perfect ? 'Perfect' : `${dayStats.tries}/${MAX_ATTEMPTS} tries`}</span>` : ''}
      </button>
    `;
  }).join('');

  $('#day-grid').innerHTML = html;
  $$('.day-card:not([disabled])').forEach(card => {
    card.addEventListener('click', () => playDate(card.dataset.date));
  });
  startWeekCountdown();
}

function formatUnlockCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function nextUnlockText() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return formatUnlockCountdown(tomorrow.getTime() - Date.now());
}

function getStats() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
    return {
      played: Number(parsed.played) || 0,
      perfects: Number(parsed.perfects) || 0,
      currentStreak: Number(parsed.currentStreak) || 0,
      byDate: parsed.byDate && typeof parsed.byDate === 'object' ? parsed.byDate : {},
    };
  } catch {
    return { played: 0, perfects: 0, currentStreak: 0, byDate: {} };
  }
}

function previousISODate(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() - 1);
  return getWeekDateStr(date);
}

function saveCompletionStats(date, score, bestTotal, tries) {
  const stats = getStats();
  const existing = stats.byDate[date];
  const perfect = score === bestTotal;
  const previousDate = previousISODate(date);
  const hadYesterday = Boolean(stats.byDate[previousDate]);

  stats.byDate[date] = {
    score,
    bestTotal,
    tries,
    perfect,
    completedAt: new Date().toISOString(),
  };

  stats.played = Object.keys(stats.byDate).length;
  stats.perfects = Object.values(stats.byDate).filter(entry => entry?.perfect).length;

  if (!existing) {
    stats.currentStreak = hadYesterday ? stats.currentStreak + 1 : 1;
  }

  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

function hasSubmittedAttempt() {
  return state.attempts.some(attempt => attempt.submitted);
}

function updateWeekCountdowns() {
  const cards = $$('.day-card[data-unlock-ts]');
  if (cards.length === 0) return;
  const now = Date.now();
  let needsRefresh = false;

  cards.forEach(card => {
    const status = card.querySelector('.day-status');
    const unlockAt = Number(card.dataset.unlockTs || 0);
    if (!status || !unlockAt) return;
    const remaining = unlockAt - now;
    if (remaining <= 0) {
      needsRefresh = true;
      return;
    }
    status.textContent = `Unlock ${formatUnlockCountdown(remaining)}`;
  });

  if (needsRefresh) renderWeekView();
}

function startWeekCountdown() {
  stopWeekCountdown();
  if (state.view !== 'week') return;
  if (!document.querySelector('.day-card[data-unlock-ts]')) return;
  state.weekCountdownTimer = window.setInterval(updateWeekCountdowns, 1000);
}

function stopWeekCountdown() {
  if (!state.weekCountdownTimer) return;
  window.clearInterval(state.weekCountdownTimer);
  state.weekCountdownTimer = null;
}

async function playDate(date) {
  state.view = 'game';
  stopWeekCountdown();
  stopResultCountdown();
  state.activeDate = date;
  state.game = await loadPuzzle(date);
  hide($('#week-view'));
  hide($('#results-area'));
  $('#gb-date-label').textContent = formatDateLabel(new Date(date + 'T00:00:00'));
  show($('#game-area'));
  startGame();
}

async function backToWeek() {
  state.view = 'week';
  state.activeDate = null;
  state.game = null;
  stopResultCountdown();
  hide($('#game-area'));
  hide($('#results-area'));
  renderWeekView();
  show($('#week-view'));
}

function startGame() {
  state.best = computeBestScore();
  state.selectedMovieIdx = null;
  state.showingBest = false;
  state.attempts = emptyAttempts();
  state.activeAttempt = 0;
  state.activeSlotIndex = 0;
  state.gameOver = false;
  state.revealAttemptIndex = null;
  state.revealCount = 0;
  state.scoreCountValue = null;
  loadProgress();
  if (state.gameOver) renderResults();
  renderGame();
}

function loadProgress() {
  const saved = localStorage.getItem(progressKey());
  if (!saved) return;

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.attempts)) return;
    state.attempts = emptyAttempts().map((attempt, index) => ({
      ...attempt,
      ...(parsed.attempts[index] || {}),
    }));
    state.activeAttempt = Number.isInteger(parsed.activeAttempt) ? parsed.activeAttempt : 0;
    state.activeSlotIndex = Number.isInteger(parsed.activeSlotIndex) ? parsed.activeSlotIndex : firstOpenSlotIndex();
    state.gameOver = Boolean(parsed.gameOver);
    normalizeActiveSlot();
  } catch {
    localStorage.removeItem(progressKey());
  }
}

function saveProgress() {
  localStorage.setItem(progressKey(), JSON.stringify({
    attempts: state.attempts,
    activeAttempt: state.activeAttempt,
    activeSlotIndex: state.activeSlotIndex,
    gameOver: state.gameOver,
  }));
}

function renderGame() {
  renderOnboarding();
  renderMovies();
  renderRules();
  renderAttempts();
  renderMobileBoard();
  renderBestReveal();
  renderActions();
  updateSteps();
}

function renderOnboarding() {
  const el = $('#onboarding-strip');
  if (!el) return;
  const hasAssigned = state.attempts.some(attempt => Object.keys(attempt.assignments || {}).length > 0);
  const dismissed = localStorage.getItem(ONBOARDING_KEY) === '1';
  if (dismissed || hasAssigned || state.gameOver) {
    hide(el);
  } else {
    show(el);
  }
}

function renderMovies() {
  const active = state.attempts[state.activeAttempt];
  const used = active ? Object.values(active.assignments) : [];
  const movieDetailsByIndex = new Map();
  const bestPickedMovieIndices = new Set();

  const bestAssign = getDisplayedBestAssignment();
  if (state.showingBest && bestAssign) {
    Object.values(bestAssign).forEach(movieIdx => bestPickedMovieIndices.add(movieIdx));
  }

  state.attempts.forEach((attempt, attemptIndex) => {
    if (!attempt.submitted || !attempt.results) return;
    state.game.slots.forEach(slot => {
      const movieIdx = attempt.assignments[slot.id];
      if (movieIdx === undefined) return;
      const result = attempt.results.find(item => item.slotId === slot.id);
      if (!result) return;
      if (!movieDetailsByIndex.has(movieIdx)) movieDetailsByIndex.set(movieIdx, []);
      movieDetailsByIndex.get(movieIdx).push({
        attempt: attemptIndex + 1,
        slotShort: SLOT_RULES[slot.id].short,
        detail: getCellDetailText(result),
      });
    });
  });

  $('#movie-list').innerHTML = state.game.movies.map((movie, index) => {
    const poster = posterURL(movie.poster);
    const assigned = !state.gameOver && used.includes(index);
    const assignedSlotId = active
      ? state.game.slots.find(slot => active.assignments[slot.id] === index)?.id
      : null;
    const assignedSlotShort = assignedSlotId ? SLOT_RULES[assignedSlotId].short : '';
    const selected = state.selectedMovieIdx === index;
    const detailRows = movieDetailsByIndex.get(index) || [];
    const bestPicked = state.showingBest && bestPickedMovieIndices.has(index);
    const revealRows = state.showingBest ? buildRevealRowsForMovie(movie, index) : [];
    return `
      <button class="movie-card ${assigned ? 'assigned' : ''} ${selected ? 'selected' : ''} ${bestPicked ? 'best-picked' : ''}" data-idx="${index}" type="button" aria-pressed="${selected ? 'true' : 'false'}" ${assigned || state.gameOver ? 'disabled' : ''}>
        <span class="poster">
          ${poster ? `<img src="${poster}" alt="${escapeHTML(movie.title)}" loading="lazy">` : '<span class="no-poster">FF</span>'}
        </span>
        <span class="title">${escapeHTML(movie.title)}</span>
        ${assigned ? `<span class="movie-used-badge">Used in ${escapeHTML(assignedSlotShort)}</span>` : ''}
        ${state.showingBest ? `
          <span class="movie-details reveal-details">
            ${revealRows.map(row => `
              <span class="movie-detail-line ${row.best ? 'best-line' : ''}">
                <span class="movie-detail-try">${row.best ? '★' : '·'}</span>
                <span class="movie-detail-slot">${escapeHTML(row.slotShort)}</span>
                <span class="movie-detail-text">${escapeHTML(row.detail)}</span>
              </span>
            `).join('')}
          </span>
        ` : detailRows.length > 0 ? `
          <span class="movie-details">
            ${detailRows.map(row => `
              <span class="movie-detail-line">
                <span class="movie-detail-try">T${row.attempt}</span>
                <span class="movie-detail-slot">${escapeHTML(row.slotShort)}</span>
                <span class="movie-detail-text">${escapeHTML(row.detail)}</span>
              </span>
            `).join('')}
          </span>
        ` : ''}
      </button>
    `;
  }).join('');

  $$('.movie-card').forEach(card => {
    card.addEventListener('click', () => selectMovie(parseInt(card.dataset.idx, 10)));
  });
}

function buildRevealRowsForMovie(movie, movieIndex) {
  const bestAssign = getDisplayedBestAssignment();
  return state.game.slots.map(slot => {
    const scored = scoreFor(slot.id, movie);
    const best = bestAssign?.[slot.id] === movieIndex;
    return {
      slotShort: SLOT_RULES[slot.id].short,
      best,
      detail: getRevealDetailText(slot.id, movie, scored.score, SLOT_RULES[slot.id].maxScore),
    };
  });
}

function getRevealDetailText(slotId, movie, score, maxScore) {
  switch (slotId) {
    case 'year':
      return `${movie.year} -> ${movie.year % 10} (${score}/${maxScore})`;
    case 'rating':
      return `${movie.rating.toFixed(1)} -> ${Math.floor(movie.rating)} (${score}/${maxScore})`;
    case 'boxOffice': {
      const millions = Math.floor(movie.revenue / 1000000);
      const firstDigit = parseInt(String(millions)[0], 10) || 0;
      return `${formatMoney(movie.revenue)} -> ${firstDigit} (${score}/${maxScore})`;
    }
    case 'genres': {
      const names = (movie.genres || []).join(', ');
      return `${names} (${movie.genreCount}) -> ${score}/${maxScore}`;
    }
    case 'runtime': {
      const runtimeScore = Math.floor(movie.runtime / 10);
      return `${movie.runtime}m -> ${runtimeScore} (${score}/${maxScore})`;
    }
    default:
      return `${score}/${maxScore}`;
  }
}

function renderRules() {
  $('#rule-list').innerHTML = state.game.slots.map((slot, index) => `
    <div class="rule-card">
      <span class="slot-number">${index + 1}</span>
      <span class="slot-name">${escapeHTML(slot.name)}</span>
      <span class="slot-desc">${escapeHTML(slot.desc)}</span>
    </div>
  `).join('');

  const best = $('#best-possible-inline');
  if (best) best.textContent = `${state.best.bestTotal}`;
}

function renderAttempts() {
  $('#attempt-list').innerHTML = state.attempts.map((attempt, attemptIndex) => {
    const isActive = attemptIndex === state.activeAttempt && !state.gameOver;
    const cells = state.game.slots.map(slot => {
      const movieIdx = attempt.assignments[slot.id];
      const movie = movieIdx === undefined ? null : state.game.movies[movieIdx];
      const result = attempt.results?.find(item => item.slotId === slot.id);
      const slotIndex = state.game.slots.findIndex(item => item.id === slot.id);
      const isRevealing = state.revealAttemptIndex === attemptIndex;
      const revealReady = !isRevealing || slotIndex < state.revealCount;
      const score = revealReady ? result?.score : undefined;
      const detail = revealReady && result ? getCellDetailText(result) : '';
      const canPlace = isActive && state.selectedMovieIdx !== null && movieIdx === undefined;
      const animateReveal = isRevealing && score !== undefined;
      return `
        <button class="guess-cell ${movie ? 'filled' : ''} ${canPlace ? 'drop-target' : ''} ${animateReveal ? 'just-revealed' : ''}" data-attempt="${attemptIndex}" data-slot="${slot.id}" type="button" ${isActive ? '' : 'disabled'}>
          <span class="cell-title">${movie ? escapeHTML(movie.title) : 'Pick film'}</span>
          <span class="cell-meta">${movie ? escapeHTML(SLOT_RULES[slot.id].short) : 'Open'}</span>
          ${result ? `<span class="cell-detail">${escapeHTML(detail)}</span>` : ''}
          ${score !== undefined ? `<span class="cell-score">${score}</span>` : ''}
        </button>
      `;
    }).join('');

    const scoreText = getRowScoreText(attempt, attemptIndex, isActive);
    return `
      <div class="guess-row ${isActive ? 'active' : ''} ${attempt.submitted ? 'submitted' : ''} ${state.revealAttemptIndex === attemptIndex ? 'revealing' : ''}">
        <div class="guess-label">Try ${attemptIndex + 1}</div>
        <div class="guess-cells">${cells}</div>
        <div class="row-score ${state.scoreCountValue !== null && state.revealAttemptIndex === attemptIndex ? 'score-counting' : ''}">${scoreText}</div>
      </div>
    `;
  }).join('');

  $$('.guess-cell').forEach(cell => {
    cell.addEventListener('click', () => selectCell(parseInt(cell.dataset.attempt, 10), cell.dataset.slot));
  });
}

function getRowScoreText(attempt, attemptIndex, isActive) {
  if (state.revealAttemptIndex === attemptIndex && state.scoreCountValue !== null) {
    return `${state.scoreCountValue} / ${state.best.bestTotal}`;
  }
  if (state.revealAttemptIndex === attemptIndex) return '...';
  if (attempt.submitted) return `${attempt.score} / ${state.best.bestTotal}`;
  return isActive ? 'Live' : '-';
}

function renderMobileBoard() {
  const el = $('#mobile-board');
  if (!el) return;
  normalizeActiveSlot();
  const active = state.attempts[state.activeAttempt];
  const activeSlot = state.game.slots[state.activeSlotIndex] || state.game.slots[0];
  const ready = active && state.game.slots.every(slot => active.assignments[slot.id] !== undefined);
  const locked = state.gameOver || state.revealAttemptIndex !== null || !active;
  const previousAttempt = state.attempts[state.activeAttempt - 1];

  el.innerHTML = `
    <section class="mobile-picker ${locked ? 'locked' : ''}">
      <div class="mobile-progress-strip" aria-label="Category progress">
        ${state.game.slots.map((slot, index) => {
          const filled = active?.assignments[slot.id] !== undefined;
          const current = index === state.activeSlotIndex;
          return `
            <button class="mobile-progress-item ${filled ? 'complete' : ''} ${current ? 'active' : ''}" data-slot-index="${index}" type="button" ${locked ? 'disabled' : ''}>
              <span>${escapeHTML(slot.short)}</span>
            </button>
          `;
        }).join('')}
      </div>
      <div class="mobile-active-slot">
        <div class="mobile-slot-kicker">Slot ${state.activeSlotIndex + 1} of ${state.game.slots.length}</div>
        <h3>${escapeHTML(activeSlot.name)}</h3>
        <p>${escapeHTML(activeSlot.desc)}</p>
      </div>
      ${previousAttempt?.submitted ? renderPreviousSlotReview(previousAttempt, activeSlot.id) : ''}
      <div class="mobile-picker-grid">
        ${state.game.movies.map((movie, index) => renderMobileMovieCard(movie, index, active, activeSlot, locked)).join('')}
      </div>
      <div class="mobile-submit-hint ${ready ? 'ready' : ''}">
        ${ready ? `Ready for Submit Try ${state.activeAttempt + 1}` : `${remainingSlots(active)} picks left`}
      </div>
    </section>
  `;

  $$('#mobile-board [data-slot-index]').forEach(button => {
    button.addEventListener('click', () => {
      state.activeSlotIndex = parseInt(button.dataset.slotIndex, 10);
      state.selectedMovieIdx = null;
      saveProgress();
      renderGame();
    });
  });

  $$('#mobile-board [data-mobile-movie]').forEach(card => {
    card.addEventListener('click', () => assignMobileMovie(parseInt(card.dataset.mobileMovie, 10)));
  });
}

function renderMobileMovieCard(movie, index, active, activeSlot, locked) {
  const poster = posterURL(movie.poster);
  const assignedSlot = findAssignedSlotForMovie(active, index);
  const selected = assignedSlot?.id === activeSlot.id;
  const usedElsewhere = assignedSlot && !selected;
  const disabled = locked || usedElsewhere;
  const clue = getMobileClueText(activeSlot.id, movie);
  return `
    <button class="mobile-movie-card ${selected ? 'selected' : ''} ${usedElsewhere ? 'used' : ''}" data-mobile-movie="${index}" type="button" ${disabled ? 'disabled' : ''} aria-pressed="${selected ? 'true' : 'false'}">
      <span class="mobile-poster">
        ${poster ? `<img src="${poster}" alt="${escapeHTML(movie.title)}" loading="lazy">` : '<span class="no-poster">FF</span>'}
      </span>
      <span class="mobile-movie-copy">
        <strong>${escapeHTML(movie.title)}</strong>
        <span class="mobile-clue">${escapeHTML(clue)}</span>
        ${usedElsewhere ? `<span class="mobile-used-label">Used for ${escapeHTML(assignedSlot.short)}</span>` : ''}
        ${selected ? '<span class="mobile-used-label selected-label">Tap to clear</span>' : ''}
      </span>
    </button>
  `;
}

function renderPreviousSlotReview(attempt, slotId) {
  const result = attempt.results?.find(item => item.slotId === slotId);
  if (!result) return '';
  return `
    <div class="mobile-prev-review">
      <span>Last try</span>
      <strong>${escapeHTML(result.movieTitle)}</strong>
      <small>${escapeHTML(getCellDetailText(result))}</small>
    </div>
  `;
}

function findAssignedSlotForMovie(attempt, movieIdx) {
  if (!attempt) return null;
  return state.game.slots.find(slot => attempt.assignments[slot.id] === movieIdx) || null;
}

function remainingSlots(attempt) {
  if (!attempt) return state.game.slots.length;
  return state.game.slots.filter(slot => attempt.assignments[slot.id] === undefined).length;
}

function firstOpenSlotIndex() {
  const active = state.attempts[state.activeAttempt];
  if (!active || !state.game) return 0;
  const index = state.game.slots.findIndex(slot => active.assignments[slot.id] === undefined);
  return index === -1 ? Math.min(state.activeSlotIndex || 0, state.game.slots.length - 1) : index;
}

function normalizeActiveSlot() {
  if (!state.game?.slots?.length) {
    state.activeSlotIndex = 0;
    return;
  }
  if (!Number.isInteger(state.activeSlotIndex) || state.activeSlotIndex < 0 || state.activeSlotIndex >= state.game.slots.length) {
    state.activeSlotIndex = firstOpenSlotIndex();
  }
}

function advanceMobileSlot(fromIndex) {
  const active = state.attempts[state.activeAttempt];
  if (!active) return;
  for (let offset = 1; offset <= state.game.slots.length; offset += 1) {
    const next = (fromIndex + offset) % state.game.slots.length;
    if (active.assignments[state.game.slots[next].id] === undefined) {
      state.activeSlotIndex = next;
      return;
    }
  }
  state.activeSlotIndex = fromIndex;
}

function assignMobileMovie(movieIdx) {
  if (state.gameOver || state.revealAttemptIndex !== null) return;
  const active = state.attempts[state.activeAttempt];
  const slot = state.game.slots[state.activeSlotIndex];
  if (!active || !slot) return;

  const assignedSlot = findAssignedSlotForMovie(active, movieIdx);
  if (assignedSlot && assignedSlot.id !== slot.id) return;
  if (active.assignments[slot.id] === movieIdx) {
    delete active.assignments[slot.id];
    state.selectedMovieIdx = null;
    saveProgress();
    renderGame();
    return;
  }

  active.assignments[slot.id] = movieIdx;
  state.selectedMovieIdx = null;
  localStorage.setItem(ONBOARDING_KEY, '1');
  advanceMobileSlot(state.activeSlotIndex);
  saveProgress();
  renderGame();
}

function getMobileClueText(slotId, movie) {
  switch (slotId) {
    case 'year':
      return `${movie.year} scores ${movie.year % 10}`;
    case 'rating':
      return `${movie.rating.toFixed(1)} rating scores ${Math.floor(movie.rating)}`;
    case 'boxOffice': {
      const millions = Math.floor(movie.revenue / 1000000);
      const firstDigit = parseInt(String(millions)[0], 10) || 0;
      return `${formatMoney(movie.revenue)} scores ${firstDigit}`;
    }
    case 'genres':
      return `${movie.genreCount} genre${movie.genreCount === 1 ? '' : 's'}`;
    case 'runtime':
      return `${movie.runtime} min scores ${Math.floor(movie.runtime / 10)}`;
    default:
      return '';
  }
}

function getCellDetailText(result) {
  switch (result.slotId) {
    case 'year':
      return `${result.year} -> ${result.year % 10} (${result.score}/${result.maxScore})`;
    case 'rating':
      return `${result.rating.toFixed(1)} -> ${Math.floor(result.rating)} (${result.score}/${result.maxScore})`;
    case 'boxOffice': {
      const millions = Math.floor(result.revenue / 1000000);
      const firstDigit = parseInt(String(millions)[0], 10) || 0;
      return `${formatMoney(result.revenue)} -> ${firstDigit} (${result.score}/${result.maxScore})`;
    }
    case 'genres': {
      const names = (result.genres || []).join(', ');
      return `${names} (${result.genreCount}) -> ${result.score}/${result.maxScore}`;
    }
    case 'runtime': {
      const runtimeScore = Math.floor(result.runtime / 10);
      return `${result.runtime}m -> ${runtimeScore} (${result.score}/${result.maxScore})`;
    }
    default:
      return `${result.score}/${result.maxScore}`;
  }
}

function renderActions() {
  const active = state.attempts[state.activeAttempt];
  const ready = active && state.game.slots.every(slot => active.assignments[slot.id] !== undefined);
  const status = $('#status-text');
  const submit = $('#submit-btn');
  const reveal = $('#reveal-best-btn');
  const share = $('#share-btn');
  const reset = $('#try-again-btn');
  reset.textContent = 'Start Over';
  reset.classList.add('btn-reset');

  if (state.gameOver) {
    const finalAttempt = lastSubmittedAttempt();
    const tries = state.attempts.filter(attempt => attempt.submitted).length;
    const gap = state.best.bestTotal - (finalAttempt?.score || 0);
    status.innerHTML = finalAttempt?.score === state.best.bestTotal
      ? `<strong>Perfect in ${tries} ${tries === 1 ? 'try' : 'tries'}.</strong> You found ${state.best.bestTotal}.`
      : gap <= 3
        ? `<strong>${gap} ${gap === 1 ? 'point' : 'points'} short.</strong> Best possible was ${state.best.bestTotal}.`
        : `<strong>Finished.</strong> Best possible was ${state.best.bestTotal}.`;
    submit.hidden = true;
    reveal.hidden = false;
    reveal.textContent = state.showingBest ? 'Hide Optimal Answer' : 'Show One Optimal Answer';
    share.hidden = false;
    reset.hidden = false;
  } else {
    const left = active ? state.game.slots.length - Object.keys(active.assignments).length : 0;
    if (state.selectedMovieIdx !== null) {
      const movie = state.game.movies[state.selectedMovieIdx];
      const poster = posterURL(movie.poster);
      status.innerHTML = `
        <span class="selected-pill">
          ${poster ? `<img src="${poster}" alt="" loading="lazy">` : '<span class="selected-pill-fallback">FF</span>'}
          <span><strong>${escapeHTML(movie.title)}</strong><small>Tap a rule slot to place it</small></span>
        </span>
      `;
    } else {
      status.textContent = `${left} slot${left === 1 ? '' : 's'} left in try ${state.activeAttempt + 1}.`;
    }
    submit.hidden = isNarrowMobile() && !ready;
    submit.disabled = !ready || state.revealAttemptIndex !== null;
    submit.textContent = `Submit Try ${state.activeAttempt + 1}`;
    reveal.hidden = true;
    share.hidden = true;
    reset.hidden = isNarrowMobile();
  }
}

function selectMovie(idx) {
  if (state.gameOver || state.revealAttemptIndex !== null) return;
  const active = state.attempts[state.activeAttempt];
  if (Object.values(active.assignments).includes(idx)) return;
  state.selectedMovieIdx = idx;
  renderMovies();
  renderActions();
}

function selectCell(attemptIndex, slotId) {
  if (state.gameOver || state.revealAttemptIndex !== null || attemptIndex !== state.activeAttempt) return;
  const active = state.attempts[state.activeAttempt];

  if (state.selectedMovieIdx !== null) {
    if (Object.values(active.assignments).includes(state.selectedMovieIdx)) return;
    active.assignments[slotId] = state.selectedMovieIdx;
    state.selectedMovieIdx = null;
    localStorage.setItem(ONBOARDING_KEY, '1');
  } else if (active.assignments[slotId] !== undefined) {
    delete active.assignments[slotId];
  }

  saveProgress();
  renderGame();
}

function isNarrowMobile() {
  return window.matchMedia('(max-width: 520px)').matches;
}

function submitAttempt() {
  if (state.gameOver || state.revealAttemptIndex !== null) return;
  const active = state.attempts[state.activeAttempt];
  if (!state.game.slots.every(slot => active.assignments[slot.id] !== undefined)) return;

  const attemptIndex = state.activeAttempt;
  const scored = buildResults(active.assignments);
  active.submitted = true;
  active.score = scored.total;
  active.results = scored.results;
  state.selectedMovieIdx = null;
  state.revealAttemptIndex = attemptIndex;
  state.revealCount = 0;
  state.scoreCountValue = null;

  if (scored.total === state.best.bestTotal || state.activeAttempt === MAX_ATTEMPTS - 1) {
    state.gameOver = true;
    markCompletedDate(state.game.date);
    saveCompletionStats(
      state.game.date,
      scored.total,
      state.best.bestTotal,
      state.attempts.filter(attempt => attempt.submitted).length,
    );
  } else {
    state.activeAttempt += 1;
    state.activeSlotIndex = firstOpenSlotIndex();
  }

  saveProgress();
  renderGame();
  runScoreReveal(attemptIndex, scored.total);
}

function runScoreReveal(attemptIndex, total) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stepDelay = reduceMotion ? 0 : 180;

  state.game.slots.forEach((slot, index) => {
    window.setTimeout(() => {
      state.revealCount = index + 1;
      renderGame();
      if (index === state.game.slots.length - 1) countUpRowScore(attemptIndex, total, reduceMotion);
    }, stepDelay * (index + 1));
  });
}

function countUpRowScore(attemptIndex, total, reduceMotion) {
  if (reduceMotion) {
    state.scoreCountValue = total;
    renderGame();
    finishScoreReveal(attemptIndex);
    return;
  }

  const duration = 520;
  const start = performance.now();
  const tick = now => {
    const progress = Math.min((now - start) / duration, 1);
    state.scoreCountValue = Math.round(total * progress);
    renderGame();
    if (progress < 1) {
      window.requestAnimationFrame(tick);
    } else {
      window.setTimeout(() => finishScoreReveal(attemptIndex), 220);
    }
  };
  window.requestAnimationFrame(tick);
}

function finishScoreReveal(attemptIndex) {
  if (state.revealAttemptIndex !== attemptIndex) return;
  state.revealAttemptIndex = null;
  state.revealCount = 0;
  state.scoreCountValue = null;
  if (state.gameOver) renderResults();
  state.activeSlotIndex = firstOpenSlotIndex();
  renderGame();
}

function scoreFor(slotId, movie) {
  const rule = SLOT_RULES[slotId];
  const value = rule.value(movie);
  return { value, score: Math.min(value, rule.maxScore) };
}

function buildResults(assignments) {
  const results = [];
  let total = 0;

  for (const slot of state.game.slots) {
    const movie = state.game.movies[assignments[slot.id]];
    const scored = scoreFor(slot.id, movie);
    total += scored.score;
    results.push({
      slotId: slot.id,
      slotName: slot.name,
      movieTitle: movie.title,
      moviePoster: posterURL(movie.poster),
      value: scored.value,
      score: scored.score,
      maxScore: slot.maxScore,
      year: movie.year,
      rating: movie.rating,
      revenue: movie.revenue,
      genreCount: movie.genreCount,
      genres: movie.genres || ['Unknown'],
      runtime: movie.runtime,
    });
  }

  return { results, total };
}

function computeBestScore() {
  const indices = state.game.movies.map((_, index) => index);
  let bestTotal = -1;
  let bestAssign = null;

  function permute(available, chosen) {
    if (chosen.length === state.game.slots.length) {
      const assignments = {};
      state.game.slots.forEach((slot, index) => {
        assignments[slot.id] = chosen[index];
      });
      const { total } = buildResults(assignments);
      if (total > bestTotal) {
        bestTotal = total;
        bestAssign = { ...assignments };
      }
      return;
    }

    for (let i = 0; i < available.length; i += 1) {
      permute([...available.slice(0, i), ...available.slice(i + 1)], [...chosen, available[i]]);
    }
  }

  permute(indices, []);
  return { bestTotal, bestAssign, bestResults: buildResults(bestAssign).results };
}

function getSlotCalcText(result) {
  switch (result.slotId) {
    case 'year':
      return `Year ${result.year}: ${result.year % 10}`;
    case 'rating':
      return `Rating ${result.rating.toFixed(1)}: ${Math.floor(result.rating)}`;
    case 'boxOffice': {
      const millions = Math.floor(result.revenue / 1000000);
      const firstDigit = parseInt(String(millions)[0], 10) || 0;
      return `${formatMoney(result.revenue)} gross: ${firstDigit}`;
    }
    case 'genres':
      return `${result.genreCount} genre${result.genreCount === 1 ? '' : 's'}`;
    case 'runtime':
      return `${result.runtime} min: ${Math.floor(result.runtime / 10)}`;
    default:
      return '';
  }
}

function getDisplayedBestAssignment() {
  const finalAttempt = lastSubmittedAttempt();
  if (finalAttempt?.score === state.best.bestTotal) return finalAttempt.assignments;
  return state.best?.bestAssign;
}

function getDisplayedBestResults() {
  const assignment = getDisplayedBestAssignment();
  return assignment ? buildResults(assignment).results : state.best.bestResults;
}

function resultToneClass(score, maxScore) {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio >= 0.82) return 'score-high';
  if (ratio >= 0.55) return 'score-mid';
  return 'score-low';
}

function getOptimalResultForSlot(slotId) {
  return getDisplayedBestResults().find(result => result.slotId === slotId)
    || state.best.bestResults.find(result => result.slotId === slotId);
}

function buildSlotComparisons(attempt) {
  if (!attempt?.results) return [];
  const bestAssign = getDisplayedBestAssignment();
  return state.game.slots.map(slot => {
    const player = attempt.results.find(result => result.slotId === slot.id);
    const optimal = getOptimalResultForSlot(slot.id);
    const playerMovieIdx = attempt.assignments[slot.id];
    const optimalMovieIdx = bestAssign?.[slot.id];
    return {
      slot,
      player,
      optimal,
      exact: playerMovieIdx !== undefined && playerMovieIdx === optimalMovieIdx,
      diff: Math.max(0, (optimal?.score || 0) - (player?.score || 0)),
    };
  });
}

function differsFromComputedBest(assignments) {
  if (!assignments || !state.best?.bestAssign) return false;
  return state.game.slots.some(slot => assignments[slot.id] !== state.best.bestAssign[slot.id]);
}

function renderBestReveal() {
  const el = $('#best-reveal');
  if (!el) return;
  if (!state.showingBest) {
    hide(el);
    el.innerHTML = '';
    return;
  }

  const finalAttempt = lastSubmittedAttempt();
  const shownResults = getDisplayedBestResults();
  const label = finalAttempt?.score === state.best.bestTotal ? 'Your Optimal Answer' : 'One Optimal Answer';
  const note = finalAttempt?.score === state.best.bestTotal && differsFromComputedBest(finalAttempt.assignments)
    ? '<p class="best-note">There are multiple perfect arrangements. This keeps the one you found.</p>'
    : '';

  if (finalAttempt?.results) {
    const comparisons = buildSlotComparisons(finalAttempt);
    el.innerHTML = `
      <div class="best-reveal-head">
        <h2>${finalAttempt.score === state.best.bestTotal ? 'Final vs Optimal' : 'Points Left'}</h2>
        <strong>${state.best.bestTotal}</strong>
      </div>
      ${note}
      <div class="compare-grid">
        ${comparisons.map(item => `
          <div class="compare-item ${item.exact ? 'exact' : ''} ${item.diff === 0 ? 'no-gap' : ''}">
            <span class="compare-slot">${escapeHTML(item.slot.name)}</span>
            <div class="compare-picks">
              <div>
                <small>Your pick</small>
                <strong>${escapeHTML(item.player.movieTitle)}</strong>
                <em>${escapeHTML(getSlotCalcText(item.player))} = ${item.player.score}</em>
              </div>
              <div>
                <small>Optimal</small>
                <strong>${escapeHTML(item.optimal.movieTitle)}</strong>
                <em>${escapeHTML(getSlotCalcText(item.optimal))} = ${item.optimal.score}</em>
              </div>
            </div>
            <b>${item.exact ? 'Matched' : item.diff === 0 ? 'No points lost' : `-${item.diff}`}</b>
          </div>
        `).join('')}
      </div>
    `;
    show(el);
    return;
  }

  el.innerHTML = `
    <div class="best-reveal-head">
      <h2>${label}</h2>
      <strong>${state.best.bestTotal}</strong>
    </div>
    ${note}
    <div class="best-grid">
      ${shownResults.map(result => `
        <div class="best-item">
          <span>${escapeHTML(result.slotName)}</span>
          <strong>${escapeHTML(result.movieTitle)}</strong>
          <small>${escapeHTML(getSlotCalcText(result))} = ${result.score}</small>
        </div>
      `).join('')}
    </div>
  `;
  show(el);
}

function renderResults() {
  const finalAttempt = lastSubmittedAttempt();
  if (!finalAttempt) {
    hide($('#results-area'));
    return;
  }

  const tries = state.attempts.filter(attempt => attempt.submitted).length;
  const gap = state.best.bestTotal - finalAttempt.score;
  const stats = getStats();
  const title = gap === 0 ? `Perfect in ${tries}` : gap <= 3 ? `${gap} short` : 'Run complete';

  $('#rh-title-label').textContent = title;
  $('#result-date').textContent = formatDateLabel(new Date(`${state.game.date}T00:00:00`));
  $('#total-score').textContent = `${finalAttempt.score}`;
  $('#performance-tier').textContent = gap === 0
    ? 'You found the ceiling.'
    : gap <= 3
      ? `So close. Best possible was ${state.best.bestTotal}.`
      : `Best possible was ${state.best.bestTotal}.`;
  $('#rh-best-possible').hidden = false;
  $('#rh-best-possible').textContent = `${finalAttempt.score} / ${state.best.bestTotal} in ${tries}/${MAX_ATTEMPTS} tries`;
  $('#high-score-badge').hidden = gap !== 0;

  $('#results-list').innerHTML = `
    <div class="stats-strip">
      <span><strong>${stats.currentStreak}</strong> Streak</span>
      <span><strong>${stats.perfects}</strong> Perfects</span>
      <span><strong>${stats.played}</strong> Played</span>
    </div>
    <div class="result-breakdown">
      ${finalAttempt.results.map(result => `
        <div class="result-item ${resultToneClass(result.score, result.maxScore)}">
          <span>${escapeHTML(result.slotName)}</span>
          <strong>${escapeHTML(result.movieTitle)}</strong>
          <small>${escapeHTML(getSlotCalcText(result))} = ${result.score}</small>
        </div>
      `).join('')}
    </div>
    <div class="result-breakdown compare-results">
      ${buildSlotComparisons(finalAttempt).map(item => `
        <div class="result-item ${item.exact ? 'score-high' : item.diff === 0 ? 'score-mid' : 'score-low'}">
          <span>${escapeHTML(item.slot.short)} Compare</span>
          <strong>${item.exact ? 'Optimal pick' : item.diff === 0 ? 'Matched score' : `${item.diff} point${item.diff === 1 ? '' : 's'} missed`}</strong>
          <small>${escapeHTML(item.player.movieTitle)} vs ${escapeHTML(item.optimal.movieTitle)}</small>
        </div>
      `).join('')}
    </div>
    <div class="tomorrow-hook">Tomorrow unlocks in <strong id="tomorrow-countdown">${nextUnlockText()}</strong></div>
  `;

  show($('#results-area'));
  startResultCountdown();
}

function startResultCountdown() {
  stopResultCountdown();
  if (!state.gameOver) return;
  state.resultCountdownTimer = window.setInterval(() => {
    const el = $('#tomorrow-countdown');
    if (el) el.textContent = nextUnlockText();
  }, 1000);
}

function stopResultCountdown() {
  if (!state.resultCountdownTimer) return;
  window.clearInterval(state.resultCountdownTimer);
  state.resultCountdownTimer = null;
}

function lastSubmittedAttempt() {
  return [...state.attempts].reverse().find(attempt => attempt.submitted);
}

function rowSymbol(attempt) {
  if (!attempt?.submitted || attempt.score === null || attempt.score === undefined) return '▫️';
  if (attempt.score === state.best.bestTotal) return '🟩';
  const ratio = state.best.bestTotal > 0 ? attempt.score / state.best.bestTotal : 0;
  if (ratio >= 0.6) return '🟨';
  return '⬛';
}

function attemptShareRow(attempt) {
  if (!attempt?.submitted || !attempt.results) return rowSymbol(attempt).repeat(5);
  const bestAssign = getDisplayedBestAssignment();
  return state.game.slots.map(slot => {
    const result = attempt.results.find(item => item.slotId === slot.id);
    const optimal = getOptimalResultForSlot(slot.id);
    if (!result || !optimal) return '▫️';
    if (attempt.assignments[slot.id] === bestAssign?.[slot.id]) return '🟩';
    if (result.score >= optimal.score) return '🟨';
    const ratio = optimal.score > 0 ? result.score / optimal.score : 0;
    if (ratio >= 0.75) return '🟧';
    return '⬛';
  }).join('');
}

function buildShareText() {
  const finalAttempt = lastSubmittedAttempt();
  if (!finalAttempt) return '';

  const tries = state.attempts.filter(attempt => attempt.submitted).length;
  const dateLabel = state.activeDate || localISODate();
  const root = new URL('.', location.href).href;
  const resultSummary = `${finalAttempt.score}/${state.best.bestTotal}`;
  const trySummary = `${tries}/${MAX_ATTEMPTS}`;
  const titleLine = `${BRAND} ${dateLabel} ${resultSummary} (${trySummary})`;
  const rows = state.attempts.map(attemptShareRow).join('\n');

  return `${titleLine}\n${rows}\n${root}`;
}

function shareResult() {
  const text = buildShareText();
  if (!text) return;
  const btn = $('#share-btn');
  const original = btn.textContent;
  const showCopied = () => {
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = original; }, 1800);
  };

  if (navigator.share) {
    navigator.share({ title: `${BRAND} Score`, text })
      .then(showCopied)
      .catch(() => {});
    return;
  }

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
      .then(showCopied)
      .catch(() => {});
  }
}

function tryAgain() {
  if (hasSubmittedAttempt() && !window.confirm('Start over and clear this puzzle progress?')) return;
  localStorage.removeItem(progressKey());
  state.attempts = emptyAttempts();
  state.activeAttempt = 0;
  state.gameOver = false;
  state.selectedMovieIdx = null;
  state.activeSlotIndex = 0;
  state.showingBest = false;
  state.revealAttemptIndex = null;
  state.revealCount = 0;
  state.scoreCountValue = null;
  stopResultCountdown();
  hide($('#results-area'));
  renderGame();
}

function getCompletedDates() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COMPLETE_DATES_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function markCompletedDate(date) {
  if (!date) return;
  const dates = new Set(getCompletedDates());
  dates.add(date);
  localStorage.setItem(COMPLETE_DATES_KEY, JSON.stringify([...dates].sort()));
}

function updateSteps() {
  $$('.step').forEach((step, index) => {
    step.classList.toggle('active', index <= state.activeAttempt || state.gameOver);
  });
}

async function openPastPuzzles() {
  const today = localISODate();
  const dates = (state.index?.dates || [])
    .filter(date => date <= today)
    .sort()
    .reverse()
    .slice(0, 60);
  const completed = new Set(getCompletedDates());
  const stats = getStats();

  const el = $('#pp-list');
  if (dates.length === 0) {
    el.innerHTML = '<p class="pp-empty">No puzzles are available yet.</p>';
  } else {
    el.innerHTML = dates.map(date => {
      const entry = stats.byDate[date];
      return `
      <button class="pp-item" data-date="${date}" type="button">
        <span class="pp-date-wrap">
          <span class="pp-date">${date}</span>
          ${completed.has(date) ? '<span class="pp-check" aria-label="Finished">✓</span>' : ''}
          ${entry ? `<span class="pp-score">${entry.score}/${entry.bestTotal}</span>` : ''}
        </span>
        <span class="pp-play-btn">${entry ? `${entry.tries}/${MAX_ATTEMPTS} tries` : 'Play'}</span>
      </button>
    `;
    }).join('');
    el.querySelectorAll('.pp-item').forEach(item => {
      item.addEventListener('click', () => {
        hide($('#past-puzzles-modal'));
        playDate(item.dataset.date);
      });
    });
  }
  openDialog($('#past-puzzles-modal'), $('.pp-panel'));
}

function openDialog(el, panel) {
  state.lastDialogTrigger = document.activeElement;
  show(el);
  window.setTimeout(() => panel?.focus(), 0);
}

function closeDialog(el) {
  hide(el);
  if (state.lastDialogTrigger && typeof state.lastDialogTrigger.focus === 'function') {
    state.lastDialogTrigger.focus();
  }
  state.lastDialogTrigger = null;
}

window.toggleScoring = function toggleScoring() {
  const el = $('#scoring-ref');
  if (el.hidden) {
    openDialog(el, $('.scoring-panel'));
  } else {
    closeDialog(el);
  }
};

$('#submit-btn').addEventListener('click', submitAttempt);
$('#back-to-week-btn').addEventListener('click', backToWeek);
$('#past-puzzles-btn').addEventListener('click', openPastPuzzles);
$('#pp-close-btn').addEventListener('click', () => closeDialog($('#past-puzzles-modal')));
$('#pp-close-bg').addEventListener('click', () => closeDialog($('#past-puzzles-modal')));
$('#try-again-btn').addEventListener('click', tryAgain);
$('#share-btn').addEventListener('click', shareResult);
$('#scoring-btn').addEventListener('click', toggleScoring);
$('#scoring-close-btn').addEventListener('click', toggleScoring);
$('#scoring-close-bg').addEventListener('click', toggleScoring);
$('#reveal-best-btn').addEventListener('click', () => {
  state.showingBest = !state.showingBest;
  $('#reveal-best-btn').textContent = state.showingBest ? 'Hide Optimal Answer' : 'Show One Optimal Answer';
  renderBestReveal();
  renderMovies();
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!$('#scoring-ref').hidden) closeDialog($('#scoring-ref'));
  if (!$('#past-puzzles-modal').hidden) closeDialog($('#past-puzzles-modal'));
});

init();
