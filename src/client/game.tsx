import './base.css';
import './game.css';

import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { context, navigateTo, showToast } from '@devvit/web/client';
import type { InitResponse, SourceConfig, SubmitResponse } from '../shared/api';
import { Lightbox, PostCard } from './components/Post';
import { Picker } from './components/Picker';
import { ResultCard, RevealList } from './components/Reveal';
import { ArchiveSheet, HelpSheet, ShareSheet, StatsSheet } from './components/Sheets';
import { SourcesSheet } from './components/Sources';
import { Calendar, Chart, Gear, Help } from './icons';
import { api, prettyDate, vibrate } from './util';

type SheetName = 'help' | 'stats' | 'archive' | 'sources' | 'share' | null;

const HELP_SEEN_KEY = 'iknowreddit:seen-help';
const progressKey = (date: string) => `iknowreddit:progress:${date}`;

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable
  }
}

function sourceLabel(s: SourceConfig): string {
  if (s.mode !== 'custom' || !s.subreddits.length) return 'r/popular';
  if (s.subreddits.length <= 3) return s.subreddits.map((x) => `r/${x}`).join(', ');
  return `r/${s.subreddits.slice(0, 2).join(', r/')} and ${s.subreddits.length - 2} more`;
}

export function App() {
  const [data, setData] = useState<InitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guess, setGuessState] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [fromRects, setFromRects] = useState<Map<string, DOMRect> | null>(null);
  const [shareText, setShareText] = useState('');

  const apply = useCallback((d: InitResponse) => {
    setError(null);
    setData(d);
    setFromRects(null);
    // Restore a half-finished ranking.
    const ids = new Set(d.puzzle?.comments.map((c) => c.id) ?? []);
    const saved = d.puzzle && !d.result ? readLocal(progressKey(d.puzzle.date)) : null;
    let parsed: unknown = [];
    try {
      parsed = saved ? JSON.parse(saved) : [];
    } catch {
      // ignore corrupt progress
    }
    setGuessState(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && ids.has(x)) : []);
    if (!readLocal(HELP_SEEN_KEY) && d.puzzle && !d.result) setSheet('help');
  }, []);

  const failed = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const load = useCallback(() => api<InitResponse>('/init').then(apply).catch(failed), [apply]);

  useEffect(() => {
    let alive = true;
    api<InitResponse>('/init')
      .then((d) => alive && apply(d))
      .catch((e: unknown) => alive && failed(e));
    return () => {
      alive = false;
    };
  }, [apply]);

  const setGuess = useCallback(
    (g: string[]) => {
      setGuessState(g);
      if (data?.puzzle) writeLocal(progressKey(data.puzzle.date), JSON.stringify(g));
    },
    [data]
  );

  const closeSheet = useCallback(() => {
    if (sheet === 'help') writeLocal(HELP_SEEN_KEY, '1');
    setSheet(null);
  }, [sheet]);

  const submit = async () => {
    if (!data?.puzzle) return;
    setSubmitting(true);
    // Remember where each card is so they can slide to their real spot.
    const rects = new Map<string, DOMRect>();
    for (const el of document.querySelectorAll<HTMLElement>('.comment[data-id]')) {
      rects.set(el.dataset.id ?? '', el.getBoundingClientRect());
    }
    try {
      const r = await api<SubmitResponse>('/submit', { method: 'POST', body: { guess } });
      vibrate([10, 40, 10]);
      writeLocal(progressKey(data.puzzle.date), null);
      setFromRects(rects);
      setData({ ...data, result: r.result, reveal: r.reveal, stats: r.stats ?? data.stats, community: r.community });
      requestAnimationFrame(() => document.querySelector('.result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Something went wrong, please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const share = async () => {
    if (!data?.puzzle || !data.result) return;
    const sq = { exact: '🟩', close: '🟨', miss: '⬜' } as const;
    const lines = [
      `I Know Reddit #${data.puzzle.number}`,
      `${data.result.marks.map((m) => sq[m]).join('')} ${data.result.points}/100`,
    ];
    if (data.isLatest && data.stats && data.stats.current > 1) lines.push(`🔥 ${data.stats.current} day streak`);
    lines.push(`r/${context.subredditName}`);
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast('Result copied. Paste it in the comments!');
    } catch {
      setShareText(text);
      setSheet('share');
    }
  };

  const regenerate = async () => {
    await api('/regenerate', { method: 'POST' });
    showToast("Today's puzzle has been replaced");
    setSheet(null);
    await load();
  };

  if (error) {
    return (
      <div className="error-box">
        <h2>Couldn't load the puzzle</h2>
        <p>{error}</p>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setError(null);
            setData(null);
            void load();
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="loading">
        <div className="spinner" aria-hidden="true" />
        <p>Loading today's thread…</p>
      </div>
    );
  }

  const p = data.puzzle;
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-left">
            <button type="button" className="icon-btn" aria-label="Past puzzles" onClick={() => setSheet('archive')}>
              <Calendar />
            </button>
          </div>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 4l7 8h-4.2v8H9.2v-8H5z" />
              </svg>
            </span>
            <span className="brand-text">
              I Know <b>Reddit</b>
            </span>
          </div>
          <div className="topbar-right">
            <button type="button" className="icon-btn" aria-label="How to play" onClick={() => setSheet('help')}>
              <Help />
            </button>
            <button type="button" className="icon-btn" aria-label="Statistics" onClick={() => setSheet('stats')}>
              <Chart />
            </button>
          </div>
        </div>
      </header>

      <main className="container">
        {!p ? (
          <div className="error-box">
            <h2>No puzzle yet</h2>
            <p>The first puzzle is posted shortly after midnight UTC.</p>
            {data.isMod && (
              <button type="button" className="btn primary" onClick={() => setSheet('sources')}>
                Choose the puzzle source
              </button>
            )}
          </div>
        ) : (
          <>
            {!data.isLatest && (
              <div className="banner">
                <span>🗂️</span>
                <span>
                  This is an older puzzle, so it won't affect your streak.{' '}
                  {data.latestPostId && (
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        navigateTo(
                          `https://www.reddit.com/r/${context.subredditName}/comments/${(data.latestPostId ?? '').replace(/^t3_/, '')}/`
                        );
                      }}
                    >
                      Go to today's puzzle
                    </a>
                  )}
                </span>
              </div>
            )}
            <div className="meta-row">
              <span className="pill">
                #{p.number} · {prettyDate(p.date)}
              </span>
              <span className="right">
                {data.isMod && (
                  <button type="button" className="pill mod" onClick={() => setSheet('sources')}>
                    <Gear /> Source
                  </button>
                )}
                {data.stats && data.stats.current > 0 && <span className="pill streak">🔥 {data.stats.current}</span>}
              </span>
            </div>

            <PostCard post={p.post} onZoom={setZoom} />

            {data.result && data.reveal ? (
              <>
                <ResultCard
                  result={data.result}
                  stats={data.stats}
                  community={data.community}
                  loggedIn={data.username !== null}
                  isLatest={data.isLatest}
                  nextPuzzleAt={data.nextPuzzleAt}
                  animate={fromRects !== null}
                  onShare={() => void share()}
                  onStats={() => setSheet('stats')}
                />
                <RevealList reveal={data.reveal} result={data.result} permalink={p.post.permalink} from={fromRects} />
              </>
            ) : (
              <Picker
                comments={p.comments}
                guess={guess}
                setGuess={setGuess}
                onSubmit={() => void submit()}
                submitting={submitting}
              />
            )}
          </>
        )}
      </main>

      {sheet === 'help' && <HelpSheet onClose={closeSheet} sourceLabel={sourceLabel(data.sources)} />}
      {sheet === 'stats' && <StatsSheet stats={data.stats} onClose={closeSheet} />}
      {sheet === 'archive' && (
        <ArchiveSheet onClose={closeSheet} subredditName={context.subredditName} currentDate={p?.date ?? null} />
      )}
      {sheet === 'share' && <ShareSheet text={shareText} onClose={closeSheet} />}
      {sheet === 'sources' && (
        <SourcesSheet
          initial={data.sources}
          onClose={closeSheet}
          onSaved={(sources) => setData({ ...data, sources })}
          onRegenerate={regenerate}
        />
      )}
      {zoom && p && <Lightbox src={zoom} alt={p.post.title} onClose={() => setZoom(null)} />}
    </>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
