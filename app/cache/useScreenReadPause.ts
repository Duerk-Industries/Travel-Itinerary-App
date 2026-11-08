import { useEffect } from 'react';
import { useScreenCache } from './ScreenCacheProvider';

/** Prevent background server-data refreshes from replacing an interactive form's base state. */
export const useScreenReadPause = (paused: boolean): void => {
  const scope = useScreenCache();
  useEffect(() => paused && scope ? scope.cache.pauseReads() : undefined, [paused, scope?.cache]);
};
