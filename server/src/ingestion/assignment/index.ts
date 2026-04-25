import { assignParsedItemToTrip, getParsedItemById, softDeleteParsedItem, updateParsedItemEdits } from '../shared/repository';

export const assignReviewItemToTrip = async (params: {
  userId: string;
  parsedItemId: string;
  tripId: string;
  assignedByUserId: string;
  editedFields?: Record<string, unknown>;
}) => {
  if (params.editedFields && Object.keys(params.editedFields).length > 0) {
    await updateParsedItemEdits(params.userId, params.parsedItemId, params.editedFields);
  }
  return assignParsedItemToTrip(params.userId, params.parsedItemId, params.tripId, params.assignedByUserId);
};

export const deleteReviewItem = async (userId: string, parsedItemId: string) => softDeleteParsedItem(userId, parsedItemId);

export const updateReviewItemEdits = async (userId: string, parsedItemId: string, editedFields: Record<string, unknown>) =>
  updateParsedItemEdits(userId, parsedItemId, editedFields);

export const getReviewItem = async (userId: string, parsedItemId: string) => getParsedItemById(userId, parsedItemId);

export type BulkOutcome<T> = {
  succeeded: Array<{ id: string; result: T }>;
  failed: Array<{ id: string; reason: string }>;
};

const dedupeIds = (ids: string[]): string[] => Array.from(new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean)));

const describeError = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  return 'Unknown error';
};

export const bulkDeleteReviewItems = async (userId: string, ids: string[]): Promise<BulkOutcome<{ id: string }>> => {
  const outcome: BulkOutcome<{ id: string }> = { succeeded: [], failed: [] };
  for (const id of dedupeIds(ids)) {
    try {
      const updated = await softDeleteParsedItem(userId, id);
      outcome.succeeded.push({ id, result: { id: updated.id } });
    } catch (error) {
      outcome.failed.push({ id, reason: describeError(error) });
    }
  }
  return outcome;
};

export const bulkAssignReviewItemsToTrip = async (params: {
  userId: string;
  ids: string[];
  tripId: string;
  assignedByUserId: string;
}): Promise<BulkOutcome<{ id: string; tripId: string; itemType: string }>> => {
  const outcome: BulkOutcome<{ id: string; tripId: string; itemType: string }> = { succeeded: [], failed: [] };
  for (const id of dedupeIds(params.ids)) {
    try {
      const item = await getParsedItemById(params.userId, id);
      if (!item) throw new Error('Parsed item not found');
      await assignParsedItemToTrip(params.userId, id, params.tripId, params.assignedByUserId);
      outcome.succeeded.push({ id, result: { id, tripId: params.tripId, itemType: item.itemType } });
    } catch (error) {
      outcome.failed.push({ id, reason: describeError(error) });
    }
  }
  return outcome;
};
