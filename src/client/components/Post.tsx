import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent, WheelEvent } from 'react';
import { navigateTo } from '@devvit/web/client';
import type { PuzzlePost } from '../../shared/api';
import { Close } from '../icons';

type Props = {
  post: PuzzlePost;
  /** Show the subreddit only once the player has answered, so it can't hint at the ranking. */
  revealed: boolean;
  onZoom: (url: string) => void;
};

export function PostCard({ post, revealed, onZoom }: Props) {
  const [failed, setFailed] = useState(false);
  const img = post.image;
  const ratio = img.width && img.height ? `${img.width} / ${img.height}` : undefined;

  return (
    <article className="post">
      <button
        type="button"
        className="post-media"
        aria-label="View image full screen"
        style={failed ? undefined : ratio ? { aspectRatio: ratio } : { minHeight: 240 }}
        onClick={() => !failed && onZoom(img.url)}
      >
        {failed ? (
          <div className="img-fallback">
            Couldn't load the image.{' '}
            <a
              href={post.permalink}
              onClick={(e) => {
                e.preventDefault();
                navigateTo(post.permalink);
              }}
            >
              See it on Reddit
            </a>
          </div>
        ) : (
          <>
            <div className="blur" style={{ backgroundImage: `url("${encodeURI(img.url)}")` }} />
            <img
              src={img.url}
              alt={post.title}
              referrerPolicy="no-referrer"
              decoding="async"
              onError={() => setFailed(true)}
            />
            {img.gallery && img.gallery > 1 ? <span className="badge">1 / {img.gallery}</span> : null}
          </>
        )}
      </button>
      <div className="post-caption">
        <h1 className="post-title">{post.title}</h1>
        {revealed && <span className="post-sub">r/{post.subreddit}</span>}
      </div>
    </article>
  );
}

const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;

type View = { s: number; x: number; y: number };

/**
 * Full-screen image with its own zoom, since pinch-zoom is off for the page.
 * Pinch or wheel to zoom, drag to move around, double-tap to zoom in or out.
 * A plain tap closes it when not zoomed in.
 */
export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [view, setViewState] = useState<View>({ s: 1, x: 0, y: 0 });
  // Gesture handlers read the latest view without waiting for a re-render.
  const viewRef = useRef(view);
  const setView = (v: View) => {
    viewRef.current = v;
    setViewState(v);
  };
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; mid: { x: number; y: number }; start: View } | null>(null);
  const moved = useRef(false);
  const downAt = useRef({ x: 0, y: 0 });
  const lastTap = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Keeps the image covering the screen it can cover, so it can't be lost off-screen. */
  const clamp = useCallback((v: View): View => {
    const box = boxRef.current?.getBoundingClientRect();
    const img = imgRef.current;
    const s = Math.min(MAX_ZOOM, Math.max(1, v.s));
    if (!box || !img || s === 1) return { s, x: 0, y: 0 };
    const maxX = Math.max(0, (img.offsetWidth * s - box.width) / 2);
    const maxY = Math.max(0, (img.offsetHeight * s - box.height) / 2);
    return { s, x: Math.min(maxX, Math.max(-maxX, v.x)), y: Math.min(maxY, Math.max(-maxY, v.y)) };
  }, []);

  /** Zoom to scale `s` keeping the screen point `p` in place. */
  const zoomAt = useCallback(
    (from: View, s: number, p: { x: number; y: number }): View => {
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return from;
      const cx = p.x - (box.left + box.width / 2);
      const cy = p.y - (box.top + box.height / 2);
      const next = Math.min(MAX_ZOOM, Math.max(1, s));
      const k = next / from.s;
      return clamp({ s: next, x: cx - (cx - from.x) * k, y: cy - (cy - from.y) * k });
    },
    [clamp]
  );

  const pinchInfo = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('.close')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      moved.current = false;
      downAt.current = { x: e.clientX, y: e.clientY };
    } else {
      moved.current = true; // a second finger makes it a gesture, not a tap
    }
    const pinch = pinchInfo();
    gesture.current = pinch ? { ...pinch, start: viewRef.current } : null;
  };

  const onPointerMove = (e: PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, now);
    if (Math.hypot(now.x - downAt.current.x, now.y - downAt.current.y) > 8) moved.current = true;
    const g = gesture.current;
    const pinch = pinchInfo();
    if (g && pinch) {
      // Pinch: scale around the fingers' midpoint, and follow it as it moves.
      const zoomed = zoomAt(g.start, (g.start.s * pinch.dist) / g.dist, g.mid);
      setView(clamp({ ...zoomed, x: zoomed.x + pinch.mid.x - g.mid.x, y: zoomed.y + pinch.mid.y - g.mid.y }));
    } else if (pointers.current.size === 1 && viewRef.current.s > 1) {
      const v = viewRef.current;
      setView(clamp({ ...v, x: v.x + now.x - prev.x, y: v.y + now.y - prev.y }));
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const pinch = pinchInfo();
    gesture.current = pinch ? { ...pinch, start: viewRef.current } : null;
    if (pointers.current.size > 0 || moved.current) return;
    // A tap: double-tap toggles zoom; a single tap closes when not zoomed.
    const t = Date.now();
    if (t - lastTap.current < 300) {
      lastTap.current = 0;
      const v = viewRef.current;
      setView(v.s > 1 ? { s: 1, x: 0, y: 0 } : zoomAt(v, DOUBLE_TAP_ZOOM, { x: e.clientX, y: e.clientY }));
      return;
    }
    lastTap.current = t;
    window.setTimeout(() => {
      if (lastTap.current === t && viewRef.current.s === 1) onClose();
    }, 300);
  };

  const onWheel = (e: WheelEvent) => {
    const v = viewRef.current;
    setView(zoomAt(v, v.s * Math.exp(-e.deltaY * 0.0015), { x: e.clientX, y: e.clientY }));
  };

  return (
    <div
      ref={boxRef}
      className="lightbox"
      role="dialog"
      aria-label="Image. Pinch or double-tap to zoom."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        draggable={false}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
      />
      <button type="button" className="icon-btn close" aria-label="Close" onClick={onClose}>
        <Close />
      </button>
      {view.s === 1 && <div className="lightbox-hint">Pinch or double-tap to zoom</div>}
    </div>
  );
}
