import { describe, expect, it } from 'vitest';
import { HEADER_MARKER_LIST, HEADER_MARKER_REGEX, isHeaderMarkerLine } from './headerMarker';

describe('isHeaderMarkerLine', () => {
  it('matches every marker in the header list when it starts the line', () => {
    for (const marker of HEADER_MARKER_LIST) {
      expect(isHeaderMarkerLine(`${marker} Some header text`)).toBe(true);
    }
  });

  it('does not match plain text', () => {
    expect(isHeaderMarkerLine('Just a regular line of text')).toBe(false);
    expect(isHeaderMarkerLine('')).toBe(false);
    expect(isHeaderMarkerLine('1. A numbered line')).toBe(false);
  });

  it('does not match when the marker is not at the start of the line', () => {
    expect(isHeaderMarkerLine('Contact: » email@example.com')).toBe(false);
  });

  it('matches each marker as a single character, not a fragment of one', () => {
    expect(HEADER_MARKER_REGEX.exec('◆ System Architecture:')?.[0]).toBe('◆');
    expect(HEADER_MARKER_REGEX.exec('▸ Proactive AI Agent')?.[0]).toBe('▸');
    expect(HEADER_MARKER_REGEX.exec('» Email:     me@example.com')?.[0]).toBe('»');
  });
});
