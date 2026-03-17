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
