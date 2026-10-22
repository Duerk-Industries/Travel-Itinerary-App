import { logError, logInfo } from '../../logger';
import { isFeatureEnabled } from '../../services/entitlementService';
import { notify } from '../../services/notificationService';
import type { PersistedParsedItem } from '../contracts';
import { AUTO_UNDO_WINDOW_MS, assignParsedItemToTrip, getAutoAssignPreference } from '../shared/repository';
import { buildMatchingContext } from './matchingContext';

/** Master switch for writing matched bookings into trips. Fail-closed: off until deliberately turned on. */
export const AUTO_ASSIGN_FLAG = 'planning_auto_assign';

/**
 * Whether automatic adding applies to this person: the release switch is on AND they have not turned it off.
 * Someone who never chose gets the default, which is on, so nobody has to find a setting.
 */
export const automaticAddingEnabledFor = async (userId: string): Promise<boolean> => {
  if (!(await isFeatureEnabled(AUTO_ASSIGN_FLAG, userId))) return false;
  return (await getAutoAssignPreference(userId)) ?? true;
};

export { resolveTripPlaces } from './matchingContext';
export const decideTripForItem = async (item: PersistedParsedItem, userId: string, automaticAddingOn: boolean) =>
  (await buildMatchingContext(userId, [item])).evaluate(item, automaticAddingOn);

export type AutoAssignResult = { itemId: string; tripId: string; tripName: string | null; reasons: string[] };

/**
 * Runs after extraction. Adds each qualifying booking to its trip and tells the person, with Undo.
 * Never throws and never blocks the import: anything that goes wrong leaves the item in the review queue
 * exactly as it would have been without this feature.
 */
export const applyAutomaticAssignments = async (params: { userId: string; items: PersistedParsedItem[] }): Promise<AutoAssignResult[]> => {
  const added: AutoAssignResult[] = [];
  let on = false;
  try {
    on = await automaticAddingEnabledFor(params.userId);
  } catch (error) {
    logError('[ingestion][auto-assign] could not read the setting; leaving items for review', error);
    return added;
  }
  if (!on) return added;

  let context: Awaited<ReturnType<typeof buildMatchingContext>>;
  try { context = await buildMatchingContext(params.userId, params.items); }
  catch (error) { logError('[ingestion][auto-assign] matching unavailable; leaving items for review', error); return added; }
  for (const item of params.items) {
    if (item.status !== 'READY_FOR_REVIEW') continue;
    try {
      const decision = await context.evaluate(item, true);
      if (decision.decision !== 'auto' || !decision.tripId) continue;
      await assignParsedItemToTrip(params.userId, item.id, decision.tripId, params.userId, {
        mode: 'AUTO',
        undoWindowMs: AUTO_UNDO_WINDOW_MS,
        reasons: decision.reasons,
      });
      added.push({ itemId: item.id, tripId: decision.tripId, tripName: decision.tripName, reasons: decision.reasons });
      logInfo(`[ingestion][auto-assign] added item=${item.id} trip=${decision.tripId}`);
      await notify({
        userIds: [params.userId],
        category: 'import_result',
        tripId: decision.tripId,
        actorUserId: params.userId,
        title: `Added to ${decision.tripName ?? 'your trip'}`,
        body: 'A booking you imported was added automatically. You can take it back for 7 days.',
        deepLink: `wanderbunnies://imports?itemId=${encodeURIComponent(item.id)}`,
        payload: { type: 'import_result', itemId: item.id, tripId: decision.tripId, action: 'auto_added' },
        dedupeKey: `import-auto:${item.id}`,
      }).catch((error) => logError('[ingestion][auto-assign] notification failed', error));
    } catch (error) {
      // The booking stays in the review queue; the person can still add it themselves.
      logError(`[ingestion][auto-assign] left item=${item.id} for review`, error);
    }
  }
  return added;
};
