#!/usr/bin/env node
// Builds the daily "I Know Reddit" puzzle.
//
// It looks at r/popular's top posts of the previous day, keeps image posts,
// and picks the first one that has enough short, top-level comments with
// clearly different scores. The result is written to docs/puzzles/<date>.json
// and registered in docs/puzzles/index.json.
//
// Usage:
//   node scripts/generate-puzzle.mjs [--date YYYY-MM-DD] [--force] [--dry-run]
//                                    [--fixtures DIR] [--out DIR]   (for offline testing)
//
// Env (optional, recommended in CI because Reddit often blocks anonymous
// requests from datacenter IPs):
//   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET   app-only OAuth ("script" or "web" app)
//   REDDIT_USER_AGENT                        defaults to a descriptive UA

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PUZZLE_DIR = path.join(ROOT, 'docs', 'puzzles');
let INDEX_FILE = path.join(PUZZLE_DIR, 'index.json');

export const CONFIG = {
  commentsPerPuzzle: 5,
  minCommentScore: 10,
  // Each picked comment must be at most this fraction of the previous one's
  // score (and at least `minScoreGap` lower), so the order is guessable.
  maxScoreRatio: 0.9,
  minScoreGap: 5,
  shortMaxChars: 110,   // "one-liner" tier
  mediumMaxChars: 180,  // fallback tier, up to two sentences
  maxListingPages: 3,
  maxPostsToTry: 25,
};

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const args = { force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') args.date = argv[++i];
    else if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--fixtures') args.fixtures = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

const todayUtc = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------- reddit client

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Reddit {
  constructor({ fixtures } = {}) {
    this.fixtures = fixtures;
    this.ua = process.env.REDDIT_USER_AGENT || 'web:i-know-reddit-daily:v1.0 (daily puzzle generator)';
    this.token = null;
    this.lastRequest = 0;
  }

  async auth() {
    const id = process.env.REDDIT_CLIENT_ID;
    const secret = process.env.REDDIT_CLIENT_SECRET;
    if (!id || !secret || this.fixtures) return;
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.ua,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Reddit OAuth failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    this.token = json.access_token;
    console.log('Authenticated with Reddit OAuth (app-only).');
  }

  async get(pathname, params = {}) {
    if (this.fixtures) return this.fromFixture(pathname, params);
    const qs = new URLSearchParams({ raw_json: '1', ...params });
    const base = this.token ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
    const url = this.token ? `${base}${pathname}?${qs}` : `${base}${pathname}.json?${qs}`;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const wait = this.lastRequest + 1200 - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastRequest = Date.now();
      const headers = { 'User-Agent': this.ua, Accept: 'application/json' };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      try {
        const res = await fetch(url, { headers });
        if (res.ok) return await res.json();
        if (res.status === 429 || res.status >= 500) {
          console.warn(`  ${res.status} on ${pathname}, retrying...`);
          await sleep(2000 * 2 ** attempt);
          continue;
        }
        throw new Error(`GET ${url} -> ${res.status}`);
      } catch (err) {
        if (attempt === 4 || /-> 4\d\d/.test(err.message)) throw err;
        await sleep(2000 * 2 ** attempt);
      }
    }
    throw new Error(`GET ${url} failed`);
  }

  async fromFixture(pathname, params) {
    let file;
    if (pathname.startsWith('/r/')) file = `listing${params.after ? `-${params.after}` : ''}.json`;
    else file = `comments-${pathname.split('/')[2]}.json`;
    const p = path.join(this.fixtures, file);
    if (!existsSync(p)) {
      if (file.startsWith('listing-')) return { data: { children: [], after: null } };
      throw new Error(`Missing fixture ${p}`);
    }
    return JSON.parse(await readFile(p, 'utf8'));
  }
}

// ---------------------------------------------------------------- post selection

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)(\?.*)?$/i;

export function extractImage(post) {
  // Galleries: first item.
  if (post.is_gallery && post.gallery_data?.items?.length && post.media_metadata) {
    const meta = post.media_metadata[post.gallery_data.items[0].media_id];
    if (meta?.status === 'valid' && meta.e === 'Image' && meta.s?.u) {
      const preview = pickResolution(meta.p?.map((r) => ({ url: r.u, width: r.x, height: r.y })) || []);
      return {
        url: meta.s.u,
        preview: preview?.url || meta.s.u,
        width: meta.s.x,
        height: meta.s.y,
        gallery: post.gallery_data.items.length,
      };
    }
    return null;
  }
  const src = post.preview?.images?.[0];
  const directUrl = IMAGE_EXT.test(post.url || '') && /(i\.redd\.it|i\.imgur\.com)/.test(post.url) ? post.url : null;
  const isImage = post.post_hint === 'image' || directUrl;
  if (!isImage) return null;
  const preview = pickResolution(src?.resolutions || []);
  const url = directUrl || src?.source?.url;
  if (!url) return null;
  return {
    url,
    preview: preview?.url || src?.source?.url || url,
    width: src?.source?.width || null,
    height: src?.source?.height || null,
  };
}

