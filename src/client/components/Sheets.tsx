import { useEffect, useState, type ReactNode } from 'react';
import { navigateTo, showLoginPrompt } from '@devvit/web/client';
import type { ArchiveEntry, ArchiveResponse, LeaderboardResponse, Stats } from '../../shared/api';
import { Close } from '../icons';
import { api, prettyDate } from '../util';

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Close />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function HelpSheet({ onClose, sourceLabel }: { onClose: () => void; sourceLabel: string }) {
  return (
    <Sheet title="How to play" onClose={onClose}>
      <div className="help">
        <p className="lede">
          Every day you get one image post that did well on <b>{sourceLabel}</b>, plus four of its top-level
          comments.
        </p>
        <ol className="steps">
          <li>
            <span className="step-n">1</span>
            <div>
              <b>Tap the comments in order</b>, starting with the one you think got the <b>most upvotes</b>.
            </div>
          </li>
          <li>
            <span className="step-n">2</span>
            <div>
              Changed your mind? <b>Tap a ranked comment</b> to take it back out.
            </div>
          </li>
          <li>
            <span className="step-n">3</span>
            <div>
              Hit <b>Lock it in</b> to see the real scores.
            </div>
          </li>
        </ol>
        <h3>Scoring</h3>
        <ul className="legend">
          <li>
            <span className="sq exact" />
            <b>+40</b> the most upvoted comment in first place
          </li>
          <li>
            <span className="sq exact" />
            <b>+20</b> any other comment in exactly the right spot
          </li>
          <li>
            <span className="sq close" />
            <b>+5</b> one spot off
          </li>
          <li>
            <span className="sq miss" />
            <b>0</b> further away
          </li>
        </ul>
        <p>
          That makes <b>100</b> a perfect read of the hive mind. Play each day's puzzle on its day to keep your{' '}
          <b>🔥 streak</b>. Your stats are tied to your Reddit account, so they follow you across devices.
        </p>
        <button type="button" className="btn primary block" onClick={onClose}>
          Let's go
        </button>
      </div>
    </Sheet>
  );
}

