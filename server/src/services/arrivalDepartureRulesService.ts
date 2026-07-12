export type TravelEndpointFact = { date: string; localTime?: string | null; isLongHaul?: boolean; durationHours?: number | null };
export type LogisticsFact = { date: string; kind: 'arrival' | 'recovery' | 'departure'; maxActivities: number; earliestActivityTime?: string; latestActivityTime?: string; note: string };

const minutesToClock = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const clockToMinutes = (clock?: string | null): number | null => {
  if (!clock || !/^\d{2}:\d{2}$/.test(clock)) return null;
  const [hours, minutes] = clock.split(':').map(Number);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
};
const addDays = (iso: string, days: number): string => { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };

export const buildArrivalDepartureFacts = (params: { arrival?: TravelEndpointFact | null; departure?: TravelEndpointFact | null; departureBufferMinutes?: number }): LogisticsFact[] => {
  const facts: LogisticsFact[] = [];
  if (params.arrival) {
    const arrivalMinutes = clockToMinutes(params.arrival.localTime);
    const heavy = Boolean(params.arrival.isLongHaul || (params.arrival.durationHours ?? 0) >= 7 || (arrivalMinutes ?? 0) >= 17 * 60);
    facts.push({
      date: params.arrival.date, kind: 'arrival', maxActivities: heavy ? 1 : 2,
      ...(arrivalMinutes == null ? {} : { earliestActivityTime: minutesToClock(Math.min(23 * 60 + 59, arrivalMinutes + 150)) }),
      note: heavy ? 'Heavy arrival day: allow immigration, baggage, transfer, check-in, and recovery time.' : 'Arrival day: keep plans flexible after check-in.',
    });
    if (heavy) facts.push({ date: addDays(params.arrival.date, 1), kind: 'recovery', maxActivities: 3, earliestActivityTime: '10:00', note: 'Post-arrival recovery: use a soft start and keep the morning flexible.' });
  }
  if (params.departure) {
    const departureMinutes = clockToMinutes(params.departure.localTime);
    const buffer = Math.max(90, Math.round(params.departureBufferMinutes ?? 180));
    facts.push({
      date: params.departure.date, kind: 'departure', maxActivities: departureMinutes != null && departureMinutes < 12 * 60 ? 0 : 1,
      ...(departureMinutes == null ? {} : { latestActivityTime: minutesToClock(Math.max(0, departureMinutes - buffer)) }),
      note: `Departure day: protect at least ${buffer} minutes for checkout, terminal travel, and processing.`,
    });
  }
  return facts.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
};

export const renderLogisticsFactBlock = (facts: LogisticsFact[]): string => facts.length
  ? facts.map((fact) => `${fact.date} ${fact.kind}: max ${fact.maxActivities} activities${fact.earliestActivityTime ? `, not before ${fact.earliestActivityTime}` : ''}${fact.latestActivityTime ? `, finish by ${fact.latestActivityTime}` : ''}. ${fact.note}`).join('\n')
  : 'none';

