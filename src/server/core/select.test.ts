import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  cleanBody,
  commentCandidate,
  extractImage,
  isEligiblePost,
  normalizeSubredditName,
  pickComments,
  seededShuffle,
  sentenceCount,
  type RawComment,
  type RawPost,
} from './select';

const c = (id: string, body: string, score: number, extra: Partial<RawComment> = {}): RawComment => ({
  id,
  body,
  score,
  authorName: `u_${id}`,
  stickied: false,
  removed: false,
  isTopLevel: true,
  ...extra,
});

const post = (extra: Partial<RawPost> = {}): RawPost => ({
  id: 't3_p',
  title: 'A post',
  subredditName: 'pics',
  authorName: 'someone',
  score: 50000,
  numComments: 400,
  permalink: '/r/pics/comments/p/a_post/',
  createdAt: Date.parse('2026-11-10T12:00:00Z'),
  url: 'https://i.redd.it/abc.jpg',
  nsfw: false,
  spoiler: false,
  stickied: false,
  removed: false,
  quarantined: false,
  thumbnail: { width: 140, height: 105 },
  gallery: [],
  ...extra,
});

test('sentenceCount', () => {
  assert.equal(sentenceCount('Just one sentence here.'), 1);
  assert.equal(sentenceCount('No punctuation at all'), 1);
  assert.equal(sentenceCount('Wait... what?'), 1);
  assert.equal(sentenceCount('First one. Second one!'), 2);
  assert.equal(sentenceCount('Dr. Who is great.'), 1);
});

test('cleanBody strips markdown and entities', () => {
  assert.equal(cleanBody('This is **bold** and *italic*'), 'This is bold and italic');
  assert.equal(cleanBody('~~nope~~ yes &amp; no'), 'nope yes & no');
});

test('commentCandidate filters junk', () => {
  assert.equal(commentCandidate(c('a', 'Nice', 10, { stickied: true })), null);
  assert.equal(commentCandidate(c('a', 'Nice', 10, { isTopLevel: false })), null);
  assert.equal(commentCandidate(c('a', 'Nice', 10, { distinguishedBy: 'moderator' })), null);
  assert.equal(commentCandidate(c('a', '[deleted]', 10)), null);
  assert.equal(commentCandidate(c('a', 'see https://x.com', 10)), null);
  assert.equal(commentCandidate(c('a', 'line one\n\nline two', 10)), null);
  assert.equal(commentCandidate(c('a', 'Edit: thanks for the award', 10)), null);
  assert.equal(commentCandidate(c('a', 'Hi', 10, { authorName: 'AutoModerator' })), null);
  assert.equal(commentCandidate(c('a', 'Short and sweet.', 10))?.tier, 1);
  assert.equal(commentCandidate(c('a', 'Sentence one is here. Sentence two is here.', 10))?.tier, 2);
  assert.equal(commentCandidate(c('a', 'x'.repeat(300), 10)), null);
});

test('pickComments prefers one-liners with clearly different scores', () => {
  const picked = pickComments([
    c('1', 'Top one.', 5000),
    c('2', 'Almost tied with top.', 4900),
    c('3', 'Third.', 3000),
    c('4', 'Fourth thing.', 1500),
    c('5', 'Fifth thing.', 700),
    c('6', 'Two sentences. Medium length.', 650),
    c('7', 'Sixth.', 300),
    c('8', 'Tiny.', 3),
  ]);
  assert.deepEqual(picked?.map((x) => x.id), ['1', '3', '4', '5']);
});

test('pickComments falls back to two-sentence comments, then gives up', () => {
  const kids = [
    c('1', 'Top one.', 5000),
    c('2', 'Second. With more.', 3000),
    c('3', 'Third.', 1500),
    c('4', 'Fourth. Also more.', 700),
    c('5', 'Fifth.', 300),
  ];
  assert.equal(pickComments(kids)?.length, 4);
  assert.equal(pickComments(kids.slice(0, 3)), null);
});

test('extractImage: Reddit-hosted images and galleries only', () => {
  assert.deepEqual(extractImage(post()), { url: 'https://i.redd.it/abc.jpg', width: 140, height: 105 });
  assert.equal(extractImage(post({ url: 'https://i.imgur.com/abc.jpg' })), null);
  assert.equal(extractImage(post({ url: 'https://v.redd.it/abc' })), null);
  assert.equal(extractImage(post({ url: 'https://www.reddit.com/r/pics/comments/x' })), null);
  const gallery = post({
    url: 'https://www.reddit.com/gallery/abc',
    gallery: [
      { url: 'https://preview.redd.it/one.jpg?width=1080&s=1', width: 1080, height: 720, valid: true },
      { url: 'https://preview.redd.it/two.jpg', width: 10, height: 10, valid: true },
    ],
  });
  assert.deepEqual(extractImage(gallery), {
    url: 'https://preview.redd.it/one.jpg?width=1080&s=1',
    width: 1080,
    height: 720,
    gallery: 2,
  });
});

test('isEligiblePost', () => {
  const opts = { usedIds: new Set<string>(), minComments: 30 };
  assert.equal(isEligiblePost(post(), opts), true);
  assert.equal(isEligiblePost(post({ nsfw: true }), opts), false);
  assert.equal(isEligiblePost(post({ spoiler: true }), opts), false);
  assert.equal(isEligiblePost(post({ numComments: 5 }), opts), false);
  assert.equal(isEligiblePost(post(), { ...opts, usedIds: new Set(['t3_p']) }), false);
  const window: [number, number] = [Date.parse('2026-11-01T00:00:00Z'), Date.parse('2026-11-02T00:00:00Z')];
  assert.equal(isEligiblePost(post(), { ...opts, window }), false);
});

test('seededShuffle is deterministic and never already sorted', () => {
  const items = [5, 4, 3, 2, 1].map((score) => ({ score }));
  const a = seededShuffle(items, '2026-11-12');
  assert.deepEqual(a, seededShuffle(items, '2026-11-12'));
  assert.equal(a.length, 5);
  for (let seed = 0; seed < 200; seed++) {
    const s = seededShuffle(items, `seed-${seed}`).map((x) => x.score);
    assert.notDeepEqual(s, [5, 4, 3, 2, 1]);
  }
});

test('normalizeSubredditName', () => {
  assert.equal(normalizeSubredditName(' r/Pics '), 'Pics');
  assert.equal(normalizeSubredditName('/r/aww/'), 'aww');
  assert.equal(normalizeSubredditName('no spaces allowed'), null);
  assert.equal(normalizeSubredditName('x'), null);
});
