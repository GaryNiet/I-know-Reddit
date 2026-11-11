// I Know Reddit — daily comment-ranking game.
// Plain ES module, no build step. All progress is kept in localStorage.

const STORAGE_KEY = 'iknowreddit:v1';
const POINTS = { exact: 20, close: 10, miss: 0 };
const SITE_URL = location.origin + location.pathname.replace(/index\.html$/, '');

// ------------------------------------------------------------------ storage

const store = loadStore();

function loadStore() {
  const empty = { results: {}, progress: {}, seenHelp: false, demo: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch {
    return empty;
  }
}
function saveStore() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* private mode */ }
}

// ------------------------------------------------------------------ helpers

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // only used with static strings
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICON = {
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l7 8h-4.2v8H9.2v-8H5z"/></svg>',
  upOutline: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l7 8h-4.2v8H9.2v-8H5z"/></svg>',
  comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 14v5h14v-5"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11M12 20V4M19 20v-6"/></svg>',
  external: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>',
};
const svg = (name) => { const t = document.createElement('template'); t.innerHTML = ICON[name]; return t.content.firstChild; };

function compact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(n);
}
const full = (n) => n.toLocaleString();
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

function localISO(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function prettyDate(iso, opts = { month: 'short', day: 'numeric' }) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function vibrate(ms = 8) { try { navigator.vibrate?.(ms); } catch { /* ignore */ } }

// ------------------------------------------------------------------ data

let index = [];          // [{date, number, subreddit}]
let dailyEntry = null;   // puzzle that counts as "today"

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function loadIndex() {
  try {
    const data = await fetchJSON('puzzles/index.json');
    index = (data.puzzles || []).sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    index = [];
  }
  const today = localISO();
  // The newest puzzle whose date has arrived in the player's timezone.
  dailyEntry = [...index].reverse().find((p) => p.date <= today) || index[0] || null;
}

// ------------------------------------------------------------------ scoring

function actualOrder(puzzle) {
  return [...puzzle.comments].sort((a, b) => b.score - a.score).map((c) => c.id);
}

function grade(puzzle, guess) {
  const actual = actualOrder(puzzle);
  const marks = actual.map((id, i) => {
    const d = Math.abs(guess.indexOf(id) - i);
    return d === 0 ? 'exact' : d === 1 ? 'close' : 'miss';
  });
  const points = marks.reduce((s, m) => s + POINTS[m], 0);
  return { marks, points, exact: marks.filter((m) => m === 'exact').length };
}

function verdict(points) {
  if (points === 100) return 'Perfect read of the hive mind';
  if (points >= 80) return 'Certified Redditor';
  if (points >= 60) return 'Seasoned lurker';
  if (points >= 40) return 'Upvote-curious';
  if (points >= 20) return 'Fresh account energy';
  return 'Touch grass? Never.';
}

// ------------------------------------------------------------------ stats

function dailyDates() {
  return index.filter((p) => !dailyEntry || p.date <= dailyEntry.date).map((p) => p.date);
}

function computeStats() {
  const dates = dailyDates();
  const played = Object.entries(store.results).filter(([, r]) => r.daily);
  const scores = played.map(([, r]) => r.points);
  const onTime = (d) => store.results[d]?.daily;

  // Streaks count consecutive published puzzles played on their day,
  // so a day the generator skipped never breaks a streak.
  let best = 0, run = 0;
  for (const d of dates) { run = onTime(d) ? run + 1 : 0; best = Math.max(best, run); }
  let current = 0;
  let i = dates.length - 1;
  if (i >= 0 && !onTime(dates[i])) i--; // today not played yet: streak still alive
  for (; i >= 0 && onTime(dates[i]); i--) current++;

  const dist = Array.from({ length: 11 }, (_, k) => ({ pts: 100 - k * 10, n: 0 }));
  for (const s of scores) dist[(100 - s) / 10].n++;

  return {
    played: scores.length,
    avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    best: scores.length ? Math.max(...scores) : 0,
    perfect: scores.filter((s) => s === 100).length,
    current,
    maxStreak: best,
    dist,
  };
}

// ------------------------------------------------------------------ game state

let puzzle = null;
let mode = 'daily'; // 'daily' | 'archive' | 'demo'
let guess = [];     // comment ids in the player's chosen order

function resultFor(p) {
  return mode === 'demo' ? store.demo : store.results[p.date];
}

function saveProgress() {
  if (mode === 'demo') return;
  store.progress = { [puzzle.date]: guess }; // keep only the current one
  saveStore();
}

// ------------------------------------------------------------------ rendering: post

function renderPost(p) {
  const { post } = p;
  const img = post.image;
  const media = h('button', {
    class: 'post-media',
    type: 'button',
    'aria-label': 'View image full screen',
    style: img?.width && img?.height ? `aspect-ratio:${img.width}/${img.height}` : 'min-height:240px',
    onclick: () => openLightbox(img.url || img.preview),
  });
  if (img) {
    media.append(h('div', { class: 'blur', style: `background-image:url("${(img.preview || img.url).replace(/["\\]/g, encodeURIComponent)}")` }));
    const el = h('img', {
      src: img.preview || img.url,
      alt: post.title,
      referrerpolicy: 'no-referrer',
      decoding: 'async',
    });
    el.addEventListener('error', () => {
      if (img.url && el.src !== img.url) { el.src = img.url; return; }
      el.replaceWith(h('div', { class: 'img-fallback' }, "Couldn't load the image. ",
        h('a', { href: post.permalink, target: '_blank', rel: 'noopener' }, 'See it on Reddit')));
      media.style.aspectRatio = '';
    });
    media.append(el);
    if (img.gallery > 1) media.append(h('span', { class: 'badge' }, `1 / ${img.gallery}`));
  }

  return h('article', { class: 'post' },
    h('div', { class: 'post-head' },
      h('div', { class: 'post-sub' },
        h('span', { class: 'sub-icon', 'aria-hidden': 'true' }, 'r/'),
        h('b', {}, `r/${post.subreddit}`),
        mode === 'demo' ? null : h('span', {}, `· ${prettyDate(p.sourceDate || addDays(p.date, -1))}`)),
      h('h1', { class: 'post-title' }, post.title)),
    media,
    h('div', { class: 'post-foot' },
      h('span', { title: `${full(post.score)} upvotes` }, svg('upOutline'), compact(post.score)),
      h('span', { title: `${full(post.numComments)} comments` }, svg('comment'), compact(post.numComments))),
  );
}

// ------------------------------------------------------------------ rendering: play

function render() {
  app.replaceChildren();
  document.querySelector('.action-bar')?.remove();

  if (mode === 'demo') {
    app.append(h('div', { class: 'banner' }, h('span', {}, '👋'),
      h('span', {}, 'This is a practice puzzle. Real daily puzzles appear here once the generator has run. Practice rounds don\'t count toward your stats.')));
  } else if (mode === 'archive') {
    app.append(h('div', { class: 'banner' }, h('span', {}, '🗂️'),
      h('span', {}, `Playing an older puzzle — it won't affect your streak. `,
        h('a', { href: '#' }, 'Back to today'))));
  }

  const res = resultFor(puzzle);
  const st = computeStats();
  app.append(h('div', { class: 'meta-row' },
    h('span', { class: 'pill' }, mode === 'demo' ? 'Practice' : `#${puzzle.number} · ${prettyDate(puzzle.date)}`),
    mode !== 'demo' && st.current > 0 ? h('span', { class: 'pill streak', title: 'Current streak' }, `🔥 ${st.current}`) : null));

  app.append(renderPost(puzzle));

  if (res) renderReveal(res, false);
  else renderPicker();
}

function promptText() {
  const n = puzzle.comments.length;
  const k = guess.length;
  if (k === 0) return h('span', {}, 'Tap the ', h('em', {}, 'most upvoted'), ' comment');
  if (k >= n) return h('span', {}, 'Happy with that order?');
  return h('span', {}, 'Now the ', h('em', {}, `${ordinal(k + 1)} most`), ' upvoted');
}

function renderPicker() {
  const n = puzzle.comments.length;
  const head = h('div', { class: 'prompt' });
  const list = h('ul', { class: 'comments', role: 'list' });
  const submit = h('button', { class: 'btn primary block', type: 'button', onclick: lockIn }, 'Lock it in');
  const bar = h('div', { class: 'action-bar' }, h('div', { class: 'inner' }, submit));

  const reset = h('button', { class: 'link-btn', type: 'button', onclick: () => { guess = []; saveProgress(); update(); } }, 'Reset');

  const cards = new Map();
  for (const c of puzzle.comments) {
    const slot = h('span', { class: 'slot', 'aria-hidden': 'true' });
    const card = h('button', { class: 'comment', type: 'button', onclick: () => toggle(c.id) },
      slot,
      h('span', { class: 'c-body' }, c.body));
    cards.set(c.id, { card, slot, c });
    list.append(h('li', {}, card));
  }

  function toggle(id) {
    const at = guess.indexOf(id);
    if (at >= 0) guess.splice(at, 1);
    else guess.push(id);
    // Only one left? It can only go last — fill it in for the player.
    if (at < 0 && guess.length === n - 1) {
      const last = puzzle.comments.find((c) => !guess.includes(c.id));
      setTimeout(() => { if (guess.length === n - 1 && !guess.includes(last.id)) { guess.push(last.id); saveProgress(); update(); } }, 220);
    }
    vibrate();
    saveProgress();
    update();
  }

  function update() {
    head.replaceChildren(
      h('div', {},
        h('h2', {}, promptText()),
        h('div', { class: 'sub' }, guess.length ? 'Tap a numbered comment to take it back.' : `Rank all ${n}, from most to least upvotes.`)),
      h('div', { style: 'display:flex;align-items:center;gap:10px' },
        guess.length ? reset : null,
        h('div', { class: 'dots', 'aria-label': `${guess.length} of ${n} ranked` },
          puzzle.comments.map((_, i) => h('i', { class: i < guess.length ? 'on' : '' })))));
    for (const { card, slot, c } of cards.values()) {
      const r = guess.indexOf(c.id);
      card.classList.toggle('ranked', r >= 0);
      slot.textContent = r >= 0 ? String(r + 1) : '';
      card.setAttribute('aria-label', `${c.body}. ${r >= 0 ? `Ranked ${ordinal(r + 1)}.` : 'Not ranked.'}`);
    }
    const ready = guess.length === n;
    submit.disabled = !ready;
    submit.textContent = ready ? 'Lock it in' : `Rank ${n - guess.length} more`;
  }

  app.append(head, list);
  document.body.append(bar);
  update();
}

function lockIn() {
  if (guess.length !== puzzle.comments.length) return;
  const g = grade(puzzle, guess);
  const result = { guess: [...guess], points: g.points, marks: g.marks, at: Date.now(), daily: mode === 'daily' };
  if (mode === 'demo') store.demo = result;
  else store.results[puzzle.date] = result;
  store.progress = {};
  saveStore();
  vibrate([10, 40, 10]);

  // Re-render the page in revealed state, animating from the picked layout.
  const before = new Map([...app.querySelectorAll('.comment')].map((el, i) => [puzzle.comments[i].id, el.getBoundingClientRect()]));
  render();
  animateReveal(before);
}

// ------------------------------------------------------------------ rendering: reveal

function renderReveal(res, animate = false) {
  const order = actualOrder(puzzle);
  const byId = new Map(puzzle.comments.map((c) => [c.id, c]));
  const top = byId.get(order[0]).score;

  app.append(resultCard(res));

  app.append(h('div', { class: 'prompt' },
    h('div', {}, h('h2', {}, 'How the thread actually ranked'),
      h('div', { class: 'sub' }, 'Real upvote counts, about a day after posting.'))));

  const list = h('ul', { class: 'comments', role: 'list' });
  order.forEach((id, i) => {
    const c = byId.get(id);
    const mark = res.marks[i];
    const yours = res.guess.indexOf(id) + 1;
    const pct = Math.max(3, Math.round((c.score / top) * 100));
    const scoreEl = h('span', { class: 'rev-score', 'data-score': c.score }, svg('up'), h('span', { class: 'n' }, animate ? '0' : full(c.score)));
    const card = h('div', { class: `comment revealed ${mark}`, 'data-id': id },
      h('div', { class: 'rev-top' },
        h('span', { class: 'slot' }, String(i + 1)),
        h('span', { class: 'c-body' }, c.body, h('span', { class: 'c-author' }, `u/${c.author}`)),
        scoreEl),
      h('div', { class: 'bar' }, h('span', { 'data-w': pct, style: animate ? '' : `width:${pct}%` })),
      h('div', { class: 'rev-foot' },
        h('span', {}, `You put it ${ordinal(yours)}`),
        h('span', { class: 'tag' }, mark === 'exact' ? '+20 spot on' : mark === 'close' ? '+10 close' : '+0')));
    list.append(h('li', {}, card));
  });
  app.append(list);

  if (mode !== 'demo') app.append(h('div', { style: 'text-align:center;margin-top:16px' },
    h('a', { class: 'source-link', href: puzzle.post.permalink, target: '_blank', rel: 'noopener' }, 'Open the thread on Reddit ', svg('external'))));
}

function resultCard(res) {
  const st = computeStats();
  const isDaily = mode === 'daily' || (mode === 'archive' && res.daily);
  const shareBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => share(res) }, svg('share'), 'Share');
  const statsBtn = h('button', { class: 'btn secondary', type: 'button', onclick: openStats }, svg('chart'), 'Stats');
  const card = h('section', { class: 'result', 'aria-label': 'Your result' },
    h('div', { class: 'verdict' }, verdict(res.points)),
    h('div', { class: 'points' }, h('span', { class: 'pts-n' }, String(res.points)), h('small', {}, ' / 100')),
    h('div', { class: 'squares', 'aria-label': res.marks.join(', ') },
      res.marks.map((m, i) => h('i', { class: `${m}-bg`, style: `animation-delay:${i * 90}ms` }))),
    mode !== 'demo' ? h('div', { class: 'result-stats' },
      h('div', {}, h('b', {}, `🔥 ${st.current}`), h('span', {}, 'Streak')),
      h('div', {}, h('b', {}, st.avg || '–'), h('span', {}, 'Average')),
      h('div', {}, h('b', {}, st.played), h('span', {}, 'Played'))) : null,
    h('div', { class: 'row' }, shareBtn, statsBtn),
    isDaily || mode === 'demo' ? countdown() : null,
  );
  return card;
}

