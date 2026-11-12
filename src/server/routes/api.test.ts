// Route-level tests using Devvit's test harness: real Redis semantics
// (ioredis-mock), request context, and the post-submission mock. Only the
// listing/comment fetches are stubbed, because Devvit's Listings mock is
// not implemented.

import { expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { Context, reddit, runWithContext } from '@devvit/web/server';
import type {
  ArchiveResponse,
  ErrorResponse,
  InitResponse,
  LeaderboardResponse,
  PracticeResponse,
  SaveSourcesResponse,
  SubmitResponse,
  SubredditSearchResponse,
} from '../../shared/api';
import type { RawComment, RawPost } from '../core/select';

vi.mock('../core/reddit-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/reddit-source')>()),
  fetchTopPosts: vi.fn(),
  fetchTopLevelComments: vi.fn(),
}));

const source = await import('../core/reddit-source');
const { api } = await import('./api');
const { scheduler, menu } = await import('./internal');

const app = new Hono();
app.route('/api', api);
app.route('/internal/scheduler', scheduler);
app.route('/internal/menu', menu);

const test = createDevvitTest({ subredditName: 'iknowreddit_test' });

// ------------------------------------------------------------ fixtures

const TODAY = '2026-11-12';
const YESTERDAY_NOON = Date.parse('2026-11-11T12:00:00Z');

const post = (id: string, extra: Partial<RawPost> = {}): RawPost => ({
  id: `t3_${id}`,
  title: `Post ${id}`,
  subredditName: 'pics',
  authorName: 'op',
  score: 50_000,
  numComments: 900,
  permalink: `/r/pics/comments/${id}/post/`,
  createdAt: YESTERDAY_NOON,
  url: `https://i.redd.it/${id}.jpg`,
  nsfw: false,
  spoiler: false,
  stickied: false,
  removed: false,
  quarantined: false,
  thumbnail: { width: 140, height: 105 },
  gallery: [],
  ...extra,
});

const comment = (id: string, body: string, score: number, extra: Partial<RawComment> = {}): RawComment => ({
  id: `t1_${id}`,
  body,
  score,
  authorName: `user_${id}`,
  stickied: false,
  removed: false,
  isTopLevel: true,
  ...extra,
});

const GOOD = [
  comment('a', 'That vise has seen things.', 5400),
  comment('b', 'Every tool has a place.', 3100),
  comment('c', 'Grandpa energy.', 1200),
  comment('d', 'Not a single power tool in sight, respect.', 640),
  comment('e', 'Somewhere a hand plane is weeping with joy.', 310),
];
const CORRECT = ['t1_a', 't1_b', 't1_c', 't1_d'];

const LONG = Array.from({ length: 12 }, (_, i) =>
  comment(`l${i}`, `${'This one is far too long to fit. '.repeat(7)}`, 9000 - i * 500)
);

const COMMENTS: Record<string, RawComment[]> = {
  t3_long: LONG,
  t3_good: GOOD,
  t3_aww1: GOOD.map((c) => ({ ...c, id: c.id.replace('t1_', 't1_aww') })),
  t3_next: GOOD.map((c) => ({ ...c, id: c.id.replace('t1_', 't1_next') })),
};

const POPULAR = [
  post('video', { url: 'https://v.redd.it/video', score: 99_000 }),
  post('nsfw', { nsfw: true, score: 90_000 }),
  post('long', { score: 80_000 }),
  post('good', { subredditName: 'woodworking', score: 70_000 }),
];

// ------------------------------------------------------------ helpers

