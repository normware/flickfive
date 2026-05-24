require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const ENC_KEY = crypto.createHash('sha256').update(JWT_SECRET).digest();
const ROOT = path.join(__dirname, '..');
const ARCHIVE_FILE = path.join(ROOT, 'data', 'archive.enc');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const PUZZLE_DIR = path.join(OUT_DIR, 'puzzles');

function decrypt(text) {
  const { iv, tag, data } = JSON.parse(text);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let dec = decipher.update(data, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

function loadArchive() {
  if (!fs.existsSync(ARCHIVE_FILE)) {
    throw new Error(`Missing archive at ${ARCHIVE_FILE}`);
  }

  const encrypted = fs.readFileSync(ARCHIVE_FILE, 'utf8');
  return JSON.parse(decrypt(encrypted));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanPuzzleDir() {
  ensureDir(PUZZLE_DIR);
  for (const name of fs.readdirSync(PUZZLE_DIR)) {
    if (name.endsWith('.json')) fs.unlinkSync(path.join(PUZZLE_DIR, name));
  }
}

function publicMovie(movie) {
  return {
    id: movie.id,
    title: movie.title,
    poster: movie.poster || null,
    year: movie.year,
    rating: movie.rating,
    revenue: movie.revenue,
    genreCount: movie.genreCount,
    genres: movie.genres || ['Unknown'],
    runtime: movie.runtime,
  };
}

function writeJSON(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function exportStatic() {
  const archive = loadArchive();
  const days = [...(archive.days || [])].sort((a, b) => a.date.localeCompare(b.date));

  ensureDir(OUT_DIR);
  cleanPuzzleDir();

  const index = {
    generatedAt: new Date().toISOString(),
    dates: days.map(day => day.date),
  };

  for (const day of days) {
    writeJSON(path.join(PUZZLE_DIR, `${day.date}.json`), {
      date: day.date,
      slots: day.slots,
      movies: day.movies.map(publicMovie),
    });
  }

  writeJSON(path.join(OUT_DIR, 'index.json'), index);
  console.log(`Exported ${days.length} puzzle${days.length === 1 ? '' : 's'} to public/data`);
}

try {
  exportStatic();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
