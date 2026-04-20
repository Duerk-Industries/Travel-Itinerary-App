export const normalizeTimeInput = (value: string | null | undefined, fallback = ''): string => {
  const text = String(value ?? '').trim();
  if (!text) return fallback;

  const twentyFourHour = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (twentyFourHour) {
    const hours = Number(twentyFourHour[1]);
    const minutes = Number(twentyFourHour[2]);
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }

  const meridiem = text.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (meridiem) {
    const rawHours = Number(meridiem[1]);
    const minutes = Number(meridiem[2]);
    if (!(rawHours >= 1 && rawHours <= 12) || !(minutes >= 0 && minutes < 60)) {
      return fallback;
    }
    const suffix = meridiem[3].toUpperCase();
    const hours = suffix === 'PM'
      ? (rawHours % 12) + 12
      : rawHours % 12;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  return fallback;
};
