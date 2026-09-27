/**
 * The monochrome glyphs recognized as "header" markers at the start of
 * interactive terminal output lines: '◆' for a section header (e.g.
 * "◆ System Architecture:"), '▸' for a list entry, and '»' for a contact
 * line. A real terminal has no colour emoji, so terminalService.ts uses
 * these plain characters instead - one per role, consistently - and this
 * module is what colours a line that starts with one of them.
 */
export const HEADER_MARKER_LIST: readonly string[] = ['◆', '▸', '»'];

export const HEADER_MARKER_REGEX = new RegExp(`^(?:${HEADER_MARKER_LIST.join('|')})`, 'u');

/** True when `line` starts with one of the recognized header markers. */
export const isHeaderMarkerLine = (line: string): boolean => HEADER_MARKER_REGEX.test(line);
