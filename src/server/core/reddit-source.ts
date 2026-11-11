// Adapts Devvit's Reddit client to the plain shapes used by select.ts.

import { reddit } from '@devvit/web/server';
import type { Post, Comment } from '@devvit/web/server';
import type { RawComment, RawPost } from './select';

const GALLERY_VALID = 1;

export function toRawPost(p: Post): RawPost {
  return {
    id: p.id,
    title: p.title,
    subredditName: p.subredditName,
    authorName: p.authorName,
    score: p.score,
    numComments: p.numberOfComments,
    permalink: p.permalink,
    createdAt: p.createdAt.getTime(),
    url: p.url,
    nsfw: p.nsfw,
    spoiler: p.spoiler,
    stickied: p.stickied,
    removed: p.removed || Boolean(p.removedByCategory),
    quarantined: p.quarantined,
    thumbnail: p.thumbnail ? { width: p.thumbnail.width, height: p.thumbnail.height } : undefined,
    gallery: p.gallery.map((g) => ({
      url: g.url,
      width: g.width,
      height: g.height,
      valid: g.status === GALLERY_VALID,
    })),
  };
}

export function toRawComment(c: Comment, postId: string): RawComment {
  return {
    id: c.id,
    body: c.body,
    score: c.score,
    authorName: c.authorName,
    stickied: c.stickied,
    distinguishedBy: c.distinguishedBy,
    removed: c.removed,
    isTopLevel: c.parentId === postId,
  };
}

export async function fetchTopPosts(
  subredditName: string,
  timeframe: 'day' | 'week',
  limit: number
): Promise<RawPost[]> {
  const posts = await reddit
    .getTopPosts({ subredditName, timeframe, limit, pageSize: Math.min(limit, 100) })
    .all();
  return posts.map(toRawPost);
}

export async function fetchTopLevelComments(postId: string): Promise<RawComment[]> {
  const comments = await reddit
    .getComments({ postId: asT3(postId), sort: 'top', depth: 1, limit: 200, pageSize: 100 })
    .all();
  return comments.map((c) => toRawComment(c, postId));
}

const isT3 = (id: string): id is `t3_${string}` => id.startsWith('t3_');

export function asT3(id: string): `t3_${string}` {
  return isT3(id) ? id : `t3_${id}`;
}