async function call<T>(
  headers: Record<string, string | undefined>,
  path: string,
  init: { method?: string; body?: unknown; postId?: string } = {}
): Promise<{ status: number; body: T }> {
  const ctx = Context({ ...headers, ...(init.postId ? { 'devvit-post': init.postId } : {}) });
  return runWithContext(ctx, async () => {
    const res = await app.request(path, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    return { status: res.status, body: (await res.json()) as T };
  });
}

function asModerator(isMod: boolean) {
  const user = { getModPermissionsForSubreddit: async () => (isMod ? ['all'] : []) };
  vi.spyOn(reddit, 'getCurrentUser').mockResolvedValue(user as never);
}

function stubSubredditInfo() {
  vi.spyOn(reddit, 'getSubredditInfoByName').mockImplementation(async (name: string) => {
    const known: Record<string, { name: string; subscribersCount: number; isNsfw: boolean }> = {
      pics: { name: 'pics', subscribersCount: 31_000_000, isNsfw: false },
      aww: { name: 'aww', subscribersCount: 37_000_000, isNsfw: false },
      mysmallsub: { name: 'MySmallSub', subscribersCount: 1234, isNsfw: false },
      spicysub: { name: 'SpicySub', subscribersCount: 99, isNsfw: true },
    };
    const info = known[name.toLowerCase()];
    if (!info) throw new Error('SUBREDDIT_NOEXIST');
    return info as never;
  });
}

// ------------------------------------------------------------ the scenario

test('full day: post, play, configure subreddits, replace, next day', async ({ headers }) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T00:05:00Z`));
  vi.mocked(source.fetchTopPosts).mockImplementation(async (sub) => {
    if (sub === 'popular') return POPULAR;
    if (sub === 'aww') return [post('aww1', { subredditName: 'aww' })];
    return [];
  });
  vi.mocked(source.fetchTopLevelComments).mockImplementation(async (id) => COMMENTS[id] ?? []);
  asModerator(false);
  stubSubredditInfo();

  // 1. The scheduler builds and posts today's puzzle, skipping unsuitable posts.
  const run = await call<{ status: string }>(headers, '/internal/scheduler/daily-puzzle', { method: 'POST' });
  expect(run.status).toBe(200);
  const first = await call<InitResponse>(headers, '/api/init');
  const p = first.body.puzzle;
  expect(p?.number).toBe(1);
  expect(p?.date).toBe(TODAY);
  expect(p?.post.subreddit).toBe('woodworking');
  expect(p?.post.permalink).toBe('https://www.reddit.com/r/pics/comments/good/post/');
  expect(first.body.latestPostId).toMatch(/^t3_/);
  const postId = first.body.latestPostId ?? '';

  // Running again (e.g. a retry) doesn't post twice.
  await call(headers, '/internal/scheduler/daily-puzzle', { method: 'POST' });
  expect((await call<ArchiveResponse>(headers, '/api/archive')).body.entries).toHaveLength(1);

  // 2. Scores are hidden until the player submits, and the order is shuffled.
  const init = await call<InitResponse>(headers, '/api/init', { postId });
  expect(init.body.isLatest).toBe(true);
  expect(init.body.isMod).toBe(false);
  expect(init.body.result).toBeNull();
  expect(init.body.reveal).toBeNull();
  expect(JSON.stringify(init.body.puzzle?.comments)).not.toContain('score');
  expect(init.body.puzzle?.comments.map((c) => c.id)).not.toEqual(CORRECT);
  expect(init.body.puzzle?.comments.map((c) => c.id).sort()).toEqual([...CORRECT].sort());

  // 3. Bad guesses are rejected; a perfect guess scores 100 and starts a streak.
  const bad = await call(headers, '/api/submit', { method: 'POST', postId, body: { guess: CORRECT.slice(0, 3) } });
  expect(bad.status).toBe(400);
  const sub = await call<SubmitResponse>(headers, '/api/submit', { method: 'POST', postId, body: { guess: CORRECT } });
  expect(sub.status).toBe(200);
  expect(sub.body.result.points).toBe(100);
  expect(sub.body.result.daily).toBe(true);
  expect(sub.body.reveal.find((c) => c.id === 't1_a')?.score).toBe(5400);
  expect(sub.body.stats).toMatchObject({ played: 1, current: 1, perfect: 1, playedLatest: true });
  expect(sub.body.community).toEqual({ plays: 1, avg: 100, perfect: 1 });

  // A second submission keeps the first answer.
  const again = await call<SubmitResponse>(headers, '/api/submit', {
    method: 'POST',
    postId,
    body: { guess: [...CORRECT].reverse() },
  });
  expect(again.body.result.points).toBe(100);
  const reloaded = await call<InitResponse>(headers, '/api/init', { postId });
  expect(reloaded.body.result?.points).toBe(100);
  expect(reloaded.body.reveal).toHaveLength(4);

  // 4. Moderator-only endpoints.
  expect((await call(headers, '/api/subreddits/search?q=pic')).status).toBe(403);
  expect((await call(headers, '/api/sources', { method: 'POST', body: { mode: 'popular', subreddits: [] } })).status).toBe(403);
  asModerator(true);
  expect((await call<InitResponse>(headers, '/api/init', { postId })).body.isMod).toBe(true);

  // 5. Autocomplete: bundled list + subreddits seen in r/popular + exact lookups.
  const pic = await call<SubredditSearchResponse>(headers, '/api/subreddits/search?q=pic');
  expect(pic.body.suggestions[0]).toMatchObject({ name: 'pics', source: 'popular' });
  const pics = await call<SubredditSearchResponse>(headers, '/api/subreddits/search?q=pics');
  expect(pics.body.suggestions[0]).toMatchObject({ name: 'pics', source: 'exact', subscribers: 31_000_000 });
  expect(pics.body.suggestions.filter((s) => s.name === 'pics')).toHaveLength(1);
  const wood = await call<SubredditSearchResponse>(headers, '/api/subreddits/search?q=wood');
  expect(wood.body.suggestions[0]).toMatchObject({ name: 'woodworking', source: 'popular' });
  const small = await call<SubredditSearchResponse>(headers, '/api/subreddits/search?q=r/mysmallsub');
  expect(small.body.suggestions[0]).toMatchObject({ name: 'MySmallSub', source: 'exact', subscribers: 1234 });
  const spicy = await call<SubredditSearchResponse>(headers, '/api/subreddits/search?q=spicysub');
  expect(spicy.body.suggestions.map((s) => s.name)).not.toContain('SpicySub');
  const excluded = await call<SubredditSearchResponse>(headers, '/api/subreddits/search?q=pic&exclude=pics');
  expect(excluded.body.suggestions.map((s) => s.name)).not.toContain('pics');

  // 6. Saving subreddits validates them and stores canonical names.
  const invalid = await call<SaveSourcesResponse>(headers, '/api/sources', {
    method: 'POST',
    body: { mode: 'custom', subreddits: ['r/aww', 'nosuchsub', 'spicysub'] },
  });
  expect(invalid.body).toMatchObject({ ok: false, invalid: ['nosuchsub', 'spicysub'] });
  const saved = await call<SaveSourcesResponse>(headers, '/api/sources', {
    method: 'POST',
    body: { mode: 'custom', subreddits: ['r/aww', 'mysmallsub', 'AWW'] },
  });
  expect(saved.body).toEqual({ ok: true, sources: { mode: 'custom', subreddits: ['aww', 'MySmallSub'] } });
  expect((await call<InitResponse>(headers, '/api/init')).body.sources.subreddits).toEqual(['aww', 'MySmallSub']);

  // 7. Replacing today's puzzle uses the new subreddits and lets people replay.
  const regen = await call<{ ok: boolean }>(headers, '/api/regenerate', { method: 'POST' });
  expect(regen.body.ok).toBe(true);
  const replaced = await call<InitResponse>(headers, '/api/init', { postId });
  expect(replaced.body.puzzle?.post.subreddit).toBe('aww');
  expect(replaced.body.puzzle?.number).toBe(1);
  expect(replaced.body.result).toBeNull();
  expect(replaced.body.community).toBeNull();

  // 8. The next day gets puzzle #2; yesterday's post becomes an archive puzzle.
  vi.setSystemTime(new Date('2026-11-13T00:05:00Z'));
  vi.mocked(source.fetchTopPosts).mockImplementation(async (sub) =>
    sub === 'MySmallSub' ? [post('next', { subredditName: 'MySmallSub', numComments: 40 })] : []
  );
  expect((await call(headers, '/internal/scheduler/daily-puzzle', { method: 'POST' })).status).toBe(200);
  const day2 = await call<InitResponse>(headers, '/api/init');
  expect(day2.body.puzzle?.number).toBe(2);
  expect(day2.body.puzzle?.post.subreddit).toBe('MySmallSub');
  const old = await call<InitResponse>(headers, '/api/init', { postId });
  expect(old.body.isLatest).toBe(false);
  expect(old.body.puzzle?.number).toBe(1);

  // Playing the old one counts for stats history but not as a daily play.
  const late = await call<SubmitResponse>(headers, '/api/submit', {
    method: 'POST',
    postId,
    body: { guess: ['t1_awwb', 't1_awwa', 't1_awwc', 't1_awwd'] },
  });
  expect(late.body.result).toMatchObject({ points: 50, daily: false });
  expect(late.body.stats).toMatchObject({ played: 0, current: 0 });

  const archive = await call<ArchiveResponse>(headers, '/api/archive');
  expect(archive.body.entries.map((e) => [e.number, e.points])).toEqual([
    [2, null],
    [1, 50],
  ]);
  vi.useRealTimers();
});

test('no suitable post: the scheduler reports a clear error and posts nothing', async ({ headers }) => {
  vi.mocked(source.fetchTopPosts).mockResolvedValue([post('long')]);
  vi.mocked(source.fetchTopLevelComments).mockResolvedValue(LONG);
  const res = await call<{ status: string; message: string }>(headers, '/internal/scheduler/daily-puzzle', {
    method: 'POST',
  });
  expect(res.status).toBe(500);
  expect(res.body.message).toMatch(/No image post in r\/popular/);
  expect((await call<InitResponse>(headers, '/api/init')).body.puzzle).toBeNull();
});

test('r/popular unavailable falls back to r/all', async ({ headers }) => {
  vi.mocked(source.fetchTopPosts).mockImplementation(async (sub) => {
    if (sub === 'popular') throw new Error('not found');
    return [post('good')];
  });
  vi.mocked(source.fetchTopLevelComments).mockResolvedValue(GOOD);
  expect((await call(headers, '/internal/scheduler/daily-puzzle', { method: 'POST' })).status).toBe(200);
  expect(vi.mocked(source.fetchTopPosts)).toHaveBeenCalledWith('all', 'day', 300);
});

test('play again: a different post, nothing saved', async ({ headers }) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T00:05:00Z`));
  vi.mocked(source.fetchTopPosts).mockImplementation(async (sub) =>
    sub === 'popular' ? [...POPULAR, post('next', { score: 60_000 })] : []
  );
  vi.mocked(source.fetchTopLevelComments).mockImplementation(async (id) => COMMENTS[id] ?? []);
  asModerator(false);

  await call(headers, '/internal/scheduler/daily-puzzle', { method: 'POST' });
  const today = (await call<InitResponse>(headers, '/api/init')).body;
  expect(today.puzzle?.post.id).toBe('t3_good');

  // Today's post is already used, so practice picks the other suitable one, with scores.
  const first = await call<PracticeResponse>(headers, '/api/practice', { method: 'POST', body: { exclude: [] } });
  expect(first.status).toBe(200);
  expect(first.body.post.id).toBe('t3_next');
  expect(first.body.comments.map((c) => c.score).sort((a, b) => b - a)).toEqual([5400, 3100, 1200, 640]);

  // Posts already practiced are skipped; with none left it says so.
  const none = await call<ErrorResponse>(headers, '/api/practice', { method: 'POST', body: { exclude: ['t3_next'] } });
  expect(none.status).toBe(500);
  expect(none.body.message).toMatch(/another post/);

  // Nothing was saved: no new puzzle, no results, and the post is still free.
  const after = (await call<InitResponse>(headers, '/api/init')).body;
  expect(after.result).toBeNull();
  expect(after.stats?.played).toBe(0);
  expect((await call<ArchiveResponse>(headers, '/api/archive')).body.entries).toHaveLength(1);
  const again = await call<PracticeResponse>(headers, '/api/practice', { method: 'POST', body: {} });
  expect(again.body.post.id).toBe('t3_next');
  vi.useRealTimers();
});

