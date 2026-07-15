/**
 * Keep provider failures out of the user-facing itinerary. The deterministic
 * renderer is authoritative whenever an LLM returns an empty response, an
 * internal error, unresolved placeholders, or a provider-specific placeholder.
 */
export const hasSafeItineraryMarkdown = (value: unknown): boolean => {
  const text = String(value ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!/[A-Za-z0-9]/.test(text)) return false;
  if (/\{\{[^}]+\}\}|\bundefined\b|\bnull\b|\b(?:error|exception|stack trace)\s*:/i.test(text)) return false;
  if (/\b(?:getyourguide|provider)\s+(?:unavailable|error|placeholder)\b/i.test(text)) return false;
  return true;
};

export const chooseSafeItineraryMarkdown = (rendered: unknown, deterministicFallback: string): {
  markdown: string;
  fallbackUsed: boolean;
} => {
  if (hasSafeItineraryMarkdown(rendered)) return { markdown: String(rendered).trim(), fallbackUsed: false };
  return { markdown: String(deterministicFallback ?? '').trim(), fallbackUsed: true };
};
