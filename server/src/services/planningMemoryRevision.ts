// pg-mem has no PL/pgSQL triggers/real MVCC. A conservative whole-database
// revision gives the test adapter correct invalidation (extra misses are fine),
// while production PostgreSQL uses scoped transactional triggers.
// Money quotes are a cache derived from rows the bundle already holds, and reading a trip fills them in. Production
// PostgreSQL has no revision trigger on these tables, so counting their writes here would make every read invalidate itself.
const DERIVED_TABLES = /\b(trip_money_metadata|trip_expense_preferences)\b/i;
let revision = 0;
const proxies = new WeakMap<object, any>();
export const memoryPlanningRevision = (): string => String(revision);
export const trackMemoryPlanningWrites = <T extends object>(object: T): T => {
  if (proxies.has(object)) return proxies.get(object);
  const proxy = new Proxy(object, { get(target: any, property) {
    if (property === 'query') return async (...args: any[]) => {
      const result = await target.query(...args);
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text;
      if (typeof sql === 'string' && /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql) && !DERIVED_TABLES.test(sql)) revision += 1;
      return result;
    };
    if (property === 'connect') return async () => trackMemoryPlanningWrites(await target.connect());
    const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  proxies.set(object, proxy); return proxy;
};
