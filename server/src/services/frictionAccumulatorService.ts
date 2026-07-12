export type FrictionInput = {
  transferMinutes: number;
  transferCount: number;
  baseChange: boolean;
  activityMinutes: number;
  walkingKm: number;
  groupBufferMinutes?: number;
};

export type FrictionResult = { score: number; status: 'normal' | 'lighten' | 'rest-hub'; reasons: string[] };

export const accumulateDayFriction = (input: FrictionInput): FrictionResult => {
  const transferHours = Math.max(0, input.transferMinutes + (input.groupBufferMinutes ?? 0)) / 60;
  const activityHours = Math.max(0, input.activityMinutes) / 60;
  const score = transferHours * 2 + Math.max(0, input.transferCount) * 1.5 + (input.baseChange ? 2 : 0) + Math.max(0, input.walkingKm) * 0.35 + Math.max(0, activityHours - 6) * 0.5;
  const rounded = Math.round(score * 10) / 10;
  const reasons: string[] = [];
  if (transferHours >= 4) reasons.push('four or more transfer hours');
  if (input.baseChange) reasons.push('base change');
  if (input.walkingKm >= 8) reasons.push('high walking distance');
  if (activityHours >= 8) reasons.push('long activity day');
  return { score: rounded, status: rounded >= 10 ? 'rest-hub' : rounded >= 6 ? 'lighten' : 'normal', reasons };
};

