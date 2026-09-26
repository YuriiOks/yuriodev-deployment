import React, { useMemo } from 'react';
import { UGC_REL, linkify, shortUrl, type LinkifyPlatform } from './linkify';
import styles from './LinkifiedText.module.css';

interface LinkifiedTextProps extends React.HTMLAttributes<HTMLParagraphElement> {
  text: string;
  /** Which platform's text this is: @handles link to X profiles only in X text. */
  platform: LinkifyPlatform;
  /**
   * False while the text is clipped (a clamped, collapsed post): its links
   * stay out of the Tab order, so focus never lands on a hidden link or
   * scrolls the clipped box. They still work with a pointer.
   */
  linksFocusable?: boolean;
  ref?: React.Ref<HTMLParagraphElement>;
}

/**
 * Post text as React text nodes and links, never as HTML. Line breaks are
 * kept (white-space: pre-wrap) and long URLs wrap anywhere.
 */
const LinkifiedText: React.FC<LinkifiedTextProps> = ({ text, platform, linksFocusable = true, className, ...rest }) => {
  const tokens = useMemo(() => linkify(text, platform), [text, platform]);
  return (
    <p className={className ? `${styles.text} ${className}` : styles.text} {...rest}>
      {tokens.map((token, i) =>
        token.kind === 'text' ? (
          <React.Fragment key={i}>{token.text}</React.Fragment>
        ) : (
          <a
            key={i}
            href={token.href}
            target="_blank"
            rel={UGC_REL}
            className={styles.link}
            tabIndex={linksFocusable ? undefined : -1}
          >
            {token.kind === 'url' ? shortUrl(token.text) : token.text}
          </a>
        ),
      )}
    </p>
  );
};

export default LinkifiedText;