export function StatsSheet({ stats, onClose }: { stats: Stats | null; onClose: () => void }) {
  if (!stats) {
    return (
      <Sheet title="Your stats" onClose={onClose}>
        <p className="empty">Log in to Reddit to keep stats and streaks.</p>
      </Sheet>
    );
  }
  const max = Math.max(1, ...stats.dist);
  return (
    <Sheet title="Your stats" onClose={onClose}>
      <div className="streak-hero">
        <div className="flame" aria-hidden="true">
          {stats.current ? '🔥' : '🕯️'}
        </div>
        <div>
          <b>{stats.current} day streak</b>
          <span>
            {stats.current
              ? stats.playedLatest
                ? 'Come back tomorrow to keep it going.'
                : "Play today's puzzle to keep it alive!"
              : 'Play today to start a new streak.'}
          </span>
        </div>
      </div>
      <div className="stat-grid">
        {(
          [
            ['Played', stats.played],
            ['Avg score', stats.played ? stats.avg : '–'],
            ['Best streak', stats.maxStreak],
            ['Perfect', stats.perfect],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <b>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {stats.recent.length > 0 && (
        <>
          <h3>Recent puzzles</h3>
          <div className="week">
            {stats.recent.map((d) => (
              <div key={d.date}>
                {prettyDate(d.date, { weekday: 'short' })}
                <i className={d.points !== null ? 'p' : ''} title={d.points !== null ? `${d.points} points` : 'Not played'}>
                  {d.points ?? '·'}
                </i>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="dist">
        <h3>Score distribution</h3>
      </div>
      {stats.played === 0 ? (
        <p className="empty">Play your first daily puzzle to see your stats here.</p>
      ) : (
        stats.dist.map((n, i) => (
          <div className="dist-row" key={i}>
            <span className="lbl">{100 - i * 10}</span>
            <div>
              <div className="b" style={{ width: `${Math.max(8, (n / max) * 100)}%` }}>
                {n}
              </div>
            </div>
          </div>
        ))
      )}
    </Sheet>
  );
}

export function ArchiveSheet({
  onClose,
  subredditName,
  currentDate,
}: {
  onClose: () => void;
  subredditName: string;
  currentDate: string | null;
}) {
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ArchiveResponse>('/archive')
      .then((r) => setEntries(r.entries))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const open = (e: ArchiveEntry) => {
    if (!e.redditPostId || e.date === currentDate) return onClose();
    navigateTo(`https://www.reddit.com/r/${subredditName}/comments/${e.redditPostId.replace(/^t3_/, '')}/`);
  };

  return (
    <Sheet title="Past puzzles" onClose={onClose}>
      {error && <p className="empty">{error}</p>}
      {!entries && !error && (
        <div className="loading">
          <div className="spinner" />
        </div>
      )}
      {entries && !entries.length && <p className="empty">No past puzzles yet. Check back tomorrow!</p>}
      {entries && entries.length > 0 && (
        <>
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
            Older puzzles don't count toward your streak.
          </p>
          <ul className="archive-list">
            {entries.map((e, i) => (
              <li key={e.date}>
                <button
                  type="button"
                  className={`archive-item${e.date === currentDate ? ' current' : ''}`}
                  onClick={() => open(e)}
                >
                  <span className="info">
                    <b>{i === 0 ? 'Latest' : prettyDate(e.date, { weekday: 'short', month: 'short', day: 'numeric' })}</b>
                    <span>{e.points !== null ? `r/${e.subreddit}` : 'Not played yet'}</span>
                  </span>
                  {e.points !== null ? <span className="res">{e.points}</span> : <span className="play">Play →</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}

export function ShareSheet({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <Sheet title="Share your result" onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        Copy this and paste it in the comments:
      </p>
      <textarea className="share-text" readOnly value={text} onFocus={(e) => e.currentTarget.select()} autoFocus />
    </Sheet>
  );
}

type BoardTab = 'today' | 'allTime';

export function LeaderboardSheet({ onClose, loggedIn }: { onClose: () => void; loggedIn: boolean }) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<BoardTab>('today');
  useEffect(() => {
    api<LeaderboardResponse>('/leaderboard')
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const board = data?.[tab];
  const meShown = board?.entries.some((e) => e.isMe) ?? false;
  const unit = tab === 'today' ? 'pts' : 'total';

  return (
    <Sheet title="Leaderboard" onClose={onClose}>
      <div className="tabs" role="tablist">
        {(
          [
            ['today', 'Today'],
            ['allTime', 'All time'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`tab${tab === key ? ' on' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
        {tab === 'today'
          ? "Scores on today's puzzle."
          : 'Total points from daily puzzles played on their day. Past puzzles and practice rounds don’t count.'}
      </p>
      {error && <p className="empty">{error}</p>}
      {!data && !error && (
        <div className="loading">
          <div className="spinner" />
        </div>
      )}
      {board && (
        <div className="board-me">
          {board.me ? (
            <>
              {meShown ? 'You are' : 'Your position:'} <b>#{board.me.rank.toLocaleString()}</b> of{' '}
              {board.players.toLocaleString()} · <b>{board.me.points.toLocaleString()}</b> {unit}
            </>
          ) : !loggedIn ? (
            <>
              <button type="button" className="link-btn" onClick={() => showLoginPrompt()}>
                Log in
              </button>{' '}
              to get on the leaderboard.
            </>
          ) : tab === 'today' ? (
            "Play today's puzzle to get on the board."
          ) : (
            'Play a daily puzzle on its day to get on the board.'
          )}
        </div>
      )}
      {board && !board.entries.length && (
        <p className="empty">{tab === 'today' ? 'Nobody has played today yet. Be the first!' : 'No scores yet.'}</p>
      )}
      {board && board.entries.length > 0 && (
        <ol className="board">
          {board.entries.map((e) => (
            <li key={`${e.rank}-${e.username}`} className={e.isMe ? 'me' : ''}>
              <span className={`pos p${e.rank}`}>{e.rank}</span>
              <span className="who">u/{e.username}</span>
              <span className="pts">
                {e.points.toLocaleString()} <small>{unit}</small>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}
