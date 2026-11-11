import { test } from 'vitest';
import assert from 'node:assert/strict';
import { computeStats, grade, isValidGuess } from '../../shared/scoring';

const comments = [
  { id: 'a', score: 100 },
  { id: 'b', score: 500 },
  { id: 'c', score: 50 },
  { id: 'd', score: 1000 },
  { id: 'e', score: 10 },
];

test('grade: exact, one-off and misses', () => {
  assert.deepEqual(grade(comments, ['d', 'b', 'a', 'c', 'e']), {
    marks: ['exact', 'exact', 'exact', 'exact', 'exact'],
    points: 100,
  });
  // Older 5-comment puzzles: 40 for the top, 15 for each other exact, 5 if one off.
  // Swap the top two: both are one spot off.
  assert.deepEqual(grade(comments, ['b', 'd', 'a', 'c', 'e']).points, 5 + 5 + 15 * 3);
  // Fully reversed: only the middle is right.
  assert.deepEqual(grade(comments, ['e', 'c', 'a', 'b', 'd']), {
    marks: ['miss', 'miss', 'exact', 'miss', 'miss'],
    points: 15,
  });
});

test('grade: 4-comment puzzles give 40 for the top, 20 for others, 5 if one off', () => {
  const four = comments.slice(0, 4); // real order: d, b, a, c
  assert.equal(grade(four, ['d', 'b', 'a', 'c']).points, 100);
  assert.equal(grade(four, ['d', 'a', 'b', 'c']).points, 40 + 5 + 5 + 20);
  assert.equal(grade(four, ['b', 'd', 'a', 'c']).points, 5 + 5 + 20 + 20);
  assert.equal(grade(four, ['c', 'a', 'b', 'd']).points, 5 + 5);
});

test('isValidGuess', () => {
  assert.equal(isValidGuess(comments, ['a', 'b', 'c', 'd', 'e']), true);
  assert.equal(isValidGuess(comments, ['a', 'a', 'c', 'd', 'e']), false);
  assert.equal(isValidGuess(comments, ['a', 'b', 'c', 'd']), false);
  assert.equal(isValidGuess(comments, ['a', 'b', 'c', 'd', 'zzz']), false);
  assert.equal(isValidGuess(comments, 'abcde'), false);
});

test('streaks: today unplayed keeps streak alive; archive plays do not count', () => {
  const dates = ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'];
  const results = {
    '2026-11-07': { points: 40, daily: true },
    '2026-11-08': { points: 100, daily: false }, // played later from the archive
    '2026-11-09': { points: 60, daily: true },
    '2026-11-10': { points: 80, daily: true },
  };
  const s = computeStats(dates, results);
  assert.equal(s.current, 2);
  assert.equal(s.maxStreak, 2);
  assert.equal(s.played, 3);
  assert.equal(s.avg, 60);
  assert.equal(s.perfect, 0);
  assert.equal(s.playedLatest, false);
  assert.equal(s.dist[2], 1); // one game with 80 points

  const after = computeStats(dates, { ...results, '2026-11-11': { points: 100, daily: true } });
  assert.equal(after.current, 3);
  assert.equal(after.playedLatest, true);
  assert.equal(after.perfect, 1);
});

test('a missed day resets the current streak', () => {
  const dates = ['2026-11-09', '2026-11-10', '2026-11-11'];
  const s = computeStats(dates, { '2026-11-09': { points: 40, daily: true } });
  assert.equal(s.current, 0);
  assert.equal(s.maxStreak, 1);
});