test('leaderboard: all-time points, with your position', async ({ headers }) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T00:05:00Z`));
  vi.mocked(source.fetchTopPosts).mockImplementation(async (sub) =>
    sub === 'popular' ? [...POPULAR, post('next', { score: 60_000 })] : []
  );
  vi.mocked(source.fetchTopLevelComments).mockImplementation(async (id) => COMMENTS[id] ?? []);
  asModerator(false);
  const as = (id: string, name: string) => ({ ...headers, 'devvit-user': `t2_${id}`, 'devvit-user-name': name });
  const alice = as('a', 'alice');
  const bob = as('b', 'bob');
  const carol = as('c', 'carol');

  await call(headers, '/internal/scheduler/daily-puzzle', { method: 'POST' });
  const postId = (await call<InitResponse>(headers, '/api/init')).body.latestPostId ?? '';

  // Carol has a daily play from before the leaderboard existed.
  const { saveResult } = await import('../core/store');
  await runWithContext(Context(carol), () =>
    saveResult('t2_c', '2026-11-11', { guess: [], points: 70, marks: [], at: 1, daily: true })
  );

  await call(alice, '/api/submit', { method: 'POST', postId, body: { guess: CORRECT } }); // 100
  await call(bob, '/api/submit', { method: 'POST', postId, body: { guess: ['t1_b', 't1_a', 't1_c', 't1_d'] } }); // 50

  const forBob = (await call<LeaderboardResponse>(bob, '/api/leaderboard')).body;
  expect(forBob.allTime.entries.map((e) => [e.rank, e.username, e.points, e.isMe])).toEqual([
    [1, 'alice', 100, false],
    [2, 'bob', 50, true],
  ]);
  expect(forBob.allTime.me).toEqual({ rank: 2, points: 50 });

  // Carol's earlier play counts as soon as she shows up.
  const forCarol = (await call<LeaderboardResponse>(carol, '/api/leaderboard')).body;
  expect(forCarol.allTime.entries.map((e) => [e.username, e.points])).toEqual([
    ['alice', 100],
    ['carol', 70],
    ['bob', 50],
  ]);
  expect(forCarol.allTime.me).toEqual({ rank: 2, points: 70 });
  expect(forCarol.allTime.players).toBe(3);

  // Practice rounds don't count.
  await call(alice, '/api/practice', { method: 'POST', body: { exclude: [] } });
  expect((await call<LeaderboardResponse>(alice, '/api/leaderboard')).body.allTime.me).toEqual({ rank: 1, points: 100 });

  // Logged out: the boards show, without a position.
  const anon = (await call<LeaderboardResponse>({ ...headers, 'devvit-user': undefined }, '/api/leaderboard')).body;
  expect(anon.allTime.entries).toHaveLength(3);
  expect(anon.allTime.me).toBeNull();

  // Replacing today's puzzle takes its scores back off; playing the new one counts.
  asModerator(true);
  expect((await call(alice, '/api/regenerate', { method: 'POST' })).status).toBe(200);
  const cleared = (await call<LeaderboardResponse>(alice, '/api/leaderboard')).body;
  expect(cleared.allTime.entries.map((e) => [e.username, e.points])[0]).toEqual(['carol', 70]);
  expect(cleared.allTime.entries.find((e) => e.username === 'alice')?.points).toBe(0);
  expect(cleared.allTime.entries.find((e) => e.username === 'bob')?.points).toBe(0);
  const fresh = (await call<InitResponse>(alice, '/api/init', { postId })).body;
  const order = ['t1_nexta', 't1_nextb', 't1_nextc', 't1_nextd'];
  expect(fresh.puzzle?.comments.map((c) => c.id).sort()).toEqual(order);
  await call(alice, '/api/submit', { method: 'POST', postId, body: { guess: order } });
  const after = (await call<LeaderboardResponse>(alice, '/api/leaderboard')).body;
  expect(after.allTime.me).toEqual({ rank: 1, points: 100 });
  vi.useRealTimers();
});
