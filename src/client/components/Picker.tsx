import { useEffect, useRef } from 'react';
import type { HiddenComment } from '../../shared/api';
import { ordinal, vibrate } from '../util';

type Props = {
  comments: HiddenComment[];
  guess: string[];
  setGuess: (g: string[]) => void;
  onSubmit: () => void;
  submitting: boolean;
};

export function Picker({ comments, guess, setGuess, onSubmit, submitting }: Props) {
  const n = comments.length;
  const k = guess.length;
  const autoFill = useRef<number | undefined>(undefined);

  // Only one left? It can only go last, so fill it in.
  useEffect(() => {
    window.clearTimeout(autoFill.current);
    if (k === n - 1) {
      const last = comments.find((c) => !guess.includes(c.id));
      if (last) autoFill.current = window.setTimeout(() => setGuess([...guess, last.id]), 220);
    }
    return () => window.clearTimeout(autoFill.current);
  }, [k, n, comments, guess, setGuess]);

  const toggle = (id: string) => {
    vibrate();
    setGuess(guess.includes(id) ? guess.filter((g) => g !== id) : [...guess, id]);
  };

  const ready = k === n;
  return (
    <>
      <div className="prompt">
        <div>
          <h2>
            {k === 0 ? (
              <>
                Tap the <em>most upvoted</em> comment
              </>
            ) : ready ? (
              'Happy with that order?'
            ) : (
              <>
                Now the <em>{ordinal(k + 1)} most</em> upvoted
              </>
            )}
          </h2>
          <div className="sub">
            {k ? 'Tap a numbered comment to take it back.' : `Rank all ${n}, from most to least upvotes.`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {k > 0 && (
            <button type="button" className="link-btn" onClick={() => setGuess([])}>
              Reset
            </button>
          )}
          <div className="dots" aria-label={`${k} of ${n} ranked`}>
            {comments.map((c, i) => (
              <i key={c.id} className={i < k ? 'on' : ''} />
            ))}
          </div>
        </div>
      </div>

      <ul className="comments" role="list">
        {comments.map((c) => {
          const r = guess.indexOf(c.id);
          return (
            <li key={c.id}>
              <button
                type="button"
                data-id={c.id}
                className={`comment${r >= 0 ? ' ranked' : ''}`}
                aria-label={`${c.body}. ${r >= 0 ? `Ranked ${ordinal(r + 1)}.` : 'Not ranked.'}`}
                onClick={() => toggle(c.id)}
              >
                <span className="slot" aria-hidden="true">
                  {r >= 0 ? r + 1 : ''}
                </span>
                <span className="c-body">{c.body}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="action-bar">
        <div className="inner">
          <button type="button" className="btn primary block" disabled={!ready || submitting} onClick={onSubmit}>
            {submitting ? 'Checking…' : ready ? 'Lock it in' : `Rank ${n - k} more`}
          </button>
        </div>
      </div>
    </>
  );
}
