import './base.css';
import './splash.css';
import { context, requestExpandedMode } from '@devvit/web/client';
import type { InitResponse } from '../shared/api';

const $ = (id: string) => document.getElementById(id);

function setText(id: string, text: string) {
  const el = $(id);
  if (el) el.textContent = text;
}

const postData = context.postData;
if (postData && typeof postData.number === 'number') setText('badge', `#${postData.number}`);

$('play')?.addEventListener('click', (e) => requestExpandedMode(e, 'game'));

async function load() {
  try {
    const res = await fetch('/api/init');
    if (!res.ok) throw new Error(String(res.status));
    const data: InitResponse = await res.json();
    const p = data.puzzle;
    if (!p) {
      setText('question', "Today's puzzle is on its way.");
      return;
    }
    setText('badge', `#${p.number}`);
    const media = $('media');
    if (media) {
      const img = document.createElement('img');
      img.src = p.post.image.url;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.onerror = () => img.remove();
      media.replaceChildren(img);
    }
    if (data.result) {
      setText('question', `You scored ${data.result.points} / 100`);
      setText('play', 'See how the thread ranked');
    } else if (!data.isLatest) {
      setText('play', `Play puzzle #${p.number}`);
    }
    const s = data.stats;
    if (s && s.current > 0) setText('sub', `🔥 ${s.current} day streak${s.playedLatest ? '' : ' · keep it going!'}`);
    else if (data.community) setText('sub', `${data.community.plays.toLocaleString()} players · average ${data.community.avg}`);
  } catch {
    // The button still works; the game screen shows a proper error.
  }
}

void load();
