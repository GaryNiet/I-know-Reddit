import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { navigateTo, showLoginPrompt } from '@devvit/web/client';
import type { Community, Mark, Result, RevealedComment, Stats } from '../../shared/api';
import { actualOrder, verdict } from '../../shared/scoring';
import { Chart, External, Replay, Share, Up } from '../icons';
import { full, ordinal, reducedMotion } from '../util';

function CountUp({ to, ms, format = String }: { to: number; ms: number; format?: (n: number) => string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!ms) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(Math.round(to * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <>{format(ms ? v : to)}</>;
}

function Countdown({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = at - now;
  if (ms <= 0) return <div className="countdown">The next puzzle is about to be posted in this community.</div>;
  const s = Math.floor(ms / 1000);
  const p = (x: number) => String(x).padStart(2, '0');
  return (
    <div className="countdown">
      Next puzzle in{' '}
      <b>
        {Math.floor(s / 3600)}:{p(Math.floor(s / 60) % 60)}:{p(s % 60)}
      </b>
    </div>
  );
}

type CardProps = {
  result: Result;
  stats: Stats | null;
  community: Community | null;
  loggedIn: boolean;
  isLatest: boolean;
  nextPuzzleAt: number;
  animate: boolean;
  /** A replay: graded on this device only, never saved or counted. */
  practice: boolean;
  onShare: () => void;
  onStats: () => void;
  onPlayAgain: () => void;
};

export function ResultCard(p: CardProps) {
  const r = p.result;
  return (
    <section className="result" aria-label="Your result">
      {p.practice && <div className="practice-tag">Practice round · not counted</div>}
      <div className="verdict">{verdict(r.points)}</div>
      <div className="points">
        <CountUp to={r.points} ms={p.animate && !reducedMotion() ? 900 : 0} />
        <small> / 100</small>
      </div>
      <div className="squares" aria-label={r.marks.join(', ')}>
        {r.marks.map((m, i) => (
          <i key={i} className={`${m}-bg`} style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
      {p.stats && !p.practice && (
        <div className="result-stats">
          <div>
            <b>🔥 {p.stats.current}</b>
            <span>Streak</span>
          </div>
          <div>
            <b>{p.stats.played ? p.stats.avg : '–'}</b>
            <span>Your average</span>
          </div>
          <div>
            <b>{p.stats.played}</b>
            <span>Played</span>
          </div>
        </div>
      )}
      {!p.practice && (
        <div className="row">
          <button type="button" className="btn primary" onClick={p.onShare}>
            <Share /> Share
          </button>
          <button type="button" className="btn secondary" onClick={p.onStats}>
            <Chart /> Stats
          </button>
        </div>
      )}
      <button type="button" className="btn secondary block play-again" onClick={p.onPlayAgain}>
        <Replay /> Play again
      </button>
      {!p.practice && p.community && p.community.plays > 1 && (
        <div className="community">
          <b>{full(p.community.plays)}</b> players here · average <b>{p.community.avg}</b>
          {p.community.perfect ? (
            <>
              {' '}
              · <b>{full(p.community.perfect)}</b> perfect
            </>
          ) : null}
        </div>
      )}
      {!p.practice && !p.loggedIn && (
        <div className="login-nudge">
          <button type="button" className="link-btn" onClick={() => showLoginPrompt()}>
            Log in
          </button>{' '}
          to keep a streak and save your stats.
        </div>
      )}
      {!p.practice && p.isLatest && <Countdown at={p.nextPuzzleAt} />}
    </section>
  );
}

const TAG: Record<Mark, string> = { exact: '+20 spot on', close: '+10 close', miss: '+0' };

type ListProps = {
  reveal: RevealedComment[];
  result: Result;
  permalink: string;
  /** Where each card was while picking, for the slide-into-place animation. */
  from: Map<string, DOMRect> | null;
};

export function RevealList({ reveal, result, permalink, from }: ListProps) {
  const order = actualOrder(reveal);
  const byId = new Map(reveal.map((c) => [c.id, c]));
  const top = byId.get(order[0] ?? '')?.score ?? 1;
  const listRef = useRef<HTMLUListElement>(null);
  const animate = from !== null && !reducedMotion();
  const [filled, setFilled] = useState(!animate);

  useLayoutEffect(() => {
    if (!animate || !from || !listRef.current) return;
    for (const el of listRef.current.querySelectorAll<HTMLElement>('[data-id]')) {
      const before = from.get(el.dataset.id ?? '');
      if (!before) continue;
      const dy = before.top - el.getBoundingClientRect().top;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
        duration: 650,
        easing: 'cubic-bezier(.2,.8,.2,1)',
        delay: 80,
      });
    }
    const t = setTimeout(() => setFilled(true), 450);
    return () => clearTimeout(t);
  }, [animate, from]);

  return (
    <>
      <div className="prompt">
        <div>
          <h2>How the thread actually ranked</h2>
          <div className="sub">Real upvote counts when the puzzle was made.</div>
        </div>
      </div>
      <ul className="comments" role="list" ref={listRef}>
        {order.map((id, i) => {
          const c = byId.get(id);
          if (!c) return null;
          const mark = result.marks[i] ?? 'miss';
          const pct = Math.max(3, Math.round((c.score / top) * 100));
          const delay = animate ? i * 160 : 0;
          return (
            <li key={id}>
              <div className={`comment revealed ${mark}`} data-id={id}>
                <div className="rev-top">
                  <span className="slot">{i + 1}</span>
                  <span className="c-body">
                    {c.body}
                    <span className="c-author">u/{c.author}</span>
                  </span>
                  <span className="rev-score">
                    <Up />
                    {filled ? <CountUp to={c.score} ms={animate ? 900 : 0} format={full} /> : '0'}
                  </span>
                </div>
                <div className="bar">
                  <span style={{ width: filled ? `${pct}%` : 0, transitionDelay: `${delay}ms` }} />
                </div>
                <div className="rev-foot">
                  <span>You put it {ordinal(result.guess.indexOf(id) + 1)}</span>
                  <span className="tag">{TAG[mark]}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <button type="button" className="source-link link-plain" onClick={() => navigateTo(permalink)}>
          Open the original thread <External />
        </button>
      </div>
    </>
  );
}