let countdownTimer;
function countdown() {
  const el = h('div', { class: 'countdown' });
  if (!dailyEntry) { el.textContent = 'A new puzzle drops every day.'; return el; }
  const next = addDays(dailyEntry.date, 1);
  const localMidnight = new Date(`${next}T00:00:00`).getTime();
  const published = Date.parse(`${next}T01:00:00Z`); // generator runs shortly after 00:00 UTC
  const at = Math.max(localMidnight, published);
  clearInterval(countdownTimer);
  const tick = () => {
    const ms = at - Date.now();
    if (ms <= 0) {
      el.replaceChildren('New puzzle is ready! ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); location.hash = ''; location.reload(); } }, 'Play it'));
      clearInterval(countdownTimer);
      return;
    }
    const s = Math.floor(ms / 1000);
    const p = (x) => String(x).padStart(2, '0');
    el.replaceChildren('Next puzzle in ', h('b', {}, `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`));
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
  return el;
}

function animateReveal(before) {
  const cards = [...app.querySelectorAll('.comment.revealed')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // FLIP: slide each card from where it was during picking to its real spot.
  for (const card of cards) {
    const from = before.get(card.dataset.id);
    if (!from || reduce) continue;
    const to = card.getBoundingClientRect();
    const dy = from.top - to.top;
    card.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
      { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)', delay: 80 });
  }
  // Bars and counters fill in one by one.
  cards.forEach((card, i) => {
    setTimeout(() => {
      const bar = card.querySelector('.bar > span');
      bar.style.width = `${bar.dataset.w}%`;
      const n = card.querySelector('.rev-score .n');
      const target = Number(card.querySelector('.rev-score').dataset.score);
      countUp(n, target, reduce ? 0 : 900);
    }, reduce ? 0 : 500 + i * 160);
  });
  const pts = app.querySelector('.pts-n');
  if (pts) countUp(pts, Number(pts.textContent), reduce ? 0 : 900, false);
  app.querySelector('.result')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

function countUp(el, target, ms, sep = true) {
  if (!ms) { el.textContent = sep ? full(target) : target; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const v = Math.round(target * (1 - (1 - k) ** 3));
    el.textContent = sep ? full(v) : String(v);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------------ sharing

async function share(res) {
  const st = computeStats();
  const sq = { exact: '🟩', close: '🟨', miss: '⬜' };
  const lines = [
    mode === 'demo' ? 'I Know Reddit (practice)' : `I Know Reddit #${puzzle.number}`,
    `${res.marks.map((m) => sq[m]).join('')} ${res.points}/100`,
  ];
  if (mode === 'daily' && st.current > 1) lines.push(`🔥 ${st.current} day streak`);
  lines.push(SITE_URL);
  const text = lines.join('\n');

  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Result copied to clipboard');
  } catch {
    prompt('Copy your result:', text);
  }
}

// ------------------------------------------------------------------ dialogs

function setupDialogs() {
  for (const dlg of document.querySelectorAll('dialog')) {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });
  }
  $('#btn-help').onclick = () => $('#dlg-help').showModal();
  $('#btn-stats').onclick = openStats;
  $('#btn-archive').onclick = openArchive;
  $('#dlg-help').addEventListener('close', () => { store.seenHelp = true; saveStore(); });

  const lb = $('#lightbox');
  lb.addEventListener('click', () => { lb.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lb.hidden = true; });
}

function openLightbox(src) {
  const lb = $('#lightbox');
  const img = $('img', lb);
  img.referrerPolicy = 'no-referrer';
  img.src = src;
  img.alt = puzzle?.post.title || '';
  lb.hidden = false;
}

function openStats() {
  const st = computeStats();
  const body = $('#stats-body');
  body.replaceChildren();

  body.append(h('div', { class: 'streak-hero' },
    h('div', { class: 'flame', 'aria-hidden': 'true' }, st.current ? '🔥' : '🕯️'),
    h('div', {},
      h('b', {}, `${st.current} day streak`),
      h('span', {}, st.current
        ? (store.results[dailyEntry?.date]?.daily ? 'Come back tomorrow to keep it going.' : "Play today's puzzle to keep it alive!")
        : 'Play today to start a new streak.'))));

  body.append(h('div', { class: 'stat-grid' },
    [['Played', st.played], ['Avg score', st.played ? st.avg : '–'], ['Best streak', st.maxStreak], ['Perfect', st.perfect]]
      .map(([l, v]) => h('div', {}, h('b', {}, v), h('span', {}, l)))));

  // Last 7 published puzzles.
  const dates = dailyDates().slice(-7);
  if (dates.length) {
    body.append(h('h3', {}, 'Recent days'));
    body.append(h('div', { class: 'week' }, dates.map((d) => {
      const r = store.results[d];
      return h('div', {}, new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
        h('i', { class: r?.daily ? 'p' : '', title: r ? `${r.points} points` : 'Not played' }, r ? r.points : '·'));
    })));
  }

  body.append(h('div', { class: 'dist' }, h('h3', {}, 'Score distribution')));
  if (!st.played) {
    body.append(h('p', { class: 'empty' }, 'Play your first daily puzzle to see your stats here.'));
  } else {
    const max = Math.max(...st.dist.map((d) => d.n), 1);
    const todays = store.results[dailyEntry?.date]?.points;
    for (const d of st.dist) {
      body.append(h('div', { class: 'dist-row' },
        h('span', { class: 'lbl' }, d.pts),
        h('div', {}, h('div', { class: `b ${d.pts === todays ? 'hi' : ''}`, style: `width:${Math.max(8, (d.n / max) * 100)}%` }, d.n))));
    }
  }

  body.append(h('div', { class: 'danger-zone' },
    h('button', { class: 'link-btn', type: 'button', onclick: exportImport }, 'Move stats to another device')));

  $('#dlg-stats').showModal();
}

function exportImport() {
  const code = btoa(unescape(encodeURIComponent(JSON.stringify({ results: store.results }))));
  const input = prompt('Copy this code to keep your stats, or paste a code from another device to import it:', code);
  if (!input || input === code) return;
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(input.trim()))));
    if (!data.results || typeof data.results !== 'object') throw new Error();
    store.results = { ...data.results, ...store.results };
    saveStore();
    toast('Stats imported');
    $('#dlg-stats').close();
    render();
  } catch {
    toast("That code didn't work");
  }
}

