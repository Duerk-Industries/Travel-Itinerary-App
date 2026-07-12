import type { LogisticsFact } from './arrivalDepartureRulesService';

export const ITINERARY_STRUCTURE_VALIDATOR_VERSION = 'structure-validator-v1';
type Item = [string, string, string];
type Day = { dt: string; it: Item[]; me: string[]; ln: string[] };

export type StructureValidationResult<T> = { itinerary: T; issues: string[]; changed: boolean };
const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const validateAndRepairItineraryStructure = <T extends { dy: Day[] }>(params: {
  itinerary: T;
  logisticsFacts?: LogisticsFact[];
  closedWeekdaysByActivity?: Record<string, number[]>;
}): StructureValidationResult<T> => {
  const output = JSON.parse(JSON.stringify(params.itinerary)) as T;
  const issues: string[] = [];
  for (const day of output.dy) {
    if (JSON.stringify(day.me) !== JSON.stringify(['BQ', 'LC', 'DL'])) {
      day.me = ['BQ', 'LC', 'DL']; issues.push(`${day.dt}: repaired meal codes.`);
    }
    if (day.it.length > 5) { day.it = day.it.slice(0, 5); issues.push(`${day.dt}: capped activities at five.`); }
    const evening = day.it.filter((item) => item[0] === 'E');
    if (evening.length > 2) {
      let retained = 0;
      day.it = day.it.filter((item) => item[0] !== 'E' || ++retained <= 2);
      issues.push(`${day.dt}: capped evening activities at two.`);
    }
    const weekday = new Date(`${day.dt}T12:00:00Z`).getUTCDay();
    day.it = day.it.filter((item) => {
      const closed = params.closedWeekdaysByActivity?.[normalize(item[2])] ?? [];
      if (!closed.includes(weekday)) return true;
      issues.push(`${day.dt}: removed ${item[2]} due to verified closure evidence.`);
      return false;
    });
    const facts = (params.logisticsFacts ?? []).filter((fact) => fact.date === day.dt);
    for (const fact of facts) {
      if (fact.earliestActivityTime && fact.earliestActivityTime >= '10:00' && day.it.some((item) => item[0] === 'M')) {
        day.it = day.it.map((item) => item[0] === 'M' ? ['D', item[1], item[2]] : item);
        issues.push(`${day.dt}: moved morning items after the recovery soft start.`);
      }
      if (day.it.length > fact.maxActivities) {
        day.it = day.it.slice(0, fact.maxActivities);
        issues.push(`${day.dt}: applied ${fact.kind} activity limit.`);
      }
      day.ln = Array.from(new Set([...(day.ln ?? []), fact.note])).slice(0, 2);
    }
    day.ln = (day.ln ?? []).slice(0, 2);
  }
  return { itinerary: output, issues, changed: issues.length > 0 };
};

