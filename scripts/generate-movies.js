require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TMDB_KEY = process.env.TMDB_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const ENC_KEY = crypto.createHash('sha256').update(JWT_SECRET).digest();
const DATA_DIR = path.join(__dirname, '..', 'data');
const ARCHIVE_FILE = path.join(DATA_DIR, 'archive.enc');

if (!TMDB_KEY || TMDB_KEY === '<your-api-key>') {
  console.error('Set TMDB_KEY in .env first');
  process.exit(1);
}

function tmdbFetch(path) {
  return new Promise((resolve, reject) => {
    const url = `https://api.themoviedb.org/3${path}`;
    const options = { headers: { Authorization: `Bearer ${TMDB_KEY}`, accept: 'application/json' } };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  return JSON.stringify({ iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: enc });
}

function decrypt(text) {
  const { iv, tag, data } = JSON.parse(text);
  const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  let dec = d.update(data, 'hex', 'utf8');
  dec += d.final('utf8');
  return dec;
}

function loadArchive() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ARCHIVE_FILE)) return { days: [] };
  try { return JSON.parse(decrypt(fs.readFileSync(ARCHIVE_FILE, 'utf8'))); }
  catch { return { days: [] }; }
}

function saveArchive(a) {
  fs.writeFileSync(ARCHIVE_FILE, encrypt(JSON.stringify(a)));
}

function passesBasic(m) {
  if (!m.vote_average || m.vote_average < 5) return false;
  if (!m.release_date || m.release_date < '1960-01-01') return false;
  const d = new Date(m.release_date);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 56);
  if (d > cutoff) return false;
  if (!m.popularity || m.popularity < 5) return false;
  return true;
}

async function generate() {
  const archive = loadArchive();
  const existingDates = new Set(archive.days.map(d => d.date));
  const usedIds = new Set(archive.days.flatMap(d => d.movies.map(m => m.id)));

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const s = d.toISOString().split('T')[0];
    if (!existingDates.has(s)) days.push(s);
  }

  if (days.length === 0) { console.log('All days already have data.'); return; }
  console.log(`Need data for ${days.length} day(s): ${days.join(', ')}`);

  const allMovies = [];
  for (let page = 1; page <= 15; page++) {
    const data = await tmdbFetch(`/discover/movie?sort_by=popularity.desc&vote_average.gte=5&primary_release_date.gte=1960-01-01&page=${page}`);
    if (!data.results || data.results.length === 0) break;
    allMovies.push(...data.results);
    if (allMovies.length >= 200) break;
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`Fetched ${allMovies.length} movies from TMDB`);

  let candidates = allMovies.filter(m => passesBasic(m) && !usedIds.has(m.id));
  console.log(`${candidates.length} pass basic filters`);

  const detailed = [];
  for (const movie of candidates) {
    if (detailed.length >= days.length * 5 + 5) break;
    try {
      const d = await tmdbFetch(`/movie/${movie.id}`);
      await new Promise(r => setTimeout(r, 300));
      if (!d.revenue || d.revenue <= 0) continue;
      if (!d.runtime || d.runtime <= 0) continue;
      if (!d.genres || d.genres.length === 0) continue;
      detailed.push({
        id: d.id,
        title: d.title,
        poster: d.poster_path,
        year: new Date(d.release_date).getFullYear(),
        rating: d.vote_average,
        revenue: d.revenue,
        genreCount: d.genres.length,
        genres: d.genres.map(g => g.name),
        runtime: d.runtime,
      });
    } catch (e) {
      console.error(`Error fetching ${movie.id}: ${e.message}`);
    }
  }

  console.log(`${detailed.length} movies with full details`);

  if (detailed.length < days.length * 5) {
    console.error(`Not enough movies: need ${days.length * 5}, got ${detailed.length}`);
    process.exit(1);
  }

  for (let i = detailed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [detailed[i], detailed[j]] = [detailed[j], detailed[i]];
  }

  const slotTypes = ['year', 'rating', 'boxOffice', 'genres', 'runtime'];

  for (let i = 0; i < days.length; i++) {
    const dayMovies = detailed.slice(i * 5, i * 5 + 5);
    const slots = [...slotTypes];
    for (let s = slots.length - 1; s > 0; s--) {
      const sj = Math.floor(Math.random() * (s + 1));
      [slots[s], slots[sj]] = [slots[sj], slots[s]];
    }
    archive.days.push({ date: days[i], slots, movies: dayMovies });
    console.log(`  ${days[i]}: ${dayMovies.map(m => m.title).join(', ')}`);
  }

  saveArchive(archive);
  console.log(`\nDone. Archive has ${archive.days.length} days total.`);
}

generate().catch(e => { console.error(e); process.exit(1); });