function pickResolution(resolutions) {
  if (!resolutions.length) return null;
  const sorted = [...resolutions].sort((a, b) => a.width - b.width);
  return sorted.find((r) => r.width >= 960) || sorted[sorted.length - 1];
}

export function isEligiblePost(post, { usedIds, sourceDate }) {
  if (!post || post.over_18 || post.spoiler || post.stickied || post.is_video) return false;
  if (post.removed_by_category || post.quarantine) return false;
  if (usedIds.has(post.id)) return false;
  if ((post.num_comments || 0) < 30) return false;
  if (sourceDate) {
    // Posts should be from the previous day (allow a little slack either way
    // because "top of the day" is a rolling 24h window).
    const created = post.created_utc * 1000;
    const start = Date.parse(`${sourceDate}T00:00:00Z`) - 6 * 3600e3;
    const end = Date.parse(`${addDays(sourceDate, 1)}T00:00:00Z`) + 1 * 3600e3;
    if (created < start || created > end) return false;
  }
  return Boolean(extractImage(post));
}

// ---------------------------------------------------------------- comment selection

const BOTS = new Set(['automoderator', '[deleted]', 'remindmebot', 'sneakpeekbot', 'wikisummarizerbot', 'repostsleuthbot']);

export function cleanBody(raw) {
  return raw
    .replace(/\\([*_~^`>#])/g, '$1')       // markdown escapes
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\s)\*(\S.*?\S|\S)\*(?=\s|$|[.,!?])/g, '$1$2')
    .replace(/(^|\s)_(\S.*?\S|\S)_(?=\s|$|[.,!?])/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\^\((.+?)\)/g, '$1')
    .replace(/\^(\S+)/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sentenceCount(text) {
  // Count sentence-ending punctuation that is followed by more text.
  const parts = text
    .replace(/\b(Mr|Mrs|Ms|Dr|St|vs|etc|e\.g|i\.e)\./gi, '$1')
    .replace(/\.{2,}/g, '…')
    .split(/(?<=[.!?])\s+(?=\S)/)
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
  return Math.max(1, parts.length);
}

export function commentCandidate(c) {
  if (!c || c.kind !== 't1') return null;
  const d = c.data;
  if (!d || d.stickied || d.score_hidden || d.collapsed) return null;
  if (d.distinguished === 'moderator' || d.distinguished === 'admin') return null;
  if (!d.author || BOTS.has(d.author.toLowerCase()) || /bot$/i.test(d.author)) return null;
  const raw = (d.body || '').trim();
  if (!raw || raw === '[deleted]' || raw === '[removed]') return null;
  if (/\n/.test(raw)) return null;                         // multi-paragraph
  if (/https?:\/\/|www\.|\]\(|!\[|^>|>!|!</i.test(raw)) return null; // links, images, quotes, spoilers
  if (/\bedit\s*\d*\s*:/i.test(raw)) return null;            // "Edit: thanks for the gold"
  if (/\b(u|r)\/\w+/i.test(raw)) return null;               // user/sub mentions read as spoilers
  const body = cleanBody(raw);
  if (body.length < 2 || !/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(body)) return null;
  const sentences = sentenceCount(body);
  let tier = null;
  if (sentences === 1 && body.length <= CONFIG.shortMaxChars) tier = 1;
  else if (sentences <= 2 && body.length <= CONFIG.mediumMaxChars) tier = 2;
  if (!tier) return null;
  return { id: d.id, author: d.author, body, score: d.score, tier };
}

function greedyPick(pool, n) {
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  const picked = [];
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

export function pickComments(children, n = CONFIG.commentsPerPuzzle) {
  const cands = children.map(commentCandidate).filter(Boolean);
  // Prefer a puzzle of pure one-liners; fall back to allowing short two-liners.
  const oneLiners = cands.filter((c) => c.tier === 1);
  return greedyPick(oneLiners, n) || greedyPick(cands, n);
}

// ---------------------------------------------------------------- misc

function seededShuffle(arr, seedStr) {
  let h = 2166136261;
  for (const ch of seedStr) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rand = () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 1e9) / 1e9;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  // Never show the comments already in the correct order.
  if (a.every((c, i) => i === 0 || a[i - 1].score > c.score)) a.push(a.shift());
  return a;
}

async function loadIndex() {
  if (!existsSync(INDEX_FILE)) return { puzzles: [] };
  return JSON.parse(await readFile(INDEX_FILE, 'utf8'));
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.out) {
    PUZZLE_DIR = path.resolve(args.out);
    INDEX_FILE = path.join(PUZZLE_DIR, 'index.json');
  }
  const date = args.date || todayUtc();
  const sourceDate = addDays(date, -1);
  const outFile = path.join(PUZZLE_DIR, `${date}.json`);
  const index = await loadIndex();

  if (existsSync(outFile) && !args.force) {
    console.log(`Puzzle for ${date} already exists, nothing to do (use --force to regenerate).`);
    return;
  }

  const usedIds = new Set();
  for (const entry of index.puzzles) if (entry.date !== date && entry.postId) usedIds.add(entry.postId);

  const reddit = new Reddit({ fixtures: args.fixtures });
  await reddit.auth();

  console.log(`Building puzzle ${date} from r/popular top posts of ${sourceDate}...`);
  const posts = [];
  let after = null;
  for (let page = 0; page < CONFIG.maxListingPages; page++) {
    const params = { t: 'day', limit: '100' };
    if (after) params.after = after;
    const listing = await reddit.get('/r/popular/top', params);
    posts.push(...listing.data.children.map((c) => c.data));
    after = listing.data.after;
    const eligible = posts.filter((p) => isEligiblePost(p, { usedIds, sourceDate }));
    if (!after || eligible.length >= CONFIG.maxPostsToTry) break;
  }

  // If the date window is too strict (e.g. regenerating an old date), relax it.
  let eligible = posts.filter((p) => isEligiblePost(p, { usedIds, sourceDate }));
  if (!eligible.length) eligible = posts.filter((p) => isEligiblePost(p, { usedIds }));
  eligible.sort((a, b) => b.score - a.score);
  console.log(`  ${posts.length} posts fetched, ${eligible.length} eligible image posts.`);

  let puzzle = null;
  for (const post of eligible.slice(0, CONFIG.maxPostsToTry)) {
    const thread = await reddit.get(`/comments/${post.id}`, { sort: 'top', limit: '200', depth: '1' });
    const children = thread?.[1]?.data?.children || [];
    const comments = pickComments(children);
    if (!comments) {
      console.log(`  ✗ r/${post.subreddit} "${post.title.slice(0, 60)}" — not enough short comments`);
      continue;
    }
    console.log(`  ✓ r/${post.subreddit} "${post.title.slice(0, 60)}"`);
    const image = extractImage(post);
    puzzle = {
      number: (index.puzzles.find((p) => p.date === date)?.number) ||
        (index.puzzles.filter((p) => p.date < date).length + 1),
      date,
      sourceDate,
      post: {
        id: post.id,
        title: post.title,
        subreddit: post.subreddit,
        author: post.author,
        score: post.score,
        numComments: post.num_comments,
        permalink: `https://www.reddit.com${post.permalink}`,
        createdUtc: post.created_utc,
        image,
      },
      comments: seededShuffle(
        comments.map(({ id, body, score, author }) => ({ id, body, score, author })),
        date,
      ),
    };
    break;
  }

  if (!puzzle) throw new Error('No suitable post found today.');

  if (args.dryRun) {
    console.log(JSON.stringify(puzzle, null, 2));
    return;
  }

  await mkdir(PUZZLE_DIR, { recursive: true });
  await writeFile(outFile, `${JSON.stringify(puzzle, null, 2)}\n`);
  const entry = {
    date,
    number: puzzle.number,
    subreddit: puzzle.post.subreddit,
    postId: puzzle.post.id,
  };
  index.puzzles = [...index.puzzles.filter((p) => p.date !== date), entry].sort((a, b) => a.date.localeCompare(b.date));
  // Renumber so numbers stay sequential by date.
  index.puzzles.forEach((p, i) => { p.number = i + 1; });
  index.updated = new Date().toISOString();
  await writeFile(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, outFile)} (puzzle #${entry.number}).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
