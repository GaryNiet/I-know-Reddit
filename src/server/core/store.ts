// Redis storage. Keys are scoped to the installation (one per subreddit).

import { redis } from '@devvit/web/server';
import type { Community, LeaderboardBoard, Result, SourceConfig, StoredPuzzle } from '../../shared/api';

const K = {
  sources: 'ikr:sources',
  puzzles: 'ikr:puzzles', // zset: date -> puzzle number
  puzzle: (date: string) => `ikr:puzzle:${date}`,
  postToDate: (postId: string) => `ikr:post:${postId}`,
  used: 'ikr:used-posts', // zset: source post id -> time used
  seenSubs: 'ikr:seen-subs', // zset: subreddit -> times seen in r/popular
  results: (userId: string) => `ikr:results:${userId}`, // hash: date -> Result
  community: (date: string) => `ikr:community:${date}`, // hash: plays,total,perfect
  lock: (date: string) => `ikr:lock:${date}`,
  subInfo: (name: string) => `ikr:subinfo:${name.toLowerCase()}`,
  lbAll: 'ikr:lb:all', // zset: userId -> total points from daily plays
  lbDay: (date: string) => `ikr:lb:day:${date}`, // zset: userId -> points on that day's puzzle
  lbSynced: 'ikr:lb:synced', // hash: userId -> 1 once their earlier plays are counted
  usernames: 'ikr:usernames', // hash: userId -> username
};

export const DEFAULT_SOURCES: SourceConfig = { mode: 'popular', subreddits: [] };

