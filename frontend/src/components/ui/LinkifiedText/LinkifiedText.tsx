import React, { useMemo } from 'react';
import { UGC_REL, linkify, shortUrl, type LinkifyPlatform } from './linkify';
import styles from './LinkifiedText.module.css';

interface LinkifiedTextProps extends React.HTMLAttributes<HTMLParagraphElement> {
  text: string;
  /** Which platform's text this is: @handles link to X profiles only in X text. */
  platform: LinkifyPlatform;
  ref?: React.Ref<HTMLParagraphElement>;
}

/**
 * Post text as React text nodes and links, never as HTML. Line breaks are
 * kept (white-space: pre-wrap) and long URLs wrap anywhere.
 */
const LinkifiedText: React.FC<LinkifiedTextProps> = ({ text, platform, className, ...rest }) => {
  const tokens = useMemo(() => linkify(text, platform), [text, platform]);
  return (
    <p className={className ? `${styles.text} ${className}` : styles.text} {...rest}>
      {tokens.map((token, i) =>
        token.kind === 'text' ? (
          <React.Fragment key={i}>{token.text}</React.Fragment>
        ) : (
          <a key={i} href={token.href} target="_blank" rel={UGC_REL} className={styles.link}>
            {token.kind === 'url' ? shortUrl(token.text) : token.text}
          </a>
        ),
      )}
    </p>
  );
};

export default LinkifiedText;
