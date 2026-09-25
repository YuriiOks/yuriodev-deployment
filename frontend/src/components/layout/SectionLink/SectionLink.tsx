import React from 'react';
import { Link } from 'react-router-dom';
import { useSectionNav } from '../../../context/useSectionNav';
import { pagePath, type AnchorId } from '../../../data/site';

interface SectionLinkProps {
  id: AnchorId;
  className?: string;
  /** Marks the link as the section in view (aria-current="location"). */
  current?: boolean;
  onClick?: () => void;
  'aria-label'?: string;
  children: React.ReactNode;
}

/**
 * A link to a home-page section. On the home page it is a native '#id'
 * anchor, so the URL hash and Back behave like any in-page link; elsewhere
 * it opens the home page at that section.
 */
const SectionLink: React.FC<SectionLinkProps> = ({ id, current = false, children, ...props }) => {
  const { onHome } = useSectionNav();
  const ariaCurrent = current ? 'location' : undefined;
  return onHome ? (
    <a href={`#${id}`} aria-current={ariaCurrent} {...props}>{children}</a>
  ) : (
    <Link to={`${pagePath('portfolio')}#${id}`} aria-current={ariaCurrent} {...props}>{children}</Link>
  );
};

export default SectionLink;
