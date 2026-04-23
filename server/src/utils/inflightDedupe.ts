const registries = new Map<symbol, Map<string, Promise<unknown>>>();

const DEFAULT_REGISTRY = Symbol('inflight-dedupe:default');

const getRegistry = (key: symbol): Map<string, Promise<unknown>> => {
  let registry = registries.get(key);
  if (!registry) {
    registry = new Map();
    registries.set(key, registry);
  }
  return registry;
};

export type InflightDedupeOptions = {
  registry?: symbol;
};

export const dedupeInFlight = <T>(
  key: string,
  fn: () => Promise<T>,
  options: InflightDedupeOptions = {}
): Promise<T> => {
  const registry = getRegistry(options.registry ?? DEFAULT_REGISTRY);
  const existing = registry.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = (async () => fn())();
  registry.set(key, promise);
  const cleanup = () => {
    if (registry.get(key) === promise) registry.delete(key);
  };
  promise.then(cleanup, cleanup);
  return promise;
};

export const createInflightDedupe = () => {
  const registry = Symbol('inflight-dedupe:scoped');
  return {
    dedupe: <T>(key: string, fn: () => Promise<T>): Promise<T> =>
      dedupeInFlight(key, fn, { registry }),
    clear: () => {
      registries.delete(registry);
    },
    size: (): number => {
      return registries.get(registry)?.size ?? 0;
    },
  };
};

export const clearDefaultInflightDedupe = (): void => {
  registries.delete(DEFAULT_REGISTRY);
};
