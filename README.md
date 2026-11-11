# I Know Reddit

A daily guessing game. Each day you get one image post that made Reddit's **r/popular** the day before, plus five of its top-level comments. Tap them in the order you think they were upvoted, then see the real scores.

- **Scoring:** +20 for each comment in exactly the right spot, +10 if it's one spot off. 100 is a perfect game.
- **Streaks and stats:** play every day to keep your 🔥 streak. Stats include games played, average, best streak, perfect games, the last 7 days and a score distribution. They're saved in the browser (`localStorage`). You can move them to another device with a code from the Stats screen.
- **Share:** copy an emoji summary (🟩🟨⬜) like other daily games.
- **Archive:** you can replay past puzzles. They don't count toward your streak or stats.
- Works well on phones, supports dark mode, and can be added to the home screen.

## How it works

```
docs/                    static site (GitHub Pages serves this folder)
  index.html, app.js, styles.css
  puzzles/index.json     list of published puzzles
  puzzles/YYYY-MM-DD.json one puzzle per day
  puzzles/demo.json      practice puzzle, shown until the first real one exists
scripts/generate-puzzle.mjs   builds a puzzle from Reddit
.github/workflows/daily.yml   runs the generator every day at 00:07 UTC, commits, deploys
```

The generator:

1. Fetches `r/popular/top?t=day`, which is the previous day's posts when it runs just after midnight UTC.
2. Keeps image posts (single images or galleries) that aren't NSFW, spoilers, videos, or posts used before. They're tried from most to least upvoted.
3. For each post, it loads the top-level comments and drops stickied, mod, bot, deleted, multi-line, link, quote and "Edit:" comments.
4. It picks 5 comments, **preferring one-sentence comments of 110 characters or fewer**. If there aren't enough, it allows two sentences up to 180 characters. Each picked comment must score at most 90% of the one above it (and at least 5 points less), so the order can actually be guessed. The minimum is 10 upvotes.
5. If the post doesn't have enough suitable comments, it moves on to the next post.

## Setup

1. Merge to `main`.
2. **Settings → Pages → Source: GitHub Actions.**
3. **Recommended:** Reddit often blocks anonymous API requests from GitHub's servers. Create a Reddit app at <https://www.reddit.com/prefs/apps> (type "script"). Then add `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` under **Settings → Secrets and variables → Actions**. The generator uses app-only OAuth when they're set.
4. Run **Actions → Daily puzzle & deploy → Run workflow** once to publish the first puzzle. After that it runs on its own every day.

## Local development

```sh
npm test                 # unit tests for the selection logic
npm run generate         # build today's puzzle (needs network access to Reddit)
npm run generate -- --date 2026-11-12 --force --dry-run
npm run serve            # http://localhost:8000
```