function openArchive() {
  const body = $('#archive-body');
  body.replaceChildren();
  const list = h('ul', { class: 'archive-list' });
  const entries = index.filter((p) => !dailyEntry || p.date <= dailyEntry.date).reverse();
  if (!entries.length) body.append(h('p', { class: 'empty' }, 'No past puzzles yet. Check back tomorrow!'));
  for (const p of entries) {
    const r = store.results[p.date];
    const isToday = p.date === dailyEntry?.date;
    list.append(h('li', {}, h('a', {
      href: isToday ? '#' : `#${p.date}`,
      class: puzzle?.date === p.date && mode !== 'demo' ? 'current' : '',
      onclick: () => $('#dlg-archive').close(),
    },
    h('span', { class: 'num' }, `#${p.number}`),
    h('span', { class: 'info' },
      h('b', {}, isToday ? 'Today' : prettyDate(p.date, { weekday: 'short', month: 'short', day: 'numeric' })),
      h('span', {}, `r/${p.subreddit}`)),
    r ? h('span', { class: 'res' }, `${r.points}`) : h('span', { class: 'play' }, 'Play →'))));
  }
  body.append(list);
  $('#dlg-archive').showModal();
}

// ------------------------------------------------------------------ routing / boot

async function route() {
  clearInterval(countdownTimer);
  const wanted = decodeURIComponent(location.hash.slice(1));
  let entry = dailyEntry;
  if (/^\d{4}-\d{2}-\d{2}$/.test(wanted)) {
    const e = index.find((p) => p.date === wanted && (!dailyEntry || p.date <= dailyEntry.date));
    if (e) entry = e;
  }

  try {
    if (entry) {
      puzzle = await fetchJSON(`puzzles/${entry.date}.json`);
      puzzle.number = entry.number;
      mode = entry.date === dailyEntry.date ? 'daily' : 'archive';
    } else {
      puzzle = await fetchJSON('puzzles/demo.json');
      mode = 'demo';
    }
  } catch (err) {
    app.replaceChildren(h('div', { class: 'error-box' },
      h('h2', {}, 'Couldn\'t load the puzzle'),
      h('p', {}, 'Check your connection and try again.'),
      h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Retry')));
    return;
  }

  const saved = mode !== 'demo' && store.progress?.[puzzle.date];
  const ids = new Set(puzzle.comments.map((c) => c.id));
  guess = Array.isArray(saved) ? saved.filter((id) => ids.has(id)) : [];
  render();
  window.scrollTo({ top: 0 });
}

async function boot() {
  setupDialogs();
  await loadIndex();
  window.addEventListener('hashchange', route);
  await route();
  if (!store.seenHelp) $('#dlg-help').showModal();
}

boot();
