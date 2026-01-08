export type ParsedItineraryDetail = { day: number; activity: string; cost?: number | null };

export const parsePlanToDetails = (plan: string): ParsedItineraryDetail[] => {
  const details: ParsedItineraryDetail[] = [];
  let currentDay: number | null = null;

  for (const raw of plan.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    const dayMatch = line.match(/day\s*(\d+)/i);
    if (dayMatch) {
      currentDay = Number(dayMatch[1]);
      continue;
    }
    if (currentDay == null) continue;

    const activity = line.replace(/^[-*]\s*/, '').trim();
    if (!activity) continue;

    const costMatch = activity.match(/\$([\d.,]+)/);
    const cost = costMatch ? Number(costMatch[1].replace(/,/g, '')) : null;
    details.push({ day: currentDay, activity, cost: Number.isFinite(cost as number) ? (cost as number) : null });
  }

  return details;
};
