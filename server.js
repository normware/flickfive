require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const ENC_KEY = crypto.createHash('sha256').update(JWT_SECRET).digest();
const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVE_FILE = path.join(DATA_DIR, 'archive.enc');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');

const SLOTS = [
  { id: 'year', name: 'Year Closer', desc: 'Last digit of year (e.g. 2024→4)', getValue: m => m.year % 10, maxScore: 9 },
  { id: 'rating', name: 'Critic Darling', desc: 'Rating rounded down (e.g. 8.3→8)', getValue: m => Math.floor(m.rating), maxScore: 10 },
  { id: 'boxOffice', name: 'Box Office Muscle', desc: '1st digit of box office $M (e.g. $711M→7)', getValue: m => { const n = Math.floor(m.revenue / 1000000); return parseInt(String(n)[0]) || 0; }, maxScore: 9 },
  { id: 'genres', name: 'Genre Blender', desc: 'Number of genres listed (e.g. Action, Sci-Fi)', getValue: m => m.genreCount, maxScore: 8 },
  { id: 'runtime', name: 'Runtime King', desc: 'Runtime ÷ 10, rounded down (e.g. 166→16)', getValue: m => Math.floor(m.runtime / 10), maxScore: 30 },
];

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ iv: iv.toString('hex'), tag, data: enc });
}

