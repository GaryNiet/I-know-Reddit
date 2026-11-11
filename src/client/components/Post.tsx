import { useState } from 'react';
import { navigateTo } from '@devvit/web/client';
import type { PuzzlePost } from '../../shared/api';
import { CommentIcon, Up } from '../icons';
import { compact, full } from '../util';

export function PostCard({ post, onZoom }: { post: PuzzlePost; onZoom: (url: string) => void }) {
  const [failed, setFailed] = useState(false);
  const img = post.image;
  const ratio = img.width && img.height ? `${img.width} / ${img.height}` : undefined;

  return (
    <article className="post">
      <div className="post-head">
        <div className="post-sub">
          <span className="sub-icon" aria-hidden="true">
            r/
          </span>
          <b>r/{post.subreddit}</b>
          <span>· {new Date(post.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        </div>
        <h1 className="post-title">{post.title}</h1>
      </div>
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
      <div className="post-foot">
        <span title={`${full(post.score)} upvotes`}>
          <Up />
          {compact(post.score)}
        </span>
        <span title={`${full(post.numComments)} comments`}>
          <CommentIcon />
          {compact(post.numComments)}
        </span>
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
