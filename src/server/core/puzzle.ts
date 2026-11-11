// Builds daily puzzles and posts them to the subreddit.

import { context, reddit } from '@devvit/web/server';
import type { SourceConfig, StoredPuzzle } from '../../shared/api';
import {
  CONFIG,
  extractImage,
  isEligiblePost,
  pickComments,
  seededShuffle,
  type RawPost,
} from './select';
import { asT3, fetchTopLevelComments, fetchTopPosts } from './reddit-source';
import {
  getPuzzle,
  getSources,
  nextPuzzleNumber,
  recordSeenSubreddits,
  resetCommunity,
  savePuzzle,
  usedPostIds,
  withLock,
} from './store';

const MAX_POSTS_TO_TRY = 15;

export const todayUtc = (): string => new Date().toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The scheduler builds each puzzle at 00:05 UTC; allow a few minutes. */
export function nextPuzzleAt(latestDate: string): number {
  return Date.parse(`${addDays(latestDate, 1)}T00:10:00Z`);
}

// ------------------------------------------------------------ candidate posts

type Candidates = { posts: RawPost[]; note: string };

async function candidatesFromPopular(date: string, used: Set<string>): Promise<Candidates> {
  let posts: RawPost[];
  let feed = 'popular';
  try {
    posts = await fetchTopPosts('popular', 'day', 300);
  } catch (err) {
    console.warn(`r/popular unavailable (${String(err)}), falling back to r/all`);
    feed = 'all';
    posts = await fetchTopPosts('all', 'day', 300);
  }
  await recordSeenSubreddits(posts.filter((p) => !p.nsfw).map((p) => p.subredditName));

  // "Top of the day" is a rolling 24h window; keep yesterday's posts (with slack).
  const sourceDate = addDays(date, -1);
  const window: [number, number] = [
    Date.parse(`${sourceDate}T00:00:00Z`) - 6 * 3600_000,
    Date.parse(`${date}T00:00:00Z`) + 3600_000,
  ];
  let eligible = posts.filter((p) => isEligiblePost(p, { usedIds: used, minComments: 30, window }));
  if (!eligible.length) eligible = posts.filter((p) => isEligiblePost(p, { usedIds: used, minComments: 30 }));
  eligible.sort((a, b) => b.score - a.score);
  return { posts: eligible, note: `${posts.length} posts from r/${feed}` };
}

async function candidatesFromSubreddits(
  subreddits: string[],
  date: string,
  used: Set<string>
): Promise<Candidates> {
  // Each subreddit's own posts, best first; subreddits take turns (in an
  // order that changes daily) so a big subreddit doesn't win every day.
  let fetched = 0;
  const load = async (sub: string): Promise<RawPost[]> => {
    try {
      let posts = await fetchTopPosts(sub, 'day', 50);
      fetched += posts.length;
      let eligible = posts.filter((p) => isEligiblePost(p, { usedIds: used, minComments: 15 }));
      if (!eligible.length) {
        // Quieter subreddits may not have a good image post every day.
        posts = await fetchTopPosts(sub, 'week', 50);
        fetched += posts.length;
        eligible = posts.filter((p) => isEligiblePost(p, { usedIds: used, minComments: 15 }));
      }
      return eligible.sort((a, b) => b.score - a.score);
    } catch (err) {
      console.warn(`Could not read r/${sub}: ${String(err)}`);
      return [];
    }
  };
  // A few at a time keeps this quick without hammering the API.
  const perSub: RawPost[][] = [];
  for (let i = 0; i < subreddits.length; i += 5) {
    perSub.push(...(await Promise.all(subreddits.slice(i, i + 5).map(load))));
  }
  const order = seededShuffle(perSub.map((posts, i) => ({ posts, score: -i })), date);
  const merged: RawPost[] = [];
  for (let round = 0; merged.length < MAX_POSTS_TO_TRY * 2; round++) {
    let added = false;
    for (const { posts } of order) {
      const p = posts[round];
      if (p) {
        merged.push(p);
        added = true;
      }
    }
    if (!added) break;
  }
  return { posts: merged, note: `${fetched} posts from ${subreddits.length} subreddit(s)` };
}

