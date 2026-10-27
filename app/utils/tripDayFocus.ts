/** Today as a local YYYY-MM-DD string (a trip day is a calendar date in the traveler's own timezone). */
export const localIsoDate = (now: Date = new Date()): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/**
 * The day the Itinerary should open on: today while the trip is under way, otherwise none (the
 * overview). `dates` are the trip's days in order, as YYYY-MM-DD.
 */
export const dayToOpen = (dates: string[], today: string = localIsoDate()): string | null =>
  dates.includes(today) ? today : null;
