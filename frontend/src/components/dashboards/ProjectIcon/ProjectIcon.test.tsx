import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { PROJECT_ICON_KEYS } from '../../../services/dashboards/projectIcons';
import { isDrawnIcon } from './iconPaths';
import ProjectIcon from './ProjectIcon';
import ProjectTile from '../ProjectTile/ProjectTile';

describe('the icon set', () => {
  it('draws every key a project can pick, plus the bar\'s grid and calendar', () => {
    for (const key of [...PROJECT_ICON_KEYS, 'grid', 'calendar']) expect(isDrawnIcon(key), key).toBe(true);
    expect(isDrawnIcon('nope')).toBe(false);
    expect(isDrawnIcon('toString')).toBe(false);
  });

  it('is hand-drawn on a 24px grid, one 1.75 stroke, round caps and joins, in the text colour, decorative', () => {
    for (const key of PROJECT_ICON_KEYS) {
      const { container, unmount } = render(<ProjectIcon name={key} />);
      const svg = container.querySelector('svg') as SVGElement;
      expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
      expect(svg).toHaveAttribute('stroke', 'currentColor');
      expect(svg).toHaveAttribute('stroke-width', '1.75');
      expect(svg).toHaveAttribute('stroke-linecap', 'round');
      expect(svg).toHaveAttribute('stroke-linejoin', 'round');
      expect(svg).toHaveAttribute('fill', 'none');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg.querySelectorAll('path').length, key).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe('the project tile', () => {
  it('shows the chosen drawing, else the name\'s first letter (an unknown or missing key too)', () => {
    const drawn = render(<ProjectTile name="garden" icon="leaf" />);
    expect(drawn.container.querySelector('svg')).toHaveAttribute('data-icon', 'leaf');
    expect(drawn.container).not.toHaveTextContent('G');
    drawn.unmount();
    for (const icon of [null, undefined, 'unknown-key']) {
      const letter = render(<ProjectTile name="garden" icon={icon} />);
      expect(letter.container.querySelector('svg')).toBeNull();
      expect(letter.container).toHaveTextContent('G');
      letter.unmount();
    }
  });
});
