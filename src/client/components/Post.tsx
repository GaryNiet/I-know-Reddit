import { useState } from 'react';
import { navigateTo } from '@devvit/web/client';
import type { PuzzlePost } from '../../shared/api';

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

export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return (
    <div className="lightbox" role="dialog" aria-label="Image" onClick={onClose}>
      <img src={src} alt={alt} referrerPolicy="no-referrer" />
    </div>
  );
}
