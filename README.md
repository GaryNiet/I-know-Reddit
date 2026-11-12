# Hiveminded

A daily guessing game built as a [Devvit](https://developers.reddit.com) app, so it's played inside Reddit posts. Each day the app posts a new puzzle in your subreddit. Players see a popular image post plus four of its top-level comments, tap the comments in the order they think they were upvoted, and then see the real scores.

- **Scoring:** +40 for putting the most upvoted comment first, +20 for each other comment in exactly the right spot, +5 if a comment is one spot off. 100 is a perfect game.
- **Streaks and stats** are stored per Reddit account, so they work on any device. Stats include games played, average, best streak, perfect games, the last 7 puzzles and a score distribution.
- **Leaderboard** (🏆 in the top bar): the top 10 players by **all-time points**, plus your own position. Only daily puzzles played on their day count; past puzzles and practice rounds don't. Replacing a day's puzzle takes its scores back off.
- **Community results:** after playing you see how many people played and their average score.
- **Scores stay on the server** until you lock in your answer, so you can't peek at them.
- **Share:** copies an emoji summary (🟩🟨⬜) to paste in the comments.
- **Archive:** past puzzles are still playable from their posts. They don't count toward streaks.
- **Play again:** after playing, load a different post from the same sources as a practice round. Practice rounds are graded on the device and never saved, so they don't affect stats, streaks or community numbers, and the post stays available for a future daily puzzle.

## Choosing where posts come from (moderators)

> **Currently turned off:** the ⚙ Source button is commented out in `src/client/game.tsx`, so puzzles use r/popular (or a list saved before it was turned off). Uncomment those lines to bring it back.

By default each puzzle uses an image post from **yesterday's top posts on r/popular**. Moderators can switch to their own list of subreddits:

1. Open any puzzle post and tap **⚙ Source** (only moderators see it).
2. Pick **Specific subreddits** and search. Suggestions come up as you type. Arrow keys and Enter work, and Backspace removes the last subreddit.
3. **Save.** The change applies from tomorrow's puzzle. Tap **Use it for today's puzzle too** to replace today's puzzle right away.

When using a list, the app rotates through the subreddits day by day, so a big subreddit doesn't win every time. A quiet subreddit with no suitable post that day falls back to its top posts of the week. Up to 25 subreddits are allowed, and NSFW or private subreddits are rejected.

About the autocomplete: Devvit's public API has no subreddit search, so suggestions come from three places:
- a bundled list of well-known subreddits
- subreddits the app has seen on r/popular (these grow over time and are tagged "On r/popular")
- a live check of the exact name you type, so any public subreddit can be added, not just suggested ones

## How a puzzle is picked

1. Fetch the top posts of the day from the source.
2. Keep single-image posts hosted on Reddit (multi-picture galleries are skipped) that aren't NSFW, spoilers, removed, or already used. Posts whose description is over 50 characters are skipped too, since the image needs too much context.
3. For each candidate, load the top-level comments. Drop stickied, mod, bot, deleted, multi-line, link, quote and "Edit:" comments.
4. Pick 4 comments of **up to 150 characters** each (any number of sentences). Each picked comment must have at most 90% of the score of the one above it (and at least 5 fewer points) so the order can be guessed. The minimum is 10 upvotes.
5. If a post doesn't have enough suitable comments, move on to the next one.

The scheduler does this every day at **00:05 UTC** and posts the puzzle. Moderators can also use the subreddit menu:
- **Hiveminded: post today's puzzle** builds and posts today's puzzle if it hasn't been posted yet.
- **Hiveminded: replace today's puzzle** picks a different post for today.

Installing the app posts the first puzzle right away.

## Development

Requires Node 24+ and a Reddit account with Devvit access.

```sh
npm install
npm run login        # devvit login
npm run dev          # devvit playtest: builds, uploads and runs on your test subreddit
npm run test:unit    # Vitest: selection rules, scoring/streaks, autocomplete, API routes
npm run test:types
npm run lint
npm run deploy       # type-check, lint, devvit upload
npm run launch       # deploy + devvit publish (submits for review)
```

```
devvit.json                 app config: entrypoints, Redis, daily scheduler, mod menu, install trigger
src/client/splash.*         lightweight preview shown in the feed
src/client/game.tsx         the game (React), opened in expanded mode
src/client/components/      post card, picker, reveal, stats/archive/help sheets, subreddit picker
src/server/routes/api.ts    /api/init, /api/submit, /api/archive, mod-only search/sources/regenerate
src/server/routes/internal.ts  scheduler, menu and trigger handlers
src/server/core/            puzzle building, selection rules, Redis storage, Reddit adapter
src/shared/                 types and scoring shared by client and server
```

The route tests run against Devvit's official test harness (`@devvit/test`), which provides Redis and post-creation mocks. Only the listing and comment fetches are stubbed, because the harness doesn't implement Devvit's listings mock.

## Not yet verified on Reddit

The following can only be checked with `npm run dev` on a real subreddit:
- **r/popular through Devvit's `getTopPosts`.** If Reddit refuses the `popular` listing, the app falls back to r/all automatically and logs it.
- **Images in the post view.** Only Reddit-hosted images (`i.redd.it`, `preview.redd.it`) are used, because the web view may block other hosts.
- **Scheduler and install trigger timing** in production.
