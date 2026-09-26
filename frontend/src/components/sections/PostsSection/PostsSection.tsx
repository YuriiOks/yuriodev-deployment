import React, { useLayoutEffect, useRef } from 'react';
import Section from '../../layout/Section/Section';
import PostCard from '../../ui/PostCard/PostCard';
import SectionHeader from '../../ui/SectionHeader/SectionHeader';
import { usePosts } from '../../../hooks/usePosts';
import { PLATFORM_LABELS, PLATFORMS, hasEnoughPosts, platformsOf } from '../../../services/postsApi';
import { formatRelativeTime } from '../../../utils/postText';
import { recentJump, scrollToId } from '../../../utils/scroll';
import styles from './PostsSection.module.css';

/** A jump asked for this recently is still on its way (smooth scrolling included). */
export const JUMP_SETTLE_MS = 3000;

/**
 * "Latest posts": Yurii's recent LinkedIn and X posts, from GET /api/posts.
 *
 * Shown only when the API has the feed switched on and returns at least 3
 * posts. Until then, and whenever it is off, empty, failing or missing, the
 * page renders nothing here, so nothing moves and the navigation does not
 * list it.
 *
 * When the section appears after the page has mounted, a jump aimed at it
 * (a /#posts link) or at anything below it (Connect, the terminal) that was
 * asked for moments ago has just been pushed off target by its height, so it
 * is repeated.
 */
const PostsSection: React.FC = () => {
  const { feed, now } = usePosts();
  const shown = hasEnoughPosts(feed);
  const sectionRef = useRef<HTMLElement>(null);
  // Whether the section has been on the page since this component mounted.
  const wasShown = useRef(shown);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!shown || !section || wasShown.current) return;
    wasShown.current = true;
    const target = recentJump(JUMP_SETTLE_MS);
    const element = target ? document.getElementById(target) : null;
    if (!target || !element) return;
    const below = element === section || Boolean(section.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (below) scrollToId(target);
  }, [shown]);

  if (!shown) return null;

  const present = PLATFORMS.filter((platform) => feed.items.some((item) => platformsOf(item).includes(platform)));
  const synced = feed.status === 'stale' && feed.lastSuccessAt ? formatRelativeTime(feed.lastSuccessAt, now) : '';

  return (
    <Section ref={sectionRef} id="posts" className={styles.section} width="full" containerClassName={styles.content}>
      <SectionHeader
        id="posts-title"
        title="Latest posts"
        subtitle={`What I have been writing lately, as published on ${present.map((p) => PLATFORM_LABELS[p]).join(' and ')}.`}
      >
        {synced && <p className={styles.synced}>Synced {synced}</p>}
      </SectionHeader>

      <ul className={styles.grid}>
        {feed.items.map((item) => (
          <li key={item.id} className={styles.cell}>
            <PostCard item={item} now={now} />
          </li>
        ))}
      </ul>
    </Section>
  );
};

export default PostsSection;
