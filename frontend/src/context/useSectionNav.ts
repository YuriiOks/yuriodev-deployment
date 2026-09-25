import { useContext } from 'react';
import { SectionNavContext, type SectionNav } from './section-nav-context';

export const useSectionNav = (): SectionNav => {
  const context = useContext(SectionNavContext);
  if (context === undefined) {
    throw new Error('useSectionNav must be used within a SectionNavProvider');
  }
  return context;
};
