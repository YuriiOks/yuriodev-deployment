import { describe, expect, it } from 'vitest';
import { HEADER_EMOJI_LIST, HEADER_EMOJI_REGEX, isHeaderEmojiLine } from './headerEmoji';

describe('isHeaderEmojiLine', () => {
  it('matches every emoji in the header list when it starts the line', () => {
    for (const emoji of HEADER_EMOJI_LIST) {
      expect(isHeaderEmojiLine(`${emoji} Some header text`)).toBe(true);
    }
  });

  it('does not match plain text', () => {
    expect(isHeaderEmojiLine('Just a regular line of text')).toBe(false);
    expect(isHeaderEmojiLine('')).toBe(false);
    expect(isHeaderEmojiLine('1. A numbered line')).toBe(false);
  });

  it('does not match when the emoji is not at the start of the line', () => {
    expect(isHeaderEmojiLine('Contact: 📧 email@example.com')).toBe(false);
  });

  it('matches multi-codepoint sequences as a whole grapheme, not a fragment', () => {
    const manTechnologist = HEADER_EMOJI_REGEX.exec('👨‍💻 Leadership & Education:');
    expect(manTechnologist?.[0]).toBe('👨‍💻');

    const buildingConstruction = HEADER_EMOJI_REGEX.exec('🏗️ System Architecture:');
    expect(buildingConstruction?.[0]).toBe('🏗️');

    const cloud = HEADER_EMOJI_REGEX.exec('☁️ DevOps & Cloud:');
    expect(cloud?.[0]).toBe('☁️');
  });

  it('requires the full ZWJ sequence, not just its leading emoji', () => {
    // The man-technologist sequence (👨 + ZWJ + 💻) is only listed as a
    // whole; the bare 👨 that starts it is not itself a listed emoji, so a
    // line starting with 👨 alone must not match.
    expect(isHeaderEmojiLine('👨 without the rest of the sequence')).toBe(false);
  });
});
