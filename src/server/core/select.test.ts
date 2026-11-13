import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  cleanBody,
  commentCandidate,
  extractImage,
  isEligiblePost,
  looksTextBased,
  normalizeSubredditName,
  pickComments,
  seededShuffle,
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
  assert.equal(commentCandidate(c('a', 'Short and sweet.', 10))?.body, 'Short and sweet.');
  // Any number of sentences, up to 150 characters.
  assert.equal(commentCandidate(c('a', 'One. Two. Three. Four.', 10))?.body, 'One. Two. Three. Four.');
  assert.equal(commentCandidate(c('a', 'x'.repeat(150), 10))?.body.length, 150);
  assert.equal(commentCandidate(c('a', 'x'.repeat(151), 10)), null);
});

test('pickComments takes the top comments with clearly different scores', () => {
  const picked = pickComments([
    c('1', 'Top one.', 5000),
    c('2', 'Almost tied with top.', 4900),
    c('3', 'Two sentences. Still fine.', 3000),
    c('4', `${'Way too long. '.repeat(15)}`, 2000),
    c('5', 'Fourth thing.', 1500),
    c('6', 'Fifth thing.', 700),
    c('7', 'Tiny.', 3),
  ]);
  assert.deepEqual(picked?.map((x) => x.id), ['1', '3', '5', '6']);
});

test('pickComments gives up without enough suitable comments', () => {
  const kids = [c('1', 'Top one.', 5000), c('2', 'Second.', 3000), c('3', 'Third.', 1500), c('4', 'Too low.', 3)];
  assert.equal(pickComments(kids), null);
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
  // Multi-picture posts are skipped; a gallery with a single picture is fine.
  assert.equal(extractImage(gallery), null);
  assert.deepEqual(extractImage({ ...gallery, gallery: gallery.gallery.slice(0, 1) }), {
    url: 'https://preview.redd.it/one.jpg?width=1080&s=1',
    width: 1080,
    height: 720,
  });
});

test('isEligiblePost', () => {
  const opts = { usedIds: new Set<string>(), minComments: 30 };
  assert.equal(isEligiblePost(post(), opts), true);
  assert.equal(isEligiblePost(post({ nsfw: true }), opts), false);
  assert.equal(isEligiblePost(post({ spoiler: true }), opts), false);
  assert.equal(isEligiblePost(post({ numComments: 5 }), opts), false);
  // A short description is fine; one over 50 characters needs too much context.
  assert.equal(isEligiblePost(post({ body: 'OC, shot on film.' }), opts), true);
  assert.equal(isEligiblePost(post({ body: 'x'.repeat(50) }), opts), true);
  assert.equal(isEligiblePost(post({ body: 'x'.repeat(51) }), opts), false);
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

test('looksTextBased: subreddit, flair and title hints', () => {
  const photo = post({ title: 'My grandpa built this treehouse', subredditName: 'pics' });
  assert.equal(looksTextBased(photo), false);
  // Screenshot-heavy subreddits, unless a moderator picked them.
  assert.equal(looksTextBased({ ...photo, subredditName: 'WhitePeopleTwitter' }), true);
  assert.equal(looksTextBased({ ...photo, subredditName: 'WhitePeopleTwitter' }, { checkSubreddit: false }), false);
  // Flairs.
  assert.equal(looksTextBased({ ...photo, flair: 'Screenshot' }), true);
  assert.equal(looksTextBased({ ...photo, flair: 'Meme' }), true);
  assert.equal(looksTextBased({ ...photo, flair: 'OC' }), false);
  assert.equal(looksTextBased({ ...photo, flair: 'Contextless' }), false); // "text" only as a whole word
  // Titles.
  assert.equal(looksTextBased({ ...photo, title: 'This tweet aged badly' }), true);
  assert.equal(looksTextBased({ ...photo, title: 'My mom texted me this' }), true);
  assert.equal(looksTextBased({ ...photo, title: 'My mom made this quilt' }), false);
  assert.equal(looksTextBased({ ...photo, title: 'Got this text from my landlord' }), true);
  assert.equal(looksTextBased({ ...photo, title: 'Read the fine print' }), true);
  assert.equal(looksTextBased({ ...photo, title: 'Found this sign at the beach' }), true);
  assert.equal(looksTextBased({ ...photo, title: 'Textured wall in my new flat' }), false);
  // And they're excluded from puzzles.
  const opts = { usedIds: new Set<string>(), minComments: 1 };
  assert.equal(isEligiblePost({ ...photo, flair: 'Screenshot' }, opts), false);
  assert.equal(isEligiblePost({ ...photo, subredditName: 'memes' }, { ...opts, checkTextSubreddits: false }), true);
});

