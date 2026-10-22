import { INGESTION_CONFIDENCE_REVIEW_READY } from '../config';
import type { PersistedParsedItem } from '../contracts';
import type { ImportReviewSuggestion } from '../../types';
import { ensureUserInTrip } from '../../db';
import { assignParsedItemToTrip, getParsedItemById, listReviewQueueItems } from '../shared/repository';
import { buildMatchingContext } from './matchingContext';
import { reviewItemVersion } from './reviewVersion';
import { bookingDates } from './tripMatcher';

const eligible = (item: PersistedParsedItem, placement: Awaited<ReturnType<Awaited<ReturnType<typeof buildMatchingContext>>['evaluate']>>) =>
  item.itemType !== 'generic_note' && item.status === 'READY_FOR_REVIEW' && !item.duplicateDisposition && item.confidenceScore >= INGESTION_CONFIDENCE_REVIEW_READY
  && placement.candidates.filter(c => c.strong).length === 1 && ['auto','suggest'].includes(placement.decision)
  && (!placement.heldBack || placement.heldBack === 'low_confidence');

export async function listReviewSuggestions(userId: string, after?: string) {
  const queue = await listReviewQueueItems(userId);
  const start = after ? Math.max(0, queue.findIndex(item => item.id === after) + 1) : 0;
  const items = queue.slice(start, start + 20);
  const context = await buildMatchingContext(userId, items);
  const suggestions: ImportReviewSuggestion[] = [];
  for (const item of items) {
    // A human is explicitly reviewing these suggestions; source trust does not turn them into automatic writes.
    const placement = await context.evaluate(item, true, true);
    if (!eligible(item, placement) || !placement.tripId) continue;
    const fields = { ...item.extractedFields, ...item.editedFields };
    const label = String(fields.name || fields.propertyName || item.providerVendor || item.itemType.replace(/_/g, ' ')).slice(0, 160);
    const dates = bookingDates(item), rawAmount = fields.totalCost ?? fields.cost;
    const amount = rawAmount !== undefined && rawAmount !== null && rawAmount !== '' && Number.isFinite(Number(rawAmount)) ? Number(rawAmount) : null;
    suggestions.push({ itemId: item.id, itemType: item.itemType, label, tripId: placement.tripId, tripName: placement.tripName!, reasons: placement.reasons,
      reviewVersion: reviewItemVersion(item), forwarderTrust: placement.forwarderTrust, startDate: dates.start, endDate: dates.end,
      amount, currency: typeof fields.currency === 'string' ? fields.currency.slice(0, 3).toUpperCase() : context.trips.find(t => t.id === placement.tripId)?.currency ?? null });
  }
  return { suggestions, needsIndividualReview: items.length - suggestions.length, remaining: Math.max(0, queue.length - start - items.length), nextAfter: queue.length > start + items.length ? items.at(-1)?.id ?? null : null };
}

export async function confirmReviewSuggestions(userId: string, requests: Array<{ itemId: string; tripId: string; reviewVersion: string }>) {
  const assigned: Array<{ id: string; tripId: string; itemType: string; alreadyAssigned?: boolean }> = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const request of requests) {
    try {
      const item = await getParsedItemById(userId, request.itemId);
      if (!item || !await ensureUserInTrip(request.tripId, userId)) throw new Error('This booking or trip is no longer available.');
      if (item.status === 'ASSIGNED' && item.assignedTripId === request.tripId) { assigned.push({ id: item.id, tripId: request.tripId, itemType: item.itemType, alreadyAssigned: true }); continue; }
      if (reviewItemVersion(item) !== request.reviewVersion) throw new Error('This booking changed. Review it again.');
      // Rebuild after each successful assignment: its new booking continuity can affect the next suggestion.
      const context = await buildMatchingContext(userId, [item]);
      const placement = await context.evaluate(item, true, true);
      if (!eligible(item, placement) || placement.tripId !== request.tripId) throw new Error('The suggested trip changed or needs a choice. Review this booking individually.');
      await assignParsedItemToTrip(userId, item.id, request.tripId, userId, { mode: 'MANUAL', reasons: placement.reasons, expectedItemVersion: request.reviewVersion });
      assigned.push({ id: item.id, tripId: request.tripId, itemType: item.itemType });
    } catch (error) { failed.push({ id: request.itemId, reason: error instanceof Error ? error.message : 'This booking could not be added. Review it individually.' }); }
  }
  return { assigned, failed };
}
