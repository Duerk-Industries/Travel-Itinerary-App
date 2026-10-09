// Tags stay intentionally small and trip-scoped: they improve recall without becoming a global
// taxonomy or another moderation surface. Both text and media write paths use this normalizer.
export const normalizeBlogTags = (value: unknown): string[] => {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('tags must be an array');
  if (value.length > 12) throw new Error('A blog item can have at most 12 tags');
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') throw new Error('Each tag must be text');
    const tag = candidate.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase();
    if (!seen.has(key)) { seen.add(key); tags.push(tag); }
  }
  return tags;
};
