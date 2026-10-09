import type { NextFunction, Request, Response } from 'express';
import type { TokenPayload } from '../auth';
import { recordServerEvent } from './ingestService';

type ItemType = 'transfer' | 'lodging' | 'activity' | 'car_rental' | 'expense';

/**
 * Records the `item_saved` server outcome (analytics plan Phase 2/7) for an item router
 * without touching each handler: after a successful (2xx) create (`POST /`) or update
 * (`PUT|PATCH /:id`) the event is queued with the authenticated user and, when the
 * request names one, the trip. recordServerEvent applies consent, rollout and region
 * rules and never blocks or fails the response.
 */
export const trackItemSaved = (itemType: ItemType) => (req: Request, res: Response, next: NextFunction): void => {
  const method = req.method.toUpperCase();
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
    next();
    return;
  }
  // Path relative to the router mount: "/" for create, "/<id>" for update; nothing deeper.
  const relative = req.path.replace(/\/+$/, '') || '/';
  const isCreate = method === 'POST' && relative === '/';
  const isUpdate = method !== 'POST' && /^\/[^/]+$/.test(relative);
  if (!isCreate && !isUpdate) {
    next();
    return;
  }
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const user = (req as Request & { user?: TokenPayload }).user;
    if (!user?.userId) return;
    const tripId = typeof req.body?.tripId === 'string' ? req.body.tripId : null;
    recordServerEvent({
      userId: user.userId,
      role: user.role,
      eventName: 'item_saved',
      tripId,
      properties: { item_type: itemType, created: isCreate },
    });
  });
  next();
};
