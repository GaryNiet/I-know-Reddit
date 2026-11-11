// Scoring and stats. No imports so the unit tests can run with plain Node.

type Mark = 'exact' | 'close' | 'miss';
type ScoredComment = { id: string; score: number };
type StoredResult = { points: number; daily: boolean };

export const POINTS: Record<Mark, number> = { exact: 20, close: 10, miss: 0 };

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
  return { marks, points: marks.reduce((s, m) => s + POINTS[m], 0) };
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

export function verdict(points: number): string {
  if (points === 100) return 'Perfect read of the hive mind';
  if (points >= 80) return 'Certified Redditor';
  if (points >= 60) return 'Seasoned lurker';
  if (points >= 40) return 'Upvote-curious';
  if (points >= 20) return 'Fresh account energy';
  return 'Touch grass? Never.';
}
