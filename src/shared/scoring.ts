// Scoring and stats. No imports so the unit tests can run with plain Node.

type Mark = 'exact' | 'close' | 'miss';
type ScoredComment = { id: string; score: number };
type StoredResult = { points: number; daily: boolean };

export const TOP_POINTS = 40;
export const CLOSE_POINTS = 5;

/**
 * Points for one comment, by its real rank (0 = most upvoted).
 * Spotting the top comment is worth 40; every other comment in the right spot
 * shares the remaining 60 (20 each in a 4-comment puzzle, 15 in older
 * 5-comment ones), so a perfect game is always 100. One spot off is 5.
 */
export function pointsFor(mark: Mark, rank: number, commentCount: number): number {
  if (mark === 'close') return CLOSE_POINTS;
  if (mark !== 'exact') return 0;
  if (rank === 0) return TOP_POINTS;
  return Math.round((100 - TOP_POINTS) / Math.max(1, commentCount - 1));
}

/** Comment ids from most to least upvoted. */
export function actualOrder(comments: readonly ScoredComment[]): string[] {
  return [...comments].sort((a, b) => b.score - a.score).map((c) => c.id);
}

/** Marks are listed in the real order (most upvoted first). */
export function grade(
  comments: readonly ScoredComment[],
  guess: readonly string[]
): { marks: Mark[]; points: number } {
  const marks = actualOrder(comments).map((id, i): Mark => {
    const at = guess.indexOf(id);
    const d = at < 0 ? Infinity : Math.abs(at - i);
    return d === 0 ? 'exact' : d === 1 ? 'close' : 'miss';
  });
  return { marks, points: marks.reduce((s, m, i) => s + pointsFor(m, i, marks.length), 0) };
}

export function isValidGuess(
  comments: readonly { id: string }[],
  guess: unknown
): guess is string[] {
  if (!Array.isArray(guess) || guess.length !== comments.length) return false;
  const ids = new Set(comments.map((c) => c.id));
  return new Set(guess).size === guess.length && guess.every((g) => ids.has(g));
}

/**
 * Streaks count consecutive published puzzles played on their day, so a day
 * without a puzzle never breaks a streak.
 * @param dates every published puzzle date, oldest first
 */
export function computeStats(
  dates: readonly string[],
  results: Readonly<Record<string, StoredResult>>
) {
  const onTime = (d: string | undefined) =>
    d !== undefined && results[d]?.daily === true;

  let maxStreak = 0;
  let run = 0;
  for (const d of dates) {
    run = onTime(d) ? run + 1 : 0;
    maxStreak = Math.max(maxStreak, run);
  }

  let current = 0;
  let i = dates.length - 1;
  const playedLatest = onTime(dates[i]);
  if (!playedLatest) i--; // today's not played yet: the streak is still alive
  for (; i >= 0 && onTime(dates[i]); i--) current++;

  const scores = Object.values(results)
    .filter((r) => r.daily)
    .map((r) => r.points);
  const dist = Array.from({ length: 11 }, () => 0);
  for (const s of scores) {
    const bucket = Math.round((100 - s) / 10);
    if (bucket >= 0 && bucket <= 10) dist[bucket] = (dist[bucket] ?? 0) + 1;
  }

  return {
    played: scores.length,
    avg: scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0,
    best: scores.length ? Math.max(...scores) : 0,
    perfect: scores.filter((s) => s === 100).length,
    current,
    maxStreak,
    dist,
    recent: dates.slice(-7).map((date) => ({
      date,
      points: results[date]?.points ?? null,
    })),
    playedLatest,
  };
}