// ------------------------------------------------------------ building

export async function buildPuzzle(date: string, sources: SourceConfig): Promise<StoredPuzzle> {
  const used = await usedPostIds();
  const { posts, note } =
    sources.mode === 'custom' && sources.subreddits.length
      ? await candidatesFromSubreddits(sources.subreddits, date, used)
      : await candidatesFromPopular(date, used);
  console.log(`Puzzle ${date}: ${note}, ${posts.length} eligible image posts`);

  for (const post of posts.slice(0, MAX_POSTS_TO_TRY)) {
    const comments = pickComments(await fetchTopLevelComments(post.id));
    if (!comments) {
      console.log(`  skip r/${post.subredditName} "${post.title.slice(0, 50)}": not enough short comments`);
      continue;
    }
    const image = extractImage(post);
    if (!image) continue;
    console.log(`  using r/${post.subredditName} "${post.title.slice(0, 50)}"`);
    return {
      number: await nextPuzzleNumber(date),
      date,
      sourceDate: new Date(post.createdAt).toISOString().slice(0, 10),
      sources,
      post: {
        id: post.id,
        title: post.title,
        subreddit: post.subredditName,
        author: post.authorName,
        score: post.score,
        numComments: post.numComments,
        permalink: post.permalink.startsWith('http') ? post.permalink : `https://www.reddit.com${post.permalink}`,
        createdAt: post.createdAt,
        image,
      },
      comments: seededShuffle(
        comments.map(({ id, body, score, author }) => ({ id, body, score, author })),
        date
      ),
    };
  }
  const where = sources.mode === 'custom' ? `r/${sources.subreddits.join(', r/')}` : 'r/popular';
  throw new Error(
    `No image post in ${where} had ${CONFIG.commentsPerPuzzle} short comments with clearly different scores.`
  );
}

async function submitPuzzlePost(p: StoredPuzzle): Promise<string> {
  const pretty = new Date(`${p.date}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const post = await reddit.submitCustomPost({
    subredditName: context.subredditName,
    title: `I Know Reddit #${p.number} (${pretty}): which comment got the most upvotes?`,
    entry: 'default',
    postData: { date: p.date, number: p.number },
    textFallback: {
      text: `Daily puzzle #${p.number}: rank five comments from a popular post by upvotes. Open this post in the Reddit app or on new Reddit to play.`,
    },
  });
  return post.id;
}

/** Builds (if needed) and posts the puzzle for `date`. Returns the Reddit post id. */
export async function ensurePuzzlePost(date = todayUtc()): Promise<{ postId: string; created: boolean }> {
  const existing = await getPuzzle(date);
  if (existing?.redditPostId) return { postId: existing.redditPostId, created: false };
  return withLock(date, async () => {
    const puzzle = existing ?? (await buildPuzzle(date, await getSources()));
    await savePuzzle(puzzle); // save before posting so the post can load it
    puzzle.redditPostId = await submitPuzzlePost(puzzle);
    await savePuzzle(puzzle);
    return { postId: puzzle.redditPostId, created: true };
  });
}

/**
 * Replaces today's puzzle with a different post (e.g. after the moderators
 * changed the subreddit list). The Reddit post stays the same.
 */
export async function regeneratePuzzle(date = todayUtc()): Promise<StoredPuzzle> {
  const existing = await getPuzzle(date);
  if (!existing) {
    const { postId } = await ensurePuzzlePost(date);
    const created = await getPuzzle(date);
    if (!created) throw new Error(`Puzzle ${date} missing after posting ${postId}`);
    return created;
  }
  return withLock(date, async () => {
    const puzzle = await buildPuzzle(date, await getSources());
    puzzle.number = existing.number;
    puzzle.redditPostId = existing.redditPostId;
    await savePuzzle(puzzle);
    await resetCommunity(date);
    return puzzle;
  });
}

export function postUrl(postId: string): string {
  return `https://www.reddit.com/r/${context.subredditName}/comments/${asT3(postId).slice(3)}/`;
}
