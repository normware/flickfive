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
const MAX_ATTEMPTS = 3;

const state = {
  index: null,
  game: null,
  selectedMovieIdx: null,
  attempts: [],
  activeAttempt: 0,
  gameOver: false,
  best: null,
  view: 'week',
  activeDate: null,
  showingBest: false,
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
  const today = localISODate();
  const dates = state.index.dates;
  const completed = new Set(getCompletedDates());

  const weekDays = getWeekRange();
  $('#week-label').textContent = `${formatDateLabel(weekDays[0])}  —  ${formatDateLabel(weekDays[6])}`;

  const html = weekDays.map((day, i) => {
    const dateStr = getWeekDateStr(day);
    const isToday = dateStr === today;
    const exists = dates.includes(dateStr);
    const done = completed.has(dateStr);
    const dayName = DAY_NAMES[day.getDay()];
    const dayNum = day.getDate();

    let statusText = '';
    let statusClass = '';

    if (!exists) {
      statusText = '—';
      statusClass = 'day-unavailable';
    } else if (done) {
      statusText = '✓';
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
      </button>
    `;
  }).join('');

  $('#day-grid').innerHTML = html;
  $$('.day-card:not([disabled])').forEach(card => {
    card.addEventListener('click', () => playDate(card.dataset.date));
  });
}

async function playDate(date) {
  state.view = 'game';
  state.activeDate = date;
  state.game = await loadPuzzle(date);
  hide($('#week-view'));
  $('#gb-date-label').textContent = formatDateLabel(new Date(date + 'T00:00:00'));
  show($('#game-area'));
  startGame();
}

async function backToWeek() {
  state.view = 'week';
  state.activeDate = null;
  state.game = null;
  hide($('#game-area'));
  renderWeekView();
  show($('#week-view'));
}

function startGame() {
  state.best = computeBestScore();
  state.selectedMovieIdx = null;
  state.showingBest = false;
  state.attempts = emptyAttempts();
  state.activeAttempt = 0;
  state.gameOver = false;
  loadProgress();
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
    state.gameOver = Boolean(parsed.gameOver);
  } catch {
    localStorage.removeItem(progressKey());
  }
}

function saveProgress() {
  localStorage.setItem(progressKey(), JSON.stringify({
    attempts: state.attempts,
    activeAttempt: state.activeAttempt,
    gameOver: state.gameOver,
  }));
}

function renderGame() {
  renderMovies();
  renderRules();
  renderAttempts();
  renderBestReveal();
  renderActions();
  updateSteps();
}

function renderMovies() {
  const active = state.attempts[state.activeAttempt];
  const used = active ? Object.values(active.assignments) : [];
  const movieDetailsByIndex = new Map();
  const bestPickedMovieIndices = new Set();

  if (state.showingBest && state.best?.bestAssign) {
    Object.values(state.best.bestAssign).forEach(movieIdx => bestPickedMovieIndices.add(movieIdx));
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
    const selected = state.selectedMovieIdx === index;
    const detailRows = movieDetailsByIndex.get(index) || [];
    const bestPicked = state.showingBest && bestPickedMovieIndices.has(index);
    const revealRows = state.showingBest ? buildRevealRowsForMovie(movie, index) : [];
    return `
      <button class="movie-card ${assigned ? 'assigned' : ''} ${selected ? 'selected' : ''} ${bestPicked ? 'best-picked' : ''}" data-idx="${index}" type="button" ${assigned || state.gameOver ? 'disabled' : ''}>
        <span class="poster">
          ${poster ? `<img src="${poster}" alt="${escapeHTML(movie.title)}" loading="lazy">` : '<span class="no-poster">FF</span>'}
        </span>
        <span class="title">${escapeHTML(movie.title)}</span>
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
  return state.game.slots.map(slot => {
    const scored = scoreFor(slot.id, movie);
    const best = state.best?.bestAssign?.[slot.id] === movieIndex;
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
      const score = result?.score;
      const detail = result ? getCellDetailText(result) : '';
      return `
        <button class="guess-cell ${movie ? 'filled' : ''}" data-attempt="${attemptIndex}" data-slot="${slot.id}" type="button" ${isActive ? '' : 'disabled'}>
          <span class="cell-title">${movie ? escapeHTML(movie.title) : 'Pick film'}</span>
          <span class="cell-meta">${movie ? escapeHTML(SLOT_RULES[slot.id].short) : 'Open'}</span>
          ${result ? `<span class="cell-detail">${escapeHTML(detail)}</span>` : ''}
          ${score !== undefined ? `<span class="cell-score">${score}</span>` : ''}
        </button>
      `;
    }).join('');

    const scoreText = attempt.submitted ? `${attempt.score} / ${state.best.bestTotal}` : isActive ? 'Live' : '-';
    return `
      <div class="guess-row ${isActive ? 'active' : ''} ${attempt.submitted ? 'submitted' : ''}">
        <div class="guess-label">Try ${attemptIndex + 1}</div>
        <div class="guess-cells">${cells}</div>
        <div class="row-score">${scoreText}</div>
      </div>
    `;
  }).join('');

  $$('.guess-cell').forEach(cell => {
    cell.addEventListener('click', () => selectCell(parseInt(cell.dataset.attempt, 10), cell.dataset.slot));
  });
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

  if (state.gameOver) {
    const finalAttempt = lastSubmittedAttempt();
    status.textContent = finalAttempt?.score === state.best.bestTotal
      ? `Perfect. You found ${state.best.bestTotal}.`
      : `Finished. Best possible was ${state.best.bestTotal}.`;
    submit.hidden = true;
    reveal.hidden = false;
    share.hidden = false;
    reset.hidden = false;
  } else {
    const left = active ? state.game.slots.length - Object.keys(active.assignments).length : 0;
    status.textContent = state.selectedMovieIdx !== null
      ? `${state.game.movies[state.selectedMovieIdx].title} selected. Put it under a rule.`
      : `${left} slot${left === 1 ? '' : 's'} left in try ${state.activeAttempt + 1}.`;
    submit.hidden = false;
    submit.disabled = !ready;
    submit.textContent = `Submit Try ${state.activeAttempt + 1}`;
    reveal.hidden = true;
    share.hidden = true;
    reset.hidden = false;
  }
}

function selectMovie(idx) {
  if (state.gameOver) return;
  const active = state.attempts[state.activeAttempt];
  if (Object.values(active.assignments).includes(idx)) return;
  state.selectedMovieIdx = idx;
  renderMovies();
  renderActions();
}

function selectCell(attemptIndex, slotId) {
  if (state.gameOver || attemptIndex !== state.activeAttempt) return;
  const active = state.attempts[state.activeAttempt];

  if (state.selectedMovieIdx !== null) {
    if (Object.values(active.assignments).includes(state.selectedMovieIdx)) return;
    active.assignments[slotId] = state.selectedMovieIdx;
    state.selectedMovieIdx = null;
  } else if (active.assignments[slotId] !== undefined) {
    delete active.assignments[slotId];
  }

  saveProgress();
  renderGame();
}

function submitAttempt() {
  if (state.gameOver) return;
  const active = state.attempts[state.activeAttempt];
  if (!state.game.slots.every(slot => active.assignments[slot.id] !== undefined)) return;

  const scored = buildResults(active.assignments);
  active.submitted = true;
  active.score = scored.total;
  active.results = scored.results;
  state.selectedMovieIdx = null;

  if (scored.total === state.best.bestTotal || state.activeAttempt === MAX_ATTEMPTS - 1) {
    state.gameOver = true;
    markCompletedDate(state.game.date);
  } else {
    state.activeAttempt += 1;
  }

  saveProgress();
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

function renderBestReveal() {
  const el = $('#best-reveal');
  if (!el) return;
  if (!state.showingBest) {
    hide(el);
    el.innerHTML = '';
    return;
  }

  el.innerHTML = `
    <div class="best-reveal-head">
      <h2>Highest Possible</h2>
      <strong>${state.best.bestTotal}</strong>
    </div>
    <div class="best-grid">
      ${state.best.bestResults.map(result => `
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
  return rowSymbol(attempt).repeat(5);
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
  localStorage.removeItem(progressKey());
  state.attempts = emptyAttempts();
  state.activeAttempt = 0;
  state.gameOver = false;
  state.selectedMovieIdx = null;
  state.showingBest = false;
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

  const el = $('#pp-list');
  if (dates.length === 0) {
    el.innerHTML = '<p class="pp-empty">No puzzles are available yet.</p>';
  } else {
    el.innerHTML = dates.map(date => `
      <button class="pp-item" data-date="${date}" type="button">
        <span class="pp-date-wrap">
          <span class="pp-date">${date}</span>
          ${completed.has(date) ? '<span class="pp-check" aria-label="Finished">✓</span>' : ''}
        </span>
        <span class="pp-play-btn">Play</span>
      </button>
    `).join('');
    el.querySelectorAll('.pp-item').forEach(item => {
      item.addEventListener('click', () => {
        hide($('#past-puzzles-modal'));
        playDate(item.dataset.date);
      });
    });
  }
  show($('#past-puzzles-modal'));
}

window.toggleScoring = function toggleScoring() {
  const el = $('#scoring-ref');
  el.hidden = !el.hidden;
};

$('#submit-btn').addEventListener('click', submitAttempt);
$('#back-to-week-btn').addEventListener('click', backToWeek);
$('#past-puzzles-btn').addEventListener('click', openPastPuzzles);
$('#pp-close-btn').addEventListener('click', () => hide($('#past-puzzles-modal')));
$('#pp-close-bg').addEventListener('click', () => hide($('#past-puzzles-modal')));
$('#try-again-btn').addEventListener('click', tryAgain);
$('#share-btn').addEventListener('click', shareResult);
$('#scoring-btn').addEventListener('click', toggleScoring);
$('#reveal-best-btn').addEventListener('click', () => {
  state.showingBest = !state.showingBest;
  $('#reveal-best-btn').textContent = state.showingBest ? 'Hide Best' : 'Reveal Best';
  renderBestReveal();
  renderMovies();
});

init();
