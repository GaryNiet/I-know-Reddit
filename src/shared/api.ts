// Types shared by the client (web view) and the server.

export type Mark = 'exact' | 'close' | 'miss';

export type PuzzleImage = {
  url: string;
  width?: number | undefined;
  height?: number | undefined;
  /** Number of images when the source post is a gallery. */
  gallery?: number | undefined;
};

export type PuzzlePost = {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  numComments: number;
  permalink: string;
  createdAt: number;
  image: PuzzleImage;
};

/** A comment as shown before the player has locked in (no score). */
export type HiddenComment = {
  id: string;
  body: string;
};

/** A comment once revealed. */
export type RevealedComment = HiddenComment & {
  author: string;
  score: number;
};

/** What the server stores in Redis. Comments are in display (shuffled) order. */
export type StoredPuzzle = {
  number: number;
  date: string;
  sourceDate: string;
  sources: SourceConfig;
  post: PuzzlePost;
  comments: RevealedComment[];
  redditPostId?: string | undefined;
};

export type Result = {
  guess: string[];
  points: number;
  marks: Mark[];
  at: number;
  /** Played while it was the newest puzzle; only these count for streaks. */
  daily: boolean;
  /** Source post id, so a result from a replaced puzzle isn't reused. */
  puzzleId?: string | undefined;
};

export type Stats = {
  played: number;
  avg: number;
  best: number;
  perfect: number;
  current: number;
  maxStreak: number;
  /** Count of daily games per score: index 0 = 100 points, 10 = 0 points. */
  dist: number[];
  recent: { date: string; points: number | null }[];
  /** True when the newest puzzle has been played on its day. */
  playedLatest: boolean;
};

export type Community = {
  plays: number;
  avg: number;
  perfect: number;
};

export type SourceConfig = {
  mode: 'popular' | 'custom';
  subreddits: string[];
};

export type ArchiveEntry = {
  number: number;
  date: string;
  subreddit: string;
  redditPostId: string | null;
  points: number | null;
};

export type InitResponse = {
  type: 'init';
  username: string | null;
  isMod: boolean;
  isLatest: boolean;
  latestPostId: string | null;
  nextPuzzleAt: number;
  sources: SourceConfig;
  stats: Stats | null;
  puzzle: {
    number: number;
    date: string;
    sourceDate: string;
    post: PuzzlePost;
    comments: HiddenComment[];
  } | null;
  /** Present once the player has played this puzzle. */
  result: Result | null;
  reveal: RevealedComment[] | null;
  community: Community | null;
};

export type SubmitRequest = { guess: string[] };

export type SubmitResponse = {
  type: 'submit';
  result: Result;
  reveal: RevealedComment[];
  stats: Stats | null;
  community: Community | null;
};

export type PracticeRequest = {
  /** Post ids already played in this session, so they aren't picked again. */
  exclude: string[];
};

/** A one-off practice round. Never saved; the client grades it itself. */
export type PracticeResponse = {
  type: 'practice';
  post: PuzzlePost;
  /** In display (shuffled) order, with scores so the client can grade locally. */
  comments: RevealedComment[];
};

export type SubredditSuggestion = {
  name: string;
  subscribers?: number | undefined;
  /** Where the suggestion came from, for display. */
  source: 'exact' | 'popular' | 'list';
};

export type SubredditSearchResponse = {
  query: string;
  suggestions: SubredditSuggestion[];
};

export type SaveSourcesResponse =
  | { ok: true; sources: SourceConfig }
  | { ok: false; message: string; invalid?: string[] };

export type ArchiveResponse = { entries: ArchiveEntry[] };

export type LeaderboardEntry = {
  rank: number;
  username: string;
  points: number;
  isMe: boolean;
};

export type LeaderboardBoard = {
  /** The top players, best first. */
  entries: LeaderboardEntry[];
  /** The viewer's own place, whether or not they're in the top list. */
  me: { rank: number; points: number } | null;
  players: number;
};

export type LeaderboardResponse = {
  type: 'leaderboard';
  /** Date of the puzzle the "today" board is for. */
  date: string | null;
  today: LeaderboardBoard;
  allTime: LeaderboardBoard;
};

export type ErrorResponse = { status: 'error'; message: string };
