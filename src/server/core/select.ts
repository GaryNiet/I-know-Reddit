// Picks a post and four of its comments for a puzzle. Pure functions over a
// plain data shape (see reddit-source.ts for the Devvit adapter), with no
// imports so the unit tests run with plain Node.

export type RawPost = {
  id: string;
  title: string;
  subredditName: string;
  authorName: string;
  score: number;
  numComments: number;
  permalink: string;
  createdAt: number; // ms
  url: string;
  nsfw: boolean;
  spoiler: boolean;
  stickied: boolean;
  removed: boolean;
  quarantined: boolean;
  thumbnail?: { width: number; height: number } | undefined;
  gallery: { url: string; width: number; height: number; valid: boolean }[];
};

export type RawComment = {
  id: string;
  body: string;
  score: number;
  authorName: string;
  stickied: boolean;
  distinguishedBy?: string | undefined;
  removed: boolean;
  isTopLevel: boolean;
};

export type Candidate = {
  id: string;
  body: string;
  score: number;
  author: string;
  tier: 1 | 2;
};

export const CONFIG = {
  commentsPerPuzzle: 4,
  minCommentScore: 10,
  /** Each comment must have at most this share of the one above it... */
  maxScoreRatio: 0.9,
  /** ...and at least this many fewer points, so the order is guessable. */
  minScoreGap: 5,
  shortMaxChars: 110, // tier 1: a one-liner
  mediumMaxChars: 180, // tier 2: up to two sentences
};

// ------------------------------------------------------------ posts

// The web view can show Reddit-hosted images; other hosts may be blocked.
const IMAGE_URL = /^https:\/\/(i|preview)\.redd\.it\/[^?#]+\.(jpe?g|png|gif|webp)(\?.*)?$/i;

export function extractImage(post: RawPost) {
  const first = post.gallery[0];
  if (first) {
    if (!first.valid || !IMAGE_URL.test(first.url)) return null;
    return {
      url: first.url,
      width: first.width || undefined,
      height: first.height || undefined,
      gallery: post.gallery.length,
    };
  }
  if (!IMAGE_URL.test(post.url)) return null;
  // The thumbnail has the same aspect ratio as the image; good enough for layout.
  const t = post.thumbnail;
  return {
    url: post.url,
    width: t?.width || undefined,
    height: t?.height || undefined,
  };
}

export function isEligiblePost(
  post: RawPost,
  opts: { usedIds: ReadonlySet<string>; minComments: number; window?: [number, number] }
): boolean {
  if (post.nsfw || post.spoiler || post.stickied || post.removed || post.quarantined) return false;
  if (opts.usedIds.has(post.id)) return false;
  if (post.numComments < opts.minComments) return false;
  if (opts.window && (post.createdAt < opts.window[0] || post.createdAt > opts.window[1])) return false;
  return extractImage(post) !== null;
}

// ------------------------------------------------------------ comments

const BOTS = new Set([
  'automoderator',
  '[deleted]',
  'remindmebot',
  'sneakpeekbot',
  'wikisummarizerbot',
  'repostsleuthbot',
]);

export function cleanBody(raw: string): string {
  return raw
    .replace(/\\([*_~^`>#])/g, '$1') // markdown escapes
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\s)\*(\S.*?\S|\S)\*(?=\s|$|[.,!?])/g, '$1$2')
    .replace(/(^|\s)_(\S.*?\S|\S)_(?=\s|$|[.,!?])/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\^\((.+?)\)/g, '$1')
    .replace(/\^(\S+)/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sentenceCount(text: string): number {
  const parts = text
    .replace(/\b(Mr|Mrs|Ms|Dr|St|vs|etc|e\.g|i\.e)\./gi, '$1')
    .replace(/\.{2,}/g, '…')
    .split(/(?<=[.!?])\s+(?=\S)/)
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
  return Math.max(1, parts.length);
}

export function commentCandidate(c: RawComment): Candidate | null {
  if (!c.isTopLevel || c.stickied || c.removed) return null;
  if (c.distinguishedBy === 'moderator' || c.distinguishedBy === 'admin') return null;
  if (!c.authorName || BOTS.has(c.authorName.toLowerCase()) || /bot$/i.test(c.authorName)) return null;
  const raw = c.body.trim();
  if (!raw || raw === '[deleted]' || raw === '[removed]') return null;
  if (/\n/.test(raw)) return null; // multi-paragraph
  if (/https?:\/\/|www\.|\]\(|!\[|^>|>!|!</i.test(raw)) return null; // links, images, quotes, spoilers
  if (/\bedit\s*\d*\s*:/i.test(raw)) return null; // "Edit: thanks for the gold"
  if (/\b(u|r)\/\w+/i.test(raw)) return null; // mentions
  const body = cleanBody(raw);
  if (body.length < 2 || !/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(body)) return null;
  const sentences = sentenceCount(body);
  let tier: 1 | 2 | null = null;
  if (sentences === 1 && body.length <= CONFIG.shortMaxChars) tier = 1;
  else if (sentences <= 2 && body.length <= CONFIG.mediumMaxChars) tier = 2;
  if (!tier) return null;
  return { id: c.id, author: c.authorName, body, score: c.score, tier };
}

function greedyPick(pool: Candidate[], n: number): Candidate[] | null {
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  const picked: Candidate[] = [];
  for (const c of sorted) {
    if (c.score < CONFIG.minCommentScore) break;
    const prev = picked[picked.length - 1];
    if (prev) {
      if (c.score > prev.score * CONFIG.maxScoreRatio) continue;
      if (prev.score - c.score < CONFIG.minScoreGap) continue;
      if (c.body.toLowerCase() === prev.body.toLowerCase()) continue;
    }
    picked.push(c);
    if (picked.length === n) return picked;
  }
  return null;
}

/** Prefer a puzzle of pure one-liners; fall back to short two-liners. */
export function pickComments(
  comments: readonly RawComment[],
  n = CONFIG.commentsPerPuzzle
): Candidate[] | null {
  const cands = comments.map(commentCandidate).filter((c): c is Candidate => c !== null);
  return greedyPick(cands.filter((c) => c.tier === 1), n) ?? greedyPick(cands, n);
}

// ------------------------------------------------------------ misc

/** Deterministic shuffle that never leaves the comments in the right order. */
export function seededShuffle<T extends { score: number }>(arr: readonly T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rand = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1e9) / 1e9;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  if (a.every((c, i) => i === 0 || a[i - 1]!.score > c.score)) a.push(a.shift()!);
  return a;
}

const SUBREDDIT_NAME = /^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/;

/** "r/Pics ", "/r/pics", "pics" -> "pics"; null if it can't be a subreddit. */
export function normalizeSubredditName(input: string): string | null {
  const name = input.trim().replace(/^\/?r\//i, '').replace(/\/$/, '');
  return SUBREDDIT_NAME.test(name) ? name : null;
}
