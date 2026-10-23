/** Local-only diagnostics: no network reporting or consent changes during startup. */
export const startupErrorMessage = (error: unknown): string => {
  if (!error) return 'Unknown startup error';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  try { return JSON.stringify(error) || String(error); }
  catch { return String(error); }
};

export const formatStartupDiagnostic = (error: unknown, componentStack?: string): string => {
  const stack = typeof error === 'object' && error !== null && 'stack' in error && typeof error.stack === 'string'
    ? error.stack : '';
  return [stack || startupErrorMessage(error), componentStack].filter(Boolean).join('\n\n');
};
