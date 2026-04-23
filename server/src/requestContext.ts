import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export type RequestContext = {
  requestId: string;
  method?: string;
  path?: string;
  userId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

export const generateRequestId = (): string =>
  randomBytes(8).toString('hex');

export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T =>
  storage.run(context, fn);

export const getRequestContext = (): RequestContext | undefined => storage.getStore();

export const setRequestContextUserId = (userId: string): void => {
  const current = storage.getStore();
  if (current) {
    current.userId = userId;
  }
};
