// Normalize a date-ish string to YYYY-MM-DD if possible.
export const normalizeDateString = (value: string): string => {
  if (!value) return value;
  if (value.includes('-') && value.length === 10) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10);
};
