import React, { useEffect, useState, useRef } from 'react';
import styles from './LeftSidebar.module.css';
import { scrollBehavior } from '../../../utils/motion';

interface SectionInfo {
  id: string;
  label: string;
}

// Minimum clear space between the sidebar and the content column, read from
// the sidebar's --sidebar-gap (px or rem) so CSS and this guard agree.
function sidebarGapPx(sidebar: HTMLElement): number {
  const value = getComputedStyle(sidebar).getPropertyValue('--sidebar-gap').trim();
  const amount = parseFloat(value);
  if (Number.isNaN(amount)) return 16;
  if (value.endsWith('rem')) return amount * parseFloat(getComputedStyle(document.documentElement).fontSize);
  return amount;
}

const hasVisibleBox = (style: CSSStyleDeclaration) =>
  (style.borderLeftStyle !== 'none' && parseFloat(style.borderLeftWidth) > 0) ||
  style.backgroundImage !== 'none' ||
  !/^(transparent|rgba\(.*,\s*0\))$/.test(style.backgroundColor);

// Left edge of the content column: the leftmost of the section wrappers and
// cards sized by --content-max-width. A wrapper with no border or background
// counts from its content box (its padding is empty space); a card counts
// from its border. Null when the page has no such element.
function contentColumnLeft(): number | null {
  const columnWidth = getComputedStyle(document.documentElement).getPropertyValue('--content-max-width').trim();
  let left: number | null = null;
  for (const el of document.querySelectorAll<HTMLElement>('main section[id] > *, main section[id] > * > *')) {
    const style = getComputedStyle(el);
    if (style.maxWidth !== columnWidth) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) continue;
    const edge = hasVisibleBox(style)
      ? rect.left
      : rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    left = left === null ? edge : Math.min(left, edge);
  }
  return left;
}

const LeftSidebar: React.FC = () => {
  const [activeSection, setActiveSection] = useState('hero');
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const sidebarRef = useRef<HTMLDivElement>(null);
  // False when the sidebar would overlap the content column (see below).
  // Starts hidden so it cannot flash over the content before the first check.
  const [isVisible, setIsVisible] = useState(false);

  // Dynamically discover all sections on the page
  useEffect(() => {
    const discoverSections = () => {
      const sectionElements = document.querySelectorAll('main section[id]');
      const discoveredSections: SectionInfo[] = [];

      sectionElements.forEach((section) => {
        const id = section.id;
        if (id) {
          // Convert id to readable label (e.g., "hero" -> "Hero", "about" -> "About")
          const label = id.charAt(0).toUpperCase() + id.slice(1);
          discoveredSections.push({ id, label });
        }
      });

      setSections(discoveredSections);
    };

    // Discover sections after a short delay to ensure DOM is ready
    const timer = setTimeout(discoverSections, 100);

    // Re-discover if DOM changes (for dynamic content)
    const observer = new MutationObserver(discoverSections);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  // Overlap guard: hide the sidebar whenever its right edge would come closer
  // than --sidebar-gap to the content column. The sidebar stays laid out while
  // hidden (visibility only), so the measurement is the same either way and
  // the decision cannot flip back and forth.
  const sectionKey = sections.map(({ id }) => id).join(',');
  useEffect(() => {
    const checkOverlap = () => {
      const sidebar = sidebarRef.current;
      if (!sidebar) return;
      const rect = sidebar.getBoundingClientRect();
      // Zero width: the small-screen media query already hides it.
      if (rect.width === 0) return;
      const contentLeft = contentColumnLeft();
      setIsVisible(contentLeft === null || rect.right + sidebarGapPx(sidebar) <= contentLeft);
    };

    // A ResizeObserver reports once right after observe() and again whenever
    // the page or the sidebar (as its links arrive) changes size.
    const resizeObserver = new ResizeObserver(checkOverlap);
    resizeObserver.observe(document.documentElement);
    if (sidebarRef.current) resizeObserver.observe(sidebarRef.current);
    window.addEventListener('resize', checkOverlap);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', checkOverlap);
    };
  }, [sectionKey]);

  // Track active section based on scroll position
  useEffect(() => {
    if (sections.length === 0 || !isVisible) return;

    const sectionElements = sections
      .map(({ id }) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    
    const observerOptions = {
      root: null,
      rootMargin: '-50% 0px -50% 0px', // Trigger when section is in middle of viewport
      threshold: 0
    };

    const observerCallback = (entries: IntersectionObserverEntry[]) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          setActiveSection(entry.target.id);
        }
      });
    };

    const observer = new IntersectionObserver(observerCallback, observerOptions);
    
    sectionElements.forEach(section => observer.observe(section));

    return () => {
      sectionElements.forEach(section => observer.unobserve(section));
    };
  }, [sections, isVisible]);

  const isActive = (sectionId: string) => activeSection === sectionId;

  // Handle click navigation - smooth scroll to section
  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    e.preventDefault();
    const section = document.getElementById(sectionId);
    if (section) {
      section.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
      setActiveSection(sectionId);
    }
  };

  return (
    <div
      ref={sidebarRef}
      className={`${styles.leftSidebarNav} ${isVisible && sections.length > 0 ? '' : styles.overlapHidden}`}
      id="leftSidebarNav"
      role="navigation"
      aria-label="Section navigation"
    >
      {sections.map(({ id, label }) => (
        <a
          key={id}
          href={`#${id}`}
          onClick={(e) => handleNavClick(e, id)}
          className={`${styles.sidebarNavLink} ${isActive(id) ? styles.active : ''}`}
          aria-label={`Go to ${label.toLowerCase()} section`}
        >
          <span className={styles.diamond}></span>
          <span className={styles.linkText}>{label}</span>
        </a>
      ))}
    </div>
  );
};

export default LeftSidebar;
