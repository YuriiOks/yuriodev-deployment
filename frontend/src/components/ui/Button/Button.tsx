import React from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cx } from '../../../utils/cx';
import { isAllowedHref, isExternalHref } from './href';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'ghost' | 'icon';
export type ButtonSize = 'md' | 'sm';

interface ButtonCommon {
  /** primary: filled; ghost: outlined (default); icon: a square around a glyph, named by aria-label. */
  variant?: ButtonVariant;
  /** md: at least 44px high (default); sm: 36px, for dense cards. */
  size?: ButtonSize;
  /** The '> ' before the label (drawn by CSS, silent to screen readers); default true except for icon. */
  prompt?: boolean;
  /** The full width of its container. */
  block?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** An icon button has no text, so it must say what it does. */
type IconRule = { variant: 'icon'; 'aria-label': string } | { variant?: 'primary' | 'ghost' };

type AsButton = ButtonCommon &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonCommon> & {
    href?: undefined;
    to?: undefined;
    /** Busy: disabled, aria-busy, and a static '…' after the label. */
    loading?: boolean;
  };

type AsAnchor = ButtonCommon &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonCommon | 'href'> & {
    href: string;
    to?: undefined;
    /** Not a link (yet): rendered as text in the button's shape; say why in the label. */
    disabled?: boolean;
    loading?: undefined;
  };

type AsRouterLink = ButtonCommon &
  Omit<LinkProps, keyof ButtonCommon | 'to'> & {
    to: LinkProps['to'];
    href?: undefined;
    loading?: undefined;
    disabled?: undefined;
  };

export type ButtonProps = (AsButton | AsAnchor | AsRouterLink) & IconRule;

/** Attributes that mean something only on a link, or only when it can be followed. */
const LINK_ONLY_PROPS = new Set(['target', 'rel', 'download', 'hrefLang', 'ping', 'referrerPolicy', 'type', 'media', 'onClick']);

/**
 * An action or a link that looks like a button. Navigation is a link (href:
 * <a>, to: a router <Link>), an action is a <button type="button">. A link
 * to another site opens in a new tab and says so to screen readers. A href
 * with a scheme other than http, https, mailto or tel renders as plain text.
 */
const Button: React.FC<ButtonProps> = ({
  variant = 'ghost',
  size = 'md',
  prompt = variant !== 'icon',
  block = false,
  className,
  children,
  ...rest
}) => {
  const classes = cx(
    styles.btn,
    styles[variant],
    size === 'sm' && styles.sm,
    prompt && styles.prompt,
    block && styles.block,
    className,
  );

  if (rest.to !== undefined) {
    return (
      <Link {...(rest as Omit<AsRouterLink, keyof ButtonCommon>)} className={classes}>
        {children}
      </Link>
    );
  }

  if (rest.href !== undefined) {
    const { href, disabled, ...anchorProps } = rest as Omit<AsAnchor, keyof ButtonCommon>;
    if (disabled || !isAllowedHref(href)) {
      // Not a link: drop what only a link (or a click) means, keep the rest
      // (aria-label, id, title, data-*), so an icon button keeps its name.
      const spanProps = Object.fromEntries(
        Object.entries(anchorProps).filter(([name]) => !LINK_ONLY_PROPS.has(name)),
      ) as React.HTMLAttributes<HTMLSpanElement>;
      return (
        <span
          {...spanProps}
          className={classes}
          aria-disabled={disabled ? 'true' : undefined}
        >
          {children}
        </span>
      );
    }
    const external = isExternalHref(href);
    return (
      <a
        {...anchorProps}
        href={href}
        className={classes}
        target={external ? (anchorProps.target ?? '_blank') : anchorProps.target}
        rel={external ? 'noopener noreferrer' : anchorProps.rel}
      >
        {children}
        {external && (
          <>
            {' '}
            <span className="sr-only">(opens in new tab)</span>
          </>
        )}
      </a>
    );
  }

  const { loading = false, disabled, type, ...buttonProps } = rest as Omit<AsButton, keyof ButtonCommon>;
  return (
    <button
      {...buttonProps}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {children}
      {loading && <span aria-hidden="true">…</span>}
    </button>
  );
};

export default Button;
