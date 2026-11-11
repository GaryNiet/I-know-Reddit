import { Hono } from 'hono';
import type { TriggerResponse, UiResponse } from '@devvit/web/shared';
import { ensurePuzzlePost, postUrl, regeneratePuzzle, todayUtc } from '../core/puzzle';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ------------------------------------------------------------ scheduler

export const scheduler = new Hono();

scheduler.post('/daily-puzzle', async (c) => {
  try {
    const { postId, created } = await ensurePuzzlePost(todayUtc());
    console.log(created ? `Posted today's puzzle: ${postId}` : `Today's puzzle already posted: ${postId}`);
    return c.json({ status: 'ok' }, 200);
  } catch (err) {
    console.error(`Daily puzzle failed: ${message(err)}`);
    return c.json({ status: 'error', message: message(err) }, 500);
  }
});

// ------------------------------------------------------------ mod menu

export const menu = new Hono();

menu.post('/post-today', async (c) => {
  try {
    const { postId, created } = await ensurePuzzlePost(todayUtc());
    return c.json<UiResponse>({
      showToast: created ? "Today's puzzle is posted" : "Today's puzzle was already posted",
      navigateTo: postUrl(postId),
    });
  } catch (err) {
    return c.json<UiResponse>({ showToast: `Couldn't build a puzzle: ${message(err)}` }, 400);
  }
});

menu.post('/regenerate-today', async (c) => {
  try {
    const p = await regeneratePuzzle(todayUtc());
    return c.json<UiResponse>({
      showToast: `Today's puzzle now uses a post from r/${p.post.subreddit}`,
      ...(p.redditPostId ? { navigateTo: postUrl(p.redditPostId) } : {}),
    });
  } catch (err) {
    return c.json<UiResponse>({ showToast: `Couldn't rebuild the puzzle: ${message(err)}` }, 400);
  }
});

// ------------------------------------------------------------ triggers

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const { postId } = await ensurePuzzlePost(todayUtc());
    return c.json<TriggerResponse>({ status: 'success', message: `Posted the first puzzle: ${postId}` }, 200);
  } catch (err) {
    // Not fatal: the scheduler tries again tonight, and mods can use the menu.
    console.error(`First puzzle failed: ${message(err)}`);
    return c.json<TriggerResponse>({ status: 'error', message: message(err) }, 400);
  }
});
