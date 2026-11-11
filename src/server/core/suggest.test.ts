import { test } from 'vitest';
import assert from 'node:assert/strict';
import { KNOWN_SUBREDDITS, rankSuggestions } from './suggest';

const names = (r: { name: string }[]) => r.map((x) => x.name);

test('prefix matches come before substring matches', () => {
  const r = rankSuggestions({ query: 'pic', known: ['epic', 'pics', 'picturegame'], seen: new Map() });
  assert.deepEqual(names(r), ['pics', 'picturegame', 'epic']);
});

test('subreddits often seen in r/popular rank higher', () => {
  const r = rankSuggestions({
    query: 'm',
    known: ['memes', 'movies', 'Music'],
    seen: new Map([['Music', 3], ['mildlyinteresting', 9]]),
  });
  assert.deepEqual(names(r), ['mildlyinteresting', 'Music', 'memes', 'movies']);
  assert.equal(r[0]?.source, 'popular');
});

test('exact match first, r/ prefix ignored, case-insensitive, exclusions respected', () => {
  const r = rankSuggestions({
    query: 'r/AWW',
    known: ['awwducational', 'aww', 'AwwnimalsBeingBros'],
    seen: new Map(),
    exclude: new Set(['awwducational']),
  });
  assert.deepEqual(names(r), ['aww', 'AwwnimalsBeingBros']);
});

test('limit and no duplicate names in the bundled list', () => {
  assert.equal(rankSuggestions({ query: '', known: KNOWN_SUBREDDITS, seen: new Map(), limit: 5 }).length, 5);
  const lower = KNOWN_SUBREDDITS.map((n) => n.toLowerCase());
  assert.equal(new Set(lower).size, lower.length);
});
