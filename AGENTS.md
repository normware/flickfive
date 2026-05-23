# SlotFlix

**Tagline:** Pick 5 movies. Fit 5 daily rules. Chase the highest score.

## Game Flow

- Every day 5 slot rules are generated (order randomized).
- You pick 5 different movies and assign one to each slot.
- After locking in, the app shows:
  - Your total score
  - Whether you got the daily high score
  - Full reveal of all movie data
  - Leaderboard option
  - "Try again tomorrow"

## The 5 Slots & Scoring

| Slot | Category | Scoring Rule | Max Score |
|------|----------|-------------|-----------|
| 1 | Year Closer | Last digit of release year | 9 |
| 2 | Critic Darling | TMDB Rating (integer) | 10 |
| 3 | Box Office Muscle | First digit of worldwide gross (millions) | 9 |
| 4 | Genre Blender | Number of genres (from TMDB) | ~6-8 |
| 5 | Runtime King | Runtime in minutes ÷ 10 (rounded down) | ~30 |

**Total score** = simple sum of the 5 values above.

## Scoring Examples

### Dune: Part Two (2024)
- Year: 4
- Rating: 8
- Box Office: ~711M → 7
- Genres: 4 → 4
- Runtime: 166 min → 16
- **Total: 39**

### Oppenheimer (2023)
- Year: 3
- Rating: 8
- Box Office: ~975M → 9
- Genres: 3 → 3
- Runtime: 180 min → 18
- **Total: 41**

## Tech Notes

- TMDB API used for all movie data
- TMDB_KEY stored in .env, read by API layer
- JWT used for auth