function parse<T>(raw: string | undefined | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ sources

export async function getSources(): Promise<SourceConfig> {
  const cfg = parse<SourceConfig>(await redis.get(K.sources));
  if (!cfg || (cfg.mode === 'custom' && !cfg.subreddits.length)) return DEFAULT_SOURCES;
  return cfg;
}

export async function setSources(cfg: SourceConfig): Promise<void> {
  await redis.set(K.sources, JSON.stringify(cfg));
}

// ------------------------------------------------------------ puzzles

export async function getPuzzle(date: string): Promise<StoredPuzzle | null> {
  return parse<StoredPuzzle>(await redis.get(K.puzzle(date)));
}

export async function savePuzzle(p: StoredPuzzle): Promise<void> {
  await redis.set(K.puzzle(p.date), JSON.stringify(p));
  await redis.zAdd(K.puzzles, { member: p.date, score: p.number });
  await redis.zAdd(K.used, { member: p.post.id, score: Date.now() });
  if (p.redditPostId) await redis.set(K.postToDate(p.redditPostId), p.date);
}

/** All published puzzle dates, oldest first. */
export async function listPuzzleDates(): Promise<string[]> {
  const rows = await redis.zRange(K.puzzles, 0, -1, { by: 'rank' });
  return rows.map((r) => r.member).sort();
}

export async function nextPuzzleNumber(date: string): Promise<number> {
  const existing = await redis.zScore(K.puzzles, date);
  if (existing !== undefined) return existing;
  return (await redis.zCard(K.puzzles)) + 1;
}

export async function dateForPost(postId: string): Promise<string | null> {
  return (await redis.get(K.postToDate(postId))) ?? null;
}

export async function usedPostIds(): Promise<Set<string>> {
  const rows = await redis.zRange(K.used, 0, -1, { by: 'rank' });
  return new Set(rows.map((r) => r.member));
}

/** Prevents the scheduler and a moderator from building the same day twice. */
export async function withLock<T>(date: string, fn: () => Promise<T>): Promise<T> {
  const key = K.lock(date);
  const ok = await redis.set(key, '1', { nx: true, expiration: new Date(Date.now() + 120_000) });
  if (!ok) throw new Error('A puzzle is already being built, try again in a minute.');
  try {
    return await fn();
  } finally {
    await redis.del(key);
  }
}

// ------------------------------------------------------------ autocomplete data

export async function recordSeenSubreddits(names: string[]): Promise<void> {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  for (const [name, n] of counts) await redis.zIncrBy(K.seenSubs, name, n);
}

export async function getSeenSubreddits(limit = 400): Promise<Map<string, number>> {
  const rows = await redis.zRange(K.seenSubs, 0, limit - 1, { by: 'rank', reverse: true });
  return new Map(rows.map((r) => [r.member, r.score]));
}

export type SubInfo = { name: string; exists: boolean; nsfw: boolean; subscribers?: number | undefined };

export async function getCachedSubInfo(name: string): Promise<SubInfo | null> {
  return parse<SubInfo>(await redis.get(K.subInfo(name)));
}

export async function cacheSubInfo(lookupName: string, info: SubInfo): Promise<void> {
  await redis.set(K.subInfo(lookupName), JSON.stringify(info), {
    expiration: new Date(Date.now() + 3 * 24 * 3600_000),
  });
}

// ------------------------------------------------------------ results

export async function getResults(userId: string): Promise<Record<string, Result>> {
  const all = await redis.hGetAll(K.results(userId));
  const out: Record<string, Result> = {};
  for (const [date, raw] of Object.entries(all)) {
    const r = parse<Result>(raw);
    if (r) out[date] = r;
  }
  return out;
}

export async function saveResult(userId: string, date: string, r: Result): Promise<void> {
  await redis.hSet(K.results(userId), { [date]: JSON.stringify(r) });
}

export async function addCommunityPlay(date: string, points: number): Promise<void> {
  await redis.hIncrBy(K.community(date), 'plays', 1);
  await redis.hIncrBy(K.community(date), 'total', points);
  if (points === 100) await redis.hIncrBy(K.community(date), 'perfect', 1);
}

export async function resetCommunity(date: string): Promise<void> {
  await redis.del(K.community(date));
}

export async function getCommunity(date: string): Promise<Community | null> {
  const h = await redis.hGetAll(K.community(date));
  const plays = Number(h.plays ?? 0);
  if (!plays) return null;
  return {
    plays,
    avg: Math.round(Number(h.total ?? 0) / plays),
    perfect: Number(h.perfect ?? 0),
  };
}

// ------------------------------------------------------------ leaderboard
// Only daily plays (a puzzle played on its own day) count, so replaying old
// puzzles from the archive can't farm points. Practice rounds never reach here.

/** Counts plays made before the leaderboard existed, once per player. */
export async function syncLeaderboard(
  userId: string,
  username: string | undefined,
  results: Record<string, Result>,
  latestDate: string | null
): Promise<void> {
  if (await redis.hGet(K.lbSynced, userId)) return;
  const daily = Object.entries(results).filter(([, r]) => r.daily);
  if (daily.length) {
    const total = daily.reduce((s, [, r]) => s + r.points, 0);
    await redis.zAdd(K.lbAll, { member: userId, score: total });
    const today = latestDate ? results[latestDate] : undefined;
    if (latestDate && today?.daily) await redis.zAdd(K.lbDay(latestDate), { member: userId, score: today.points });
  }
  if (username) await redis.hSet(K.usernames, { [userId]: username });
  await redis.hSet(K.lbSynced, { [userId]: '1' });
}

export async function recordLeaderboardPlay(
  userId: string,
  username: string | undefined,
  date: string,
  points: number
): Promise<void> {
  await redis.zIncrBy(K.lbAll, userId, points);
  await redis.zAdd(K.lbDay(date), { member: userId, score: points });
  if (username) await redis.hSet(K.usernames, { [userId]: username });
}

/** When a day's puzzle is replaced, its scores come off the boards (it can be played again). */
export async function resetLeaderboardDay(date: string): Promise<void> {
  const rows = await redis.zRange(K.lbDay(date), 0, -1, { by: 'rank' });
  for (const { member, score } of rows) await redis.zIncrBy(K.lbAll, member, -score);
  await redis.del(K.lbDay(date));
}

async function readBoard(key: string, userId: string | undefined, limit: number): Promise<LeaderboardBoard> {
  const [top, players] = await Promise.all([
    redis.zRange(key, 0, limit - 1, { by: 'rank', reverse: true }),
    redis.zCard(key),
  ]);
  const names = top.length ? await redis.hMGet(K.usernames, top.map((r) => r.member)) : [];
  const entries = top.map((r, i) => ({
    rank: i + 1,
    username: names[i] ?? 'unknown',
    points: r.score,
    isMe: r.member === userId,
  }));
  let me: LeaderboardBoard['me'] = null;
  if (userId) {
    const [points, asc] = await Promise.all([redis.zScore(key, userId), redis.zRank(key, userId)]);
    if (points !== undefined && asc !== undefined) me = { rank: players - asc, points };
  }
  return { entries, me, players };
}

/** The all-time board. (Per-day scores are only kept so a replaced puzzle's points can be taken back.) */
export async function getLeaderboard(userId: string | undefined, limit = 10): Promise<LeaderboardBoard> {
  return readBoard(K.lbAll, userId, limit);
}