function decrypt(text) {
  const { iv, tag, data } = JSON.parse(text);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let dec = decipher.update(data, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

function loadArchive() {
  ensureDir();
  if (!fs.existsSync(ARCHIVE_FILE)) return { days: [] };
  try {
    const encrypted = fs.readFileSync(ARCHIVE_FILE, 'utf8');
    return JSON.parse(decrypt(encrypted));
  } catch {
    return { days: [] };
  }
}

function saveArchive(archive) {
  fs.writeFileSync(ARCHIVE_FILE, encrypt(JSON.stringify(archive)));
}

function loadJSON(file, def) {
  ensureDir();
  if (!fs.existsSync(file)) return def;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return def; }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Missing authorization header' });
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function computeBestScore(day) {
  const movies = day.movies;
  const slots = day.slots;
  let bestTotal = 0;
  let bestAssign = null;

  const indices = [0, 1, 2, 3, 4];
  function permute(arr, prefix) {
    if (prefix.length === 5) {
      let total = 0;
      const assign = {};
      for (let i = 0; i < 5; i++) {
        const movieIdx = prefix[i];
        const slotId = slots[i];
        const movie = movies[movieIdx];
        const slot = SLOTS.find(s => s.id === slotId);
        const value = slot.getValue(movie);
        total += Math.min(value, slot.maxScore);
        assign[slotId] = movieIdx;
      }
      if (total > bestTotal) {
        bestTotal = total;
        bestAssign = { ...assign };
      }
      return;
    }
    for (let i = 0; i < arr.length; i++) {
      const next = arr[i];
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      permute(rest, [...prefix, next]);
    }
  }
  permute(indices, []);

  return { bestTotal, bestAssign };
}

app.get('/api/game', (req, res) => {
  const archive = loadArchive();
  const today = new Date().toISOString().split('T')[0];
  const day = archive.days.find(d => d.date === today);
  if (!day) return res.json({ available: false, message: 'No game available for today. New puzzles generated every week.' });

  res.json({
    available: true,
    date: day.date,
    slots: day.slots.map(id => {
      const s = SLOTS.find(sl => sl.id === id);
      return { id: s.id, name: s.name, desc: s.desc, maxScore: s.maxScore };
    }),
    movies: day.movies.map(m => ({
      id: m.id,
      title: m.title,
      poster: m.poster ? `https://image.tmdb.org/t/p/w200${m.poster}` : null,
      year: m.year,
    })),
  });
});

app.post('/api/game/submit', (req, res) => {
  const archive = loadArchive();
  const today = new Date().toISOString().split('T')[0];
  const day = archive.days.find(d => d.date === today);
  if (!day) return res.status(404).json({ error: 'No game for today' });

  const { assignments } = req.body;
  if (!assignments) return res.status(400).json({ error: 'Missing assignments' });

  const results = [];
  let total = 0;

  for (const slotId of day.slots) {
    const movieIdx = assignments[slotId];
    if (movieIdx === undefined || movieIdx === null) {
      return res.status(400).json({ error: `Missing assignment for slot: ${slotId}` });
    }
    const movie = day.movies[movieIdx];
    const slot = SLOTS.find(s => s.id === slotId);
    const value = slot.getValue(movie);
    const score = Math.min(value, slot.maxScore);
    total += score;

    results.push({
      slotId,
      slotName: slot.name,
      movieTitle: movie.title,
      moviePoster: movie.poster ? `https://image.tmdb.org/t/p/w200${movie.poster}` : null,
      value,
      score,
      maxScore: slot.maxScore,
      year: movie.year,
      rating: movie.rating,
      revenue: movie.revenue,
      genreCount: movie.genreCount,
      genres: movie.genres || ['Unknown'],
      runtime: movie.runtime,
    });
  }

  const scores = loadJSON(SCORES_FILE, []);
  const todayScores = scores.filter(s => s.date === today);
  const isHighScore = todayScores.length === 0 || total > Math.max(...todayScores.map(s => s.score));

  scores.push({ date: today, score: total });
  saveJSON(SCORES_FILE, scores);

  const { bestTotal } = computeBestScore(day);

  res.json({ date: today, results, total, bestPossible: bestTotal, isHighScore });
});

app.get('/api/puzzles', (req, res) => {
  const archive = loadArchive();
  const today = new Date().toISOString().split('T')[0];
  const dates = archive.days
    .map(d => d.date)
    .filter(d => d <= today)
    .sort()
    .reverse()
    .slice(0, 14);
  res.json(dates);
});

app.get('/api/puzzle/:date', (req, res) => {
  const archive = loadArchive();
  const day = archive.days.find(d => d.date === req.params.date);
  if (!day) return res.status(404).json({ error: 'No puzzle for that date' });

  res.json({
    available: true,
    date: day.date,
    slots: day.slots.map(id => {
      const s = SLOTS.find(sl => sl.id === id);
      return { id: s.id, name: s.name, desc: s.desc, maxScore: s.maxScore };
    }),
    movies: day.movies.map(m => ({
      id: m.id,
      title: m.title,
      poster: m.poster ? `https://image.tmdb.org/t/p/w200${m.poster}` : null,
      year: m.year,
    })),
  });
});

app.post('/api/puzzle/:date/submit', (req, res) => {
  const archive = loadArchive();
  const day = archive.days.find(d => d.date === req.params.date);
  if (!day) return res.status(404).json({ error: 'No puzzle for that date' });

  const { assignments } = req.body;
  if (!assignments) return res.status(400).json({ error: 'Missing assignments' });

  const results = [];
  let total = 0;

  for (const slotId of day.slots) {
    const movieIdx = assignments[slotId];
    if (movieIdx === undefined || movieIdx === null) {
      return res.status(400).json({ error: `Missing assignment for slot: ${slotId}` });
    }
    const movie = day.movies[movieIdx];
    const slot = SLOTS.find(s => s.id === slotId);
    const value = slot.getValue(movie);
    const score = Math.min(value, slot.maxScore);
    total += score;

    results.push({
      slotId,
      slotName: slot.name,
      movieTitle: movie.title,
      moviePoster: movie.poster ? `https://image.tmdb.org/t/p/w200${movie.poster}` : null,
      value,
      score,
      maxScore: slot.maxScore,
      year: movie.year,
      rating: movie.rating,
      revenue: movie.revenue,
      genreCount: movie.genreCount,
      genres: movie.genres || ['Unknown'],
      runtime: movie.runtime,
    });
  }

  const { bestTotal, bestAssign } = computeBestScore(day);

  const bestResults = [];
  for (const slotId of day.slots) {
    const movieIdx = bestAssign[slotId];
    const movie = day.movies[movieIdx];
    const slot = SLOTS.find(s => s.id === slotId);
    const value = slot.getValue(movie);
    const score = Math.min(value, slot.maxScore);
    bestResults.push({
      slotId,
      slotName: slot.name,
      movieTitle: movie.title,
      moviePoster: movie.poster ? `https://image.tmdb.org/t/p/w200${movie.poster}` : null,
      value,
      score,
      maxScore: slot.maxScore,
      year: movie.year,
      rating: movie.rating,
      revenue: movie.revenue,
      genreCount: movie.genreCount,
      genres: movie.genres || ['Unknown'],
      runtime: movie.runtime,
    });
  }

  res.json({ date: day.date, results, total, bestPossible: bestTotal, bestResults, isPastPuzzle: true });
});

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const users = loadJSON(USERS_FILE, []);
  if (users.find(u => u.username === username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const hash = await bcrypt.hash(password, 10);
  const user = { id: Date.now().toString(), username, password: hash };
  users.push(user);
  saveJSON(USERS_FILE, users);

  const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const users = loadJSON(USERS_FILE, []);
  const user = users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

app.post('/api/scores', auth, (req, res) => {
  const { score } = req.body;
  if (typeof score !== 'number') return res.status(400).json({ error: 'Score must be a number' });

  const today = new Date().toISOString().split('T')[0];
  const scores = loadJSON(SCORES_FILE, []);

  const already = scores.find(s => s.userId === req.user.id && s.date === today);
  if (already) return res.status(400).json({ error: 'You already submitted a score today' });

  scores.push({ userId: req.user.id, username: req.user.username, score, date: today });
  scores.sort((a, b) => b.score - a.score);
  saveJSON(SCORES_FILE, scores);

  const rank = scores.findIndex(s => s.userId === req.user.id && s.date === today) + 1;
  res.json({ rank, total: scores.length });
});

app.get('/api/scores', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const scores = loadJSON(SCORES_FILE, []);
  const todayScores = scores.filter(s => s.date === today);
  res.json(todayScores.slice(0, 100));
});

app.get('/api/me', auth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const scores = loadJSON(SCORES_FILE, []);
  const myScore = scores.find(s => s.userId === req.user.id && s.date === today);
  res.json({ username: req.user.username, todayScore: myScore || null });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SlotFlix running at http://localhost:${PORT}`));
