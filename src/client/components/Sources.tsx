import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type {
  SaveSourcesResponse,
  SourceConfig,
  SubredditSearchResponse,
  SubredditSuggestion,
} from '../../shared/api';
import { Close, Search } from '../icons';
import { api, compact } from '../util';
import { Sheet } from './Sheets';

const MAX = 25;

/** Highlights the part of `name` that matches the query. */
function Highlight({ name, query }: { name: string; query: string }) {
  const q = query.trim().replace(/^\/?r\//i, '').toLowerCase();
  const at = q ? name.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>r/{name}</>;
  return (
    <>
      r/{name.slice(0, at)}
      <mark>{name.slice(at, at + q.length)}</mark>
      {name.slice(at + q.length)}
    </>
  );
}

function SubredditSearch({ selected, onAdd, onRemoveLast }: {
  selected: string[];
  onAdd: (name: string) => void;
  onRemoveLast: () => void;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SubredditSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState('');
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // Debounced search; stale responses are ignored.
  useEffect(() => {
    if (!open) return;
    const id = ++seq.current;
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ q: query, exclude: selected.join(',') });
      api<SubredditSearchResponse>(`/subreddits/search?${params}`)
        .then((r) => {
          if (id !== seq.current) return;
          setItems(r.suggestions);
          setSearched(query);
          setActive(0);
        })
        .catch(() => id === seq.current && setItems([]))
        .finally(() => id === seq.current && setLoading(false));
    }, query ? 220 : 0);
    return () => clearTimeout(t);
  }, [query, open, selected]);

  const pick = (s: SubredditSuggestion | undefined) => {
    if (!s) return;
    onAdd(s.name);
    setQuery('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (open && items[active] && query) {
        e.preventDefault();
        pick(items[active]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && !query) {
      onRemoveLast();
    }
  };

  const full = selected.length >= MAX;
  const showList = open && !full && (items.length > 0 || (searched === query && query.length > 1 && !loading));

  return (
    <div className="combo">
      <div className="combo-input">
        <Search />
        <span className="prefix" aria-hidden="true">
          r/
        </span>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && items[active] ? `${listId}-${active}` : undefined}
          aria-label="Search subreddits"
          placeholder={full ? `That's the maximum of ${MAX}` : 'Search subreddits…'}
          disabled={full}
          value={query}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value.replace(/\s/g, ''));
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
        {loading && open && <div className="spinner mini-spin" aria-hidden="true" />}
      </div>
      {showList && (
        <ul className="combo-list" id={listId} role="listbox">
          {items.length === 0 ? (
            <li className="combo-empty" role="presentation">
              No subreddit called r/{query}. Check the spelling, or it may be private or NSFW.
            </li>
          ) : (
            items.map((s, i) => (
              <li
                key={s.name}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'active' : ''}
                onMouseMove={() => i !== active && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
              >
                <span className="sub-icon" aria-hidden="true">
                  r/
                </span>
                <span className="nm">
                  <Highlight name={s.name} query={query} />
                </span>
                {s.subscribers !== undefined && <span className="meta">{compact(s.subscribers)} members</span>}
                {s.source === 'popular' && <span className="tag hot">On r/popular</span>}
                {s.source === 'exact' && <span className="tag">Found</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

type Props = {
  initial: SourceConfig;
  onClose: () => void;
  onSaved: (cfg: SourceConfig) => void;
  onRegenerate: () => Promise<void>;
};

export function SourcesSheet({ initial, onClose, onSaved, onRegenerate }: Props) {
  const [mode, setMode] = useState(initial.mode);
  const [subs, setSubs] = useState<string[]>(initial.subreddits);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [saved, setSaved] = useState<SourceConfig | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const add = (name: string) => {
    setMsg(null);
    setSaved(null);
    setSubs((s) => (s.some((x) => x.toLowerCase() === name.toLowerCase()) || s.length >= MAX ? s : [...s, name]));
  };
  const remove = (name: string) => {
    setSaved(null);
    setSubs((s) => s.filter((x) => x !== name));
  };

  const dirty =
    mode !== initial.mode || (mode === 'custom' && subs.join(',') !== initial.subreddits.join(','));

  const save = async () => {
    if (mode === 'custom' && !subs.length) {
      setMsg({ kind: 'err', text: 'Add at least one subreddit, or switch back to r/popular.' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await api<SaveSourcesResponse>('/sources', { method: 'POST', body: { mode, subreddits: subs } });
      if (!res.ok) {
        setMsg({ kind: 'err', text: res.message });
        if (res.invalid) setSubs((s) => s.filter((x) => !res.invalid?.includes(x)));
        return;
      }
      setSaved(res.sources);
      setSubs(res.sources.subreddits);
      onSaved(res.sources);
      setMsg({ kind: 'ok', text: "Saved. Tomorrow's puzzle will use these." });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    setMsg(null);
    try {
      await onRegenerate();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
      setRegenerating(false);
    }
  };

  return (
    <Sheet title="Puzzle source" onClose={onClose}>
      <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
        Moderators only. Choose where the daily image post comes from.
      </p>
      <div className="choice-list" role="radiogroup" aria-label="Puzzle source">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'popular'}
          className={`choice${mode === 'popular' ? ' on' : ''}`}
          onClick={() => {
            setMode('popular');
            setSaved(null);
          }}
        >
          <span className="radio" />
          <span>
            <b>r/popular (default)</b>
            <span className="d">Yesterday's top image posts from across Reddit.</span>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'custom'}
          className={`choice${mode === 'custom' ? ' on' : ''}`}
          onClick={() => {
            setMode('custom');
            setSaved(null);
          }}
        >
          <span className="radio" />
          <span>
            <b>Specific subreddits</b>
            <span className="d">Rotates through the subreddits you pick, using their top posts of the day.</span>
          </span>
        </button>
      </div>

      {mode === 'custom' && (
        <>
          <div className="picker-label">
            <span>Subreddits</span>
            <span>
              {subs.length} / {MAX}
            </span>
          </div>
          {subs.length > 0 && (
            <div className="chips">
              {subs.map((s) => (
                <span className="chip" key={s}>
                  r/{s}
                  <button type="button" aria-label={`Remove r/${s}`} onClick={() => remove(s)}>
                    <Close />
                  </button>
                </span>
              ))}
            </div>
          )}
          <SubredditSearch selected={subs} onAdd={add} onRemoveLast={() => subs.length && remove(subs[subs.length - 1] ?? '')} />
          <p className="hint">
            Smaller subreddits fall back to their top posts of the week. NSFW and private subreddits can't be used.
          </p>
        </>
      )}

      {msg && <p className={`form-msg ${msg.kind}`}>{msg.text}</p>}

      <div className="sheet-actions">
        {saved ? (
          <>
            <button type="button" className="btn primary block" disabled={regenerating} onClick={regenerate}>
              {regenerating ? 'Finding a new post…' : "Use it for today's puzzle too"}
            </button>
            <p className="hint" style={{ margin: 0, textAlign: 'center' }}>
              Replaces today's post and comments. Anyone who already played today can play again.
            </p>
            <button type="button" className="btn secondary block" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <button type="button" className="btn primary block" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Checking subreddits…' : 'Save'}
          </button>
        )}
      </div>
    </Sheet>
  );
}
