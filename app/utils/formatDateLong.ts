export const formatDateLong = (value: string): string => {
  if (!value) return '';

  const normalized = value.includes('T') ? value.split('T')[0] : value;
  const [y, m, d] = normalized.split('-').map((part) => Number(part));
  const date = Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d) ? new Date(value) : new Date(y, m - 1, d);

  if (Number.isNaN(date.getTime())) return value;

  // Short weekday, short month, day of month (e.g., "Sun, Nov 16")
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
