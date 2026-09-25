import React from 'react';
import PostCard from '../../ui/PostCard/PostCard';
import { usePosts } from '../../../hooks/usePosts';
import { PLATFORM_LABELS, PLATFORMS, hasEnoughPosts, platformsOf } from '../../../services/postsApi';
import { formatRelativeTime } from '../../../utils/postText';
import styles from './PostsSection.module.css';

/**
 * "Latest posts": Yurii's recent LinkedIn and X posts, from GET /api/posts.
 *
 * Shown only when the API has the feed switched on and returns at least 3
 * posts. Until then, and whenever it is off, empty, failing or missing, the
 * page renders nothing here but an empty marker element (no height, not a
 * section), so nothing moves and the navigation does not list it. The
 * marker is also where the request starts: when it nears the view.
 */
const PostsSection: React.FC = () => {
  const { feed, now, sentinelRef } = usePosts();

  if (!hasEnoughPosts(feed)) {
    return <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />;
  }

  const present = PLATFORMS.filter((platform) => feed.items.some((item) => platformsOf(item).includes(platform)));
  const synced = feed.status === 'stale' && feed.lastSuccessAt ? formatRelativeTime(feed.lastSuccessAt, now) : '';

  return (
    <section id="posts" className={styles.section} aria-labelledby="posts-title">
      <div className={styles.content}>
        <div className={styles.header}>
          <h2 id="posts-title" className={styles.title}>
            Latest posts
          </h2>
          <p className={styles.subtitle}>
            What I have been writing lately, as published on {present.map((p) => PLATFORM_LABELS[p]).join(' and ')}.
          </p>
          {synced && <p className={styles.synced}>Synced {synced}</p>}
        </div>

        <ul className={styles.grid}>
          {feed.items.map((item) => (
            <li key={item.id} className={styles.cell}>
              <PostCard item={item} now={now} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default PostsSection;
