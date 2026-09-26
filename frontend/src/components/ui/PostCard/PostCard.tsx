import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Card from '../Card/Card';
import Chip from '../Chip/Chip';
import LinkifiedText from '../LinkifiedText/LinkifiedText';
import {
  PLATFORM_LABELS,
  platformsOf,
  primaryVariant,
  type PostPlatform,
  type PostItem,
} from '../../../services/postsApi';
import type { Tone } from '../../../utils/tagTone';
import { accessibleSummary, formatFullDate, formatRelativeTime } from '../../../utils/postText';
import { scrollBehavior } from '../../../utils/motion';
import styles from './PostCard.module.css';

interface PostCardProps {
  item: PostItem;
  /** Date.now() of the answer the item came in: relative dates count from it. */
  now: number;
}

/** Platform chips: text, not logos. */
const PLATFORM_TONES: Record<PostPlatform, Tone> = { x: 'neutral', linkedin: 'cyan' };

/** Collapsed text is clamped to 6 lines; before it can be measured, this long counts as more. */
function looksLong(text: string): boolean {
  return text.length > 280 || text.split('\n').length > 6;
}

/**
 * One post: Yurii's own text as published, with where and when, and links to
 * the originals. Not a copy of an X or LinkedIn embed: no logos, avatars or
 * action icons. The text shown is the LinkedIn version when there is one,
 * otherwise the X thread; the card links to every version.
 */
const PostCard: React.FC<PostCardProps> = ({ item, now }) => {
  const titleId = useId();
  const bodyId = useId();
  const articleRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  // Set by "Show less" until the collapse has been laid out.
  const collapsing = useRef(false);
  const [expanded, setExpanded] = useState(false);
  // Whether the clamped first part hides lines; null until the browser has
  // measured it.
  const [overflowing, setOverflowing] = useState<boolean | null>(null);

  const platforms = platformsOf(item);
  const { platform, variant } = primaryVariant(item);
  const parts = variant.parts;
  const thread = parts.length > 1;
  const shown = expanded ? parts : parts.slice(0, 1);
  // The clamp hides part of the (collapsed) first part.
  const clipped = !expanded && (overflowing ?? looksLong(parts[0]));
  const canExpand = thread || expanded || clipped;
  const xThread = item.variants.x && item.variants.x.parts.length > 1 ? item.variants.x.parts.length : 0;

  useEffect(() => {
    const element = textRef.current;
    if (expanded || !element || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      setOverflowing(element.scrollHeight > element.clientHeight + 1);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded]);

  // After "Show less", a reader who was deep in a long thread would be left
  // below the card: bring its top back into view (scroll-padding-top keeps it
  // clear of the fixed header). Focus stays on the button.
  useLayoutEffect(() => {
    const article = articleRef.current;
    if (expanded || !collapsing.current || !article) return;
    collapsing.current = false;
    const headerClearance = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    if (article.getBoundingClientRect().top < headerClearance) {
      article.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    }
  }, [expanded]);

  const toggle = () => {
    collapsing.current = expanded;
    setExpanded(!expanded);
  };

  const where = platforms.map((p) => PLATFORM_LABELS[p]).join(' and ');
  const when = formatFullDate(item.publishedAt);

  return (
    <Card as="article" ref={articleRef} padding="sm" labelledBy={titleId} className={styles.card}>
      <h3 id={titleId} className="sr-only">
        {`Post on ${where}, ${when}: ${accessibleSummary(parts[0])}`}
      </h3>

      <div className={styles.meta}>
        <ul className={styles.platforms} aria-label="Published on">
          {platforms.map((p) => (
            <Chip as="li" key={p} tone={PLATFORM_TONES[p]} data-platform={p}>
              {PLATFORM_LABELS[p]}
              {p === 'x' && xThread > 0 && <span className={styles.threadCount}> · thread of {xThread}</span>}
            </Chip>
          ))}
        </ul>
        <time className={styles.time} dateTime={item.publishedAt} title={when}>
          {formatRelativeTime(item.publishedAt, now)}
        </time>
      </div>

      <div id={bodyId} className={styles.body}>
        {shown.map((part, i) => (
          <LinkifiedText
            key={i}
            ref={i === 0 ? textRef : undefined}
            text={part}
            platform={platform}
            linksFocusable={!clipped}
            className={expanded ? styles.part : `${styles.part} ${styles.clamped}`}
          />
        ))}
        {expanded && variant.truncated && (
          <p className={styles.note}>The rest is on {PLATFORM_LABELS[platform]}.</p>
        )}
      </div>

      {canExpand && (
        <button
          type="button"
          className={styles.expand}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={toggle}
        >
          {expanded ? 'Show less' : thread ? `Show full thread (${parts.length})` : 'Show more'}
        </button>
      )}

      {item.hasMedia && <p className={styles.note}>Includes images or video: see the original.</p>}

      <ul className={styles.links} aria-label="Originals">
        {platforms.map((p) => (
          <li key={p}>
            <a className={styles.permalink} href={item.variants[p]!.url} target="_blank" rel="noopener noreferrer">
              {`View on ${PLATFORM_LABELS[p]} `}
              <span aria-hidden="true">↗</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
};

export default PostCard;
