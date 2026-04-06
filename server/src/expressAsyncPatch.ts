import express from 'express';

const WRAPPED_HANDLER = Symbol.for('travel-itinerary-app.expressAsyncHandlerWrapped');
const WRAPPED_METHOD = Symbol.for('travel-itinerary-app.expressAsyncMethodWrapped');

type ExpressHandler = (...args: any[]) => any;

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> => (
  typeof value === 'object' &&
  value !== null &&
  typeof (value as PromiseLike<unknown>).then === 'function'
);

const wrapHandler = <T>(candidate: T): T => {
  if (typeof candidate !== 'function') return candidate;
  const handler = candidate as unknown as ExpressHandler & { [WRAPPED_HANDLER]?: boolean };
  if (handler.length === 4 || handler[WRAPPED_HANDLER]) {
    return candidate;
  }

  const wrapped: ExpressHandler & { [WRAPPED_HANDLER]?: boolean } = function wrappedAsyncHandler(this: unknown, ...args: any[]) {
    const next = args[2];
    try {
      const result = handler.apply(this, args);
      if (isPromiseLike(result)) {
        Promise.resolve(result).catch(next);
      }
      return result;
    } catch (error) {
      return next(error);
    }
  };
  wrapped[WRAPPED_HANDLER] = true;
  return wrapped as unknown as T;
};

const wrapArgument = <T>(candidate: T): T => {
  if (Array.isArray(candidate)) {
    return candidate.map((entry) => wrapArgument(entry)) as unknown as T;
  }
  return wrapHandler(candidate);
};

const patchRouterAsyncHandling = (): void => {
  const routerPrototype = Object.getPrototypeOf(express.Router());
  const methods = ['use', 'all', 'get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

  for (const method of methods) {
    const original = routerPrototype[method] as ((...args: any[]) => any) & { [WRAPPED_METHOD]?: boolean };
    if (typeof original !== 'function' || original[WRAPPED_METHOD]) continue;

    const wrappedMethod = function wrappedRouterMethod(this: unknown, ...args: any[]) {
      return original.apply(this, args.map((arg) => wrapArgument(arg)));
    };
    (wrappedMethod as typeof original)[WRAPPED_METHOD] = true;
    routerPrototype[method] = wrappedMethod;
  }
};

patchRouterAsyncHandling();
