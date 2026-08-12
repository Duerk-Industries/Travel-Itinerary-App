export const buildNarrativeBlogBody = (input: {
  activity?: unknown;
  kind?: unknown;
  noteBody?: unknown;
}): string => {
  const activity = String(input.activity ?? '').trim();
  const note = String(input.noteBody ?? '').trim();
  if (input.kind === 'note') return note || activity;
  if (!activity) return '';

  const fit = note
    .replace(/^why this fits your group:\s*/i, '')
    .replace(/^this stop suits your group because\s*/i, '')
    .replace(/[.。]+$/, '')
    .trim();
  return fit
    ? `${activity} is a stop your group may enjoy because ${fit}.`
    : `${activity} is included as a stop on your day.`;
};
