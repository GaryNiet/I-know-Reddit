// Picks a post and four of its comments for a puzzle. Pure functions over a
// plain data shape (see reddit-source.ts for the Devvit adapter), with no
// imports so the unit tests run with plain Node.

export type RawPost = {
  id: string;
  title: string;
  /** Text the poster wrote with the image, if any. */
  body?: string | undefined;
  /** The post's flair text, if any. */
  flair?: string | undefined;
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
};

export const CONFIG = {
  commentsPerPuzzle: 4,
  minCommentScore: 10,
  /** Each comment must have at most this share of the one above it... */
  maxScoreRatio: 0.9,
  /** ...and at least this many fewer points, so the order is guessable. */
  minScoreGap: 5,
  /** Longest comment allowed, in characters (after cleaning up markdown). */
  maxCommentChars: 150,
  /** Image posts with a longer description need too much context to guess from. */
  maxPostBodyChars: 50,
};

// ------------------------------------------------------------ posts

// The web view can show Reddit-hosted images; other hosts may be blocked.
const IMAGE_URL = /^https:\/\/(i|preview)\.redd\.it\/[^?#]+\.(jpe?g|png|gif|webp)(\?.*)?$/i;

export function extractImage(post: RawPost) {
  // Multi-picture posts are skipped: the comments may be about any of the pictures.
  if (post.gallery.length > 1) return null;
  const first = post.gallery[0];
  if (first) {
    if (!first.valid || !IMAGE_URL.test(first.url)) return null;
    return { url: first.url, width: first.width || undefined, height: first.height || undefined };
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

// ------------------------------------------------------------ text-based images
// Screenshots of tweets, texts and memes make poor puzzles: the comments react
// to the words, not the picture. There's no reliable signal for "this image is
// mostly text", so these are cheap guesses from the subreddit, flair and title.

/** Subreddits that are mostly screenshots or text memes (lowercase). */
export const TEXT_HEAVY_SUBREDDITS = new Set(
  [
    'clevercomebacks', 'murderedbywords', 'facepalm', 'whitepeopletwitter', 'blackpeopletwitter',
    'linkedinlunatics', 'tumblr', 'choosingbeggars', 'insanepeoplefacebook', 'explainthejoke',
    'comics', 'memes', 'me_irl', 'meirl', 'me_irlgbt', '2meirl4meirl', 'dankmemes', 'memesopdidnotlike',
    'antimeme', '196', 'onejoke', 'rareinsults', 'iamverysmart', 'confidentlyincorrect',
    'screenshotsarehilarious', 'texts', 'tinder', 'boneappletea', 'brandnewsentence', 'nottheonion',
    'technicallythetruth', 'suspiciouslyspecific', 'shitamericanssay', 'shitposting', 'greentext',
    'antiwork', 'workreform', 'leopardsatemyface', 'agedlikemilk', 'agedlikewine', 'quityourbullshit',
    'twitter', 'sadcringe', 'cringetopia', 'oldpeoplefacebook', 'boomershumor',
    'terriblefacebookmemes', 'programmerhumor', 'whenthe', 'prequelmemes', 'historymemes', 'adviceanimals',
    'okbuddycinephile', 'curatedtumblr',
  ].map((s) => s.toLowerCase())
);

/** Flairs that mark a screenshot, meme or other text post. */
const TEXT_FLAIR =
  /\b(screenshots?|screen ?caps?|memes?|tweets?|twitter|x post|texts?|texting|chats?|conversations?|comics?|tumblr|quotes?|headlines?|articles?|news|reddit posts?|facebook|linkedin|dms?)\b/i;

/** Titles that point at the words in the image rather than the picture. */
const TEXT_TITLE = new RegExp(
  [
    'tweets?', 'tweeted', 'screenshots?', 'tumblr', 'linkedin', 'facebook post', 'reddit post',
    'this (text|comment|post|thread|reply|message|email|e-mail|letter|note|sign|headline|article|review|caption|exchange|conversation)',
    'texts? (from|with)', '(texted|messaged|dmed) me', 'group ?chat', 'read (this|that|the)', 'the (caption|wording|fine print)',
  ]
    .map((p) => `\\b${p}\\b`)
    .join('|'),
  'i'
);

/**
 * Whether a post is probably a text-based image. The subreddit check can be
 * turned off for subreddits a moderator chose on purpose.
 */
export function looksTextBased(post: RawPost, opts: { checkSubreddit?: boolean } = {}): boolean {
  if ((opts.checkSubreddit ?? true) && TEXT_HEAVY_SUBREDDITS.has(post.subredditName.toLowerCase())) return true;
  if (post.flair && TEXT_FLAIR.test(post.flair)) return true;
  return TEXT_TITLE.test(post.title);
}

export function isEligiblePost(
  post: RawPost,
  opts: {
    usedIds: ReadonlySet<string>;
    minComments: number;
    window?: [number, number];
    /** False for subreddits a moderator picked, so their choice isn't overridden. */
    checkTextSubreddits?: boolean;
  }
): boolean {
  if (post.nsfw || post.spoiler || post.stickied || post.removed || post.quarantined) return false;
  if (looksTextBased(post, { checkSubreddit: opts.checkTextSubreddits ?? true })) return false;
  if (opts.usedIds.has(post.id)) return false;
  if (post.numComments < opts.minComments) return false;
  if (cleanBody(post.body ?? '').length > CONFIG.maxPostBodyChars) return false;
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
  if (body.length > CONFIG.maxCommentChars) return null;
  return { id: c.id, author: c.authorName, body, score: c.score };
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

/** The top comments (up to the character limit) with clearly different scores. */
export function pickComments(
  comments: readonly RawComment[],
  n = CONFIG.commentsPerPuzzle
): Candidate[] | null {
  const cands = comments.map(commentCandidate).filter((c): c is Candidate => c !== null);
  return greedyPick(cands, n);
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
