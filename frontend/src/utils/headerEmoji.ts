/**
 * Emoji recognized as "header" markers at the start of interactive terminal
 * output lines (e.g. section titles like "🤖 AI & Agentic Engineering:").
 *
 * Some of these are multi-codepoint sequences: a base emoji plus a
 * variation selector (U+FE0F), or a ZWJ (zero-width joiner, U+200D)
 * sequence joining several emoji into one visual glyph. Listing them as
 * whole strings - longest sequence first - lets the `u`-flagged alternation
 * below match each one as a single unit, instead of a plain (non-`u`)
 * character class, which silently splits multi-codepoint emoji into
 * individual UTF-16 code units and matches on fragments of them.
 */
export const HEADER_EMOJI_LIST: readonly string[] = [
  // Multi-codepoint sequences first (longest first).
  '👨‍💻', // man technologist (ZWJ sequence: U+1F468 U+200D U+1F4BB)
  '👨‍🏫', // man teacher (ZWJ sequence: U+1F468 U+200D U+1F3EB)
  '🏗️', // building construction (U+1F3D7 U+FE0F)
  '☁️', // cloud (U+2601 U+FE0F)
  // Single-codepoint emoji.
  '🎓',
  '🤖',
  '💼',
  '📚',
  '💻',
  '📧',
  '🔗',
  '🌐',
  '📍',
  '🚀',
  '📄',
  '🏠',
  '🐍',
  '𝕏', // mathematical double-struck X (U+1D54F), marks the X profile line
];

export const HEADER_EMOJI_REGEX = new RegExp(`^(?:${HEADER_EMOJI_LIST.join('|')})`, 'u');

/** True when `line` starts with one of the recognized header emoji. */
export const isHeaderEmojiLine = (line: string): boolean => HEADER_EMOJI_REGEX.test(line);
