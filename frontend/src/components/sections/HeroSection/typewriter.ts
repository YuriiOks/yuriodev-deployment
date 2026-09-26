/** The lines the hero's typewriter cycles through, in order. */
export const HERO_MESSAGES: readonly string[] = [
  "Architecting agentic AI systems (LangGraph, MCP)...",
  "Building production RAG pipelines (95% precision)...",
  "Deploying multi-agent workflows (200% conversion)...",
  "Engineering cloud-native ML platforms (×50 faster)...",
  "Mentoring 1000+ students in AI/ML...",
  "Democratizing AI education through YuriODev..."
];

/**
 * The typewriter box's width, in ch of its monospace font: the longest line
 * plus room for the caret. The box is centred and never changes width, so
 * the text grows from a fixed left edge instead of shifting while it types.
 */
export function typewriterWidth(messages: readonly string[]): string {
  const longest = Math.max(0, ...messages.map((message) => [...message].length));
  return `${longest + 2}ch`;
}

/** Every line once, as plain text, for screen readers (the animation is hidden from them). */
export function messagesForScreenReaders(messages: readonly string[]): string {
  return messages.map((message) => message.replace(/\.{3}$/, '.')).join(' ');
}
