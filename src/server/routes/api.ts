import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type {
  ArchiveResponse,
  ErrorResponse,
  InitResponse,
  PracticeRequest,
  PracticeResponse,
  Result,
  SaveSourcesResponse,
  SourceConfig,
  StoredPuzzle,
  SubmitRequest,
  SubmitResponse,
  SubredditSearchResponse,
  SubredditSuggestion,
} from '../../shared/api';
import { computeStats, grade, isValidGuess } from '../../shared/scoring';
import { buildPuzzle, nextPuzzleAt, regeneratePuzzle, todayUtc } from '../core/puzzle';
import { normalizeSubredditName } from '../core/select';
import { KNOWN_SUBREDDITS, rankSuggestions } from '../core/suggest';
import {
  addCommunityPlay,
  cacheSubInfo,
  dateForPost,
  getCachedSubInfo,
  getCommunity,
  getPuzzle,
  getResults,
  getSeenSubreddits,
  getSources,
  listPuzzleDates,
  saveResult,
  setSources,
  type SubInfo,
} from '../core/store';

export const api = new Hono();

const MAX_SUBREDDITS = 25;

const fail = (c: HonoContext, message: string, status: 400 | 403 | 404 | 500 = 400) =>
  c.json<ErrorResponse>({ status: 'error', message }, status);

async function isModerator(): Promise<boolean> {
  try {
    const user = await reddit.getCurrentUser();
    if (!user) return false;
    const perms = await user.getModPermissionsForSubreddit(context.subredditName);
    return perms.length > 0;
  } catch (err) {
    console.warn(`mod check failed: ${String(err)}`);
    return false;
  }
}

/** The puzzle for the post being viewed, or the newest one. */
async function currentPuzzle(dates: string[]): Promise<StoredPuzzle | null> {
  let date: string | null = null;
  if (context.postId) date = await dateForPost(context.postId);
  const fromPostData = context.postData?.date;
  if (!date && typeof fromPostData === 'string') date = fromPostData;
  date ??= dates[dates.length - 1] ?? null;
  return date ? getPuzzle(date) : null;
}

/** A result counts only if it was for the puzzle as it is now (see regenerate). */
function resultFor(p: StoredPuzzle, results: Record<string, Result>): Result | null {
  const r = results[p.date];
  return r && (!r.puzzleId || r.puzzleId === p.post.id) ? r : null;
}

const reveal = (p: StoredPuzzle) => p.comments.map(({ id, body, author, score }) => ({ id, body, author, score }));

// ------------------------------------------------------------ player

api.get('/init', async (c) => {
  const [dates, sources, isMod] = await Promise.all([listPuzzleDates(), getSources(), isModerator()]);
  const latest = dates[dates.length - 1] ?? null;
  const puzzle = await currentPuzzle(dates);
  const userId = context.userId;
  const results = userId ? await getResults(userId) : {};
  const result = puzzle ? resultFor(puzzle, results) : null;
  const latestPuzzle = latest ? await getPuzzle(latest) : null;

  return c.json<InitResponse>({
    type: 'init',
    username: context.username ?? null,
    isMod,
    isLatest: puzzle !== null && puzzle.date === latest,
    latestPostId: latestPuzzle?.redditPostId ?? null,
    nextPuzzleAt: nextPuzzleAt(latest ?? new Date().toISOString().slice(0, 10)),
    sources,
    stats: userId ? computeStats(dates, results) : null,
    puzzle: puzzle && {
      number: puzzle.number,
      date: puzzle.date,
      sourceDate: puzzle.sourceDate,
      post: puzzle.post,
      // Scores stay on the server until the player locks in.
      comments: puzzle.comments.map(({ id, body }) => ({ id, body })),
    },
    result,
    reveal: puzzle && result ? reveal(puzzle) : null,
    community: puzzle && result ? await getCommunity(puzzle.date) : null,
  });
});

api.post('/submit', async (c) => {
  const body = await c.req.json<SubmitRequest>().catch(() => null);
  const dates = await listPuzzleDates();
  const puzzle = await currentPuzzle(dates);
  if (!puzzle) return fail(c, 'No puzzle found for this post.', 404);
  if (!body || !isValidGuess(puzzle.comments, body.guess)) return fail(c, 'Please rank every comment.');

  const userId = context.userId;
  const results = userId ? await getResults(userId) : {};
  const already = resultFor(puzzle, results);
  if (already) {
    // Played already (maybe on another device): keep the first answer.
    return c.json<SubmitResponse>({
      type: 'submit',
      result: already,
      reveal: reveal(puzzle),
      stats: computeStats(dates, results),
      community: await getCommunity(puzzle.date),
    });
  }

  const { marks, points } = grade(puzzle.comments, body.guess);
  const result: Result = {
    guess: body.guess,
    points,
    marks,
    at: Date.now(),
    daily: puzzle.date === dates[dates.length - 1],
    puzzleId: puzzle.post.id,
  };
  if (userId) {
    await saveResult(userId, puzzle.date, result);
    results[puzzle.date] = result;
    await addCommunityPlay(puzzle.date, points);
  }
  return c.json<SubmitResponse>({
    type: 'submit',
    result,
    reveal: reveal(puzzle),
    stats: userId ? computeStats(dates, results) : null,
    community: await getCommunity(puzzle.date),
  });
});

