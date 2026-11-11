import test from 'node:test';
import assert from 'node:assert/strict';
import { commentCandidate, pickComments, sentenceCount, cleanBody, extractImage, isEligiblePost } from './generate-puzzle.mjs';

const c = (id, body, score, extra = {}) => ({ kind: 't1', data: { id, author: `u_${id}`, body, score, ...extra } });

test('sentenceCount', () => {
  assert.equal(sentenceCount('Just one sentence here.'), 1);
  assert.equal(sentenceCount('No punctuation at all'), 1);
  assert.equal(sentenceCount('Wait... what?'), 1);
  assert.equal(sentenceCount('First one. Second one!'), 2);
  assert.equal(sentenceCount('Dr. Who is great.'), 1);
});

test('cleanBody strips markdown', () => {
  assert.equal(cleanBody('This is **bold** and *italic*'), 'This is bold and italic');
  assert.equal(cleanBody('~~nope~~ yes'), 'nope yes');
});

test('commentCandidate filters junk', () => {
  assert.equal(commentCandidate(c('a', 'Nice', 10, { stickied: true })), null);
  assert.equal(commentCandidate(c('a', '[deleted]', 10)), null);
  assert.equal(commentCandidate(c('a', 'see https://x.com', 10)), null);
  assert.equal(commentCandidate(c('a', 'line one\n\nline two', 10)), null);
  assert.equal(commentCandidate(c('a', 'Edit: thanks for the award', 10)), null);
  assert.equal(commentCandidate({ kind: 'more', data: {} }), null);
  assert.equal(commentCandidate(c('a', 'Hi', 10, { author: 'AutoModerator' })), null);
  assert.equal(commentCandidate(c('a', 'Short and sweet.', 10)).tier, 1);
  assert.equal(commentCandidate(c('a', 'Sentence one is here. Sentence two is here.', 10)).tier, 2);
  assert.equal(commentCandidate(c('a', 'x'.repeat(300), 10)), null);
});

test('pickComments prefers one-liners with distinct scores', () => {
  const kids = [
    c('1', 'Top one.', 5000),
    c('2', 'Almost tied with top.', 4900),
    c('3', 'Third.', 3000),
    c('4', 'Fourth thing.', 1500),
    c('5', 'Fifth thing.', 700),
    c('6', 'Two sentences. Medium length.', 650),
    c('7', 'Sixth.', 300),
    c('8', 'Tiny.', 3),
  ];
  const picked = pickComments(kids);
  assert.deepEqual(picked.map((x) => x.id), ['1', '3', '4', '5', '7']);
});

test('pickComments falls back to two-sentence comments, then gives up', () => {
  const kids = [
    c('1', 'Top one.', 5000),
    c('2', 'Second. With more.', 3000),
    c('3', 'Third.', 1500),
    c('4', 'Fourth. Also more.', 700),
    c('5', 'Fifth.', 300),
  ];
  assert.equal(pickComments(kids).length, 5);
  assert.equal(pickComments(kids.slice(0, 4)), null);
});

test('image extraction and post eligibility', () => {
  const post = {
    id: 'p', title: 't', num_comments: 100, created_utc: Date.parse('2026-11-10T12:00:00Z') / 1000,
    post_hint: 'image', url: 'https://i.redd.it/abc.jpg',
    preview: { images: [{ source: { url: 'https://preview.redd.it/abc.jpg', width: 2000, height: 1000 }, resolutions: [{ url: 'r640', width: 640, height: 320 }, { url: 'r1080', width: 1080, height: 540 }] }] },
  };
  assert.deepEqual(extractImage(post), { url: 'https://i.redd.it/abc.jpg', preview: 'r1080', width: 2000, height: 1000 });
  const ctx = { usedIds: new Set(), sourceDate: '2026-11-10' };
  assert.equal(isEligiblePost(post, ctx), true);
  assert.equal(isEligiblePost({ ...post, over_18: true }, ctx), false);
  assert.equal(isEligiblePost({ ...post, post_hint: 'link', url: 'https://example.com' }, ctx), false);
  assert.equal(isEligiblePost(post, { ...ctx, usedIds: new Set(['p']) }), false);
  assert.equal(isEligiblePost(post, { ...ctx, sourceDate: '2026-11-01' }), false);

  const gallery = {
    is_gallery: true, gallery_data: { items: [{ media_id: 'm1' }, { media_id: 'm2' }] },
    media_metadata: { m1: { status: 'valid', e: 'Image', s: { u: 'full', x: 1200, y: 800 }, p: [{ u: 'small', x: 640, y: 426 }] } },
  };
  assert.deepEqual(extractImage(gallery), { url: 'full', preview: 'small', width: 1200, height: 800, gallery: 2 });
});
