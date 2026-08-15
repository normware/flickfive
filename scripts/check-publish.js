const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX_FILE = path.join(ROOT, 'public', 'data', 'index.json');
const PUZZLE_DIR = path.join(ROOT, 'public', 'data', 'puzzles');

function isoDate(date) {
  return date.toISOString().split('T')[0];
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function fail(messages) {
  console.error('Publish check failed:');
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}

const failures = [];

if (!fs.existsSync(INDEX_FILE)) {
  fail([`missing ${path.relative(ROOT, INDEX_FILE)}`]);
}

const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
const dates = Array.isArray(index.dates) ? index.dates : [];
const dateSet = new Set(dates);
const today = isoDate(new Date());
const tomorrow = isoDate(addDays(new Date(), 1));

if (!dateSet.has(today)) failures.push(`index missing today ${today}`);
if (!dateSet.has(tomorrow)) failures.push(`index missing tomorrow ${tomorrow}`);

for (const date of dates) {
  const puzzleFile = path.join(PUZZLE_DIR, `${date}.json`);
  if (!fs.existsSync(puzzleFile)) {
    failures.push(`index lists missing puzzle ${path.relative(ROOT, puzzleFile)}`);
    continue;
  }

  try {
    const puzzle = JSON.parse(fs.readFileSync(puzzleFile, 'utf8'));
    assert.strictEqual(puzzle.date, date);
    assert.strictEqual(Array.isArray(puzzle.slots), true);
    assert.strictEqual(puzzle.slots.length, 5);
    assert.strictEqual(Array.isArray(puzzle.movies), true);
    assert.strictEqual(puzzle.movies.length, 5);
  } catch (err) {
    failures.push(`${path.relative(ROOT, puzzleFile)} is invalid: ${err.message}`);
  }
}

if (failures.length) fail(failures);

console.log(`Publish check passed for ${dates.length} puzzle${dates.length === 1 ? '' : 's'}.`);
