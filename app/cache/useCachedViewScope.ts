import { useCallback, useEffect, useRef } from 'react';
/** A cached callback belongs to a view, not just an account. Scope includes filters/pagination. */
export const useCachedViewScope = (scope: string) => {
  const current = useRef({ scope, mounted: true });
  current.current.scope = scope;
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; }; }, []);
  return useCallback(() => current.current.mounted && current.current.scope === scope, [scope]);
};
