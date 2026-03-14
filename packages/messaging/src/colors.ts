/**
 * Deterministic avatar color assignment from a userId string.
 * The same userId always maps to the same color, and the palette
 * is distinct enough for presence circles to be visually distinguishable.
 */

const PALETTE = [
  '#E53935', // Red
  '#8E24AA', // Purple
  '#1E88E5', // Blue
  '#00ACC1', // Cyan
  '#43A047', // Green
  '#FB8C00', // Orange
  '#6D4C41', // Brown
  '#039BE5', // Light Blue
  '#F4511E', // Deep Orange
  '#7CB342', // Light Green
  '#00897B', // Teal
  '#3949AB', // Indigo
];

/** Returns a hex colour string that is stable for the given userId. */
export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

/** Returns one or two upper-case initials from a display name. */
export function initialsForName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
