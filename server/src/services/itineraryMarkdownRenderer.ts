import type { ItineraryPromptPlanResult } from './itineraryPromptPlanService';

/**
 * Builds a simplified day-by-day markdown document from a completed
 * itinerary generation result: one subheading per day, listing that day's
 * activities, lodging check-in/out, transfers, and car rental pickup/dropoff
 * — everything the create-trip wizard would otherwise show for that day.
 *
 * Distinct from itineraryPromptPlanService.ts's renderMarkdownFallback,
 * which renders from the raw pre-processed PromptItinerary tuples as a P4
 * render-stage fallback; this renders from the final, post-processed
 * generatedItems instead. Used both by the CLI replay script and by the live
 * generation path (when ENABLE_RAW_AI_CAPTURE is on) for readable output.
 */
export const renderSimplifiedItineraryMarkdown = (result: ItineraryPromptPlanResult, tripName: string): string => {
  const lines: string[] = [];
  lines.push(`# ${tripName}`);
  lines.push('');

  const { activities, lodgings, transfers, carRentals } = result.generatedItems;

  for (const day of result.itinerary.dy) {
    lines.push(`## Day ${day.d} — ${day.dt}`);

    const dayActivities = activities.filter((activity) => activity.date === day.dt);
    for (const activity of dayActivities) {
      const parts = [activity.startTime, activity.duration].filter(Boolean).join(', ');
      lines.push(`- **${activity.name}** (${activity.activityType})${parts ? ` — ${parts}` : ''}`);
      if (activity.notes) lines.push(`  - ${activity.notes}`);
    }

    for (const lodging of lodgings.filter((entry) => entry.checkInDate === day.dt)) {
      lines.push(`- Lodging check-in: **${lodging.name}** (${lodging.address})`);
    }
    for (const lodging of lodgings.filter((entry) => entry.checkOutDate === day.dt)) {
      lines.push(`- Lodging check-out: **${lodging.name}**`);
    }

    for (const transfer of transfers.filter((entry) => entry.departureDate === day.dt || entry.arrivalDate === day.dt)) {
      lines.push(
        `- Transfer: ${transfer.transferType} ${transfer.departureLocation} → ${transfer.arrivalLocation} (${transfer.departureTime}–${transfer.arrivalTime})${transfer.note ? ` — ${transfer.note}` : ''}`
      );
    }

    for (const carRental of carRentals.filter((entry) => entry.pickupDate === day.dt)) {
      lines.push(`- Car rental pickup: ${carRental.vendor} ${carRental.model} @ ${carRental.pickupLocation}`);
    }
    for (const carRental of carRentals.filter((entry) => entry.dropoffDate === day.dt)) {
      lines.push(`- Car rental dropoff: ${carRental.vendor} ${carRental.model} @ ${carRental.dropoffLocation}`);
    }

    lines.push('');
  }

  return lines.join('\n');
};