// Play again: a fresh post from the same sources, for practice. Nothing is
// stored (not the puzzle, the result, stats or community numbers) and the
// post isn't marked as used, so it can still become a daily puzzle later.
api.post('/practice', async (c) => {
  const body = await c.req.json<PracticeRequest>().catch(() => null);
  const exclude = Array.isArray(body?.exclude)
    ? body.exclude.filter((x): x is string => typeof x === 'string').slice(0, 100)
    : [];
  try {
    const p = await buildPuzzle(todayUtc(), await getSources(), { exclude, practice: true });
    return c.json<PracticeResponse>({ type: 'practice', post: p.post, comments: reveal(p) });
  } catch (err) {
    console.warn(`practice failed: ${String(err)}`);
    return fail(c, "Couldn't find another post to play right now. Try again in a bit.", 500);
  }
});

api.get('/archive', async (c) => {
  const dates = await listPuzzleDates();
  const results = context.userId ? await getResults(context.userId) : {};
  const recent = dates.slice(-60).reverse();
  const puzzles = await Promise.all(recent.map((d) => getPuzzle(d)));
  return c.json<ArchiveResponse>({
    entries: puzzles
      .filter((p): p is StoredPuzzle => p !== null)
      .map((p) => ({
        number: p.number,
        date: p.date,
        subreddit: p.post.subreddit,
        redditPostId: p.redditPostId ?? null,
        points: resultFor(p, results)?.points ?? null,
      })),
  });
});

// ------------------------------------------------------------ moderators

async function lookupSubreddit(name: string): Promise<SubInfo> {
  const cached = await getCachedSubInfo(name);
  if (cached) return cached;
  let info: SubInfo;
  try {
    const sub = await reddit.getSubredditInfoByName(name);
    info = sub.name
      ? { name: sub.name, exists: true, nsfw: Boolean(sub.isNsfw), subscribers: sub.subscribersCount }
      : { name, exists: false, nsfw: false };
  } catch {
    info = { name, exists: false, nsfw: false };
  }
  await cacheSubInfo(name, info);
  return info;
}

api.get('/subreddits/search', async (c) => {
  if (!(await isModerator())) return fail(c, 'Moderators only.', 403);
  const query = (c.req.query('q') ?? '').slice(0, 30);
  const selected = new Set((c.req.query('exclude') ?? '').toLowerCase().split(',').filter(Boolean));

  const seen = await getSeenSubreddits();
  const ranked = rankSuggestions({ query, known: KNOWN_SUBREDDITS, seen, exclude: selected, limit: 8 });
  const suggestions: SubredditSuggestion[] = ranked.map((r) => ({ name: r.name, source: r.source }));

  // Anything typed in full is checked against Reddit, so any subreddit works,
  // not just the ones we know about.
  const typed = normalizeSubredditName(query);
  if (typed && !selected.has(typed.toLowerCase())) {
    const info = await lookupSubreddit(typed);
    const rest = suggestions.filter((s) => s.name.toLowerCase() !== info.name.toLowerCase());
    if (info.exists && !info.nsfw) {
      suggestions.splice(0, suggestions.length, { name: info.name, subscribers: info.subscribers, source: 'exact' }, ...rest);
    }
  }

  // Member counts for suggestions we've looked up before.
  for (const s of suggestions) {
    if (s.subscribers === undefined) s.subscribers = (await getCachedSubInfo(s.name))?.subscribers;
  }
  return c.json<SubredditSearchResponse>({ query, suggestions: suggestions.slice(0, 8) });
});

api.post('/sources', async (c) => {
  if (!(await isModerator())) return fail(c, 'Moderators only.', 403);
  const body = await c.req.json<SourceConfig>().catch(() => null);
  if (!body || (body.mode !== 'popular' && body.mode !== 'custom') || !Array.isArray(body.subreddits)) {
    return fail(c, 'Invalid settings.');
  }
  if (body.mode === 'popular') {
    const cfg: SourceConfig = { mode: 'popular', subreddits: [] };
    await setSources(cfg);
    return c.json<SaveSourcesResponse>({ ok: true, sources: cfg });
  }

  const names = [...new Set(body.subreddits.map((s) => String(s)))].slice(0, MAX_SUBREDDITS + 1);
  if (!names.length) return c.json<SaveSourcesResponse>({ ok: false, message: 'Add at least one subreddit.' });
  if (names.length > MAX_SUBREDDITS) {
    return c.json<SaveSourcesResponse>({ ok: false, message: `Pick at most ${MAX_SUBREDDITS} subreddits.` });
  }
  const invalid: string[] = [];
  const canonical: string[] = [];
  for (const raw of names) {
    const name = normalizeSubredditName(raw);
    const info = name ? await lookupSubreddit(name) : null;
    if (!info?.exists || info.nsfw) invalid.push(raw);
    else if (!canonical.some((n) => n.toLowerCase() === info.name.toLowerCase())) canonical.push(info.name);
  }
  if (invalid.length) {
    return c.json<SaveSourcesResponse>({
      ok: false,
      message: `Couldn't use: r/${invalid.join(', r/')}. They may not exist, be private, or be NSFW.`,
      invalid,
    });
  }
  const cfg: SourceConfig = { mode: 'custom', subreddits: canonical };
  await setSources(cfg);
  return c.json<SaveSourcesResponse>({ ok: true, sources: cfg });
});

api.post('/regenerate', async (c) => {
  if (!(await isModerator())) return fail(c, 'Moderators only.', 403);
  try {
    const p = await regeneratePuzzle();
    return c.json({ ok: true, date: p.date, redditPostId: p.redditPostId ?? null });
  } catch (err) {
    return fail(c, err instanceof Error ? err.message : String(err), 500);
  }
});
