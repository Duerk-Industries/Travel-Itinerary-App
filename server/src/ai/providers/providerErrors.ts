export const normalizeProviderError = (provider: string, err: unknown): Error => {
  const anyErr = err as any;
  const status = anyErr?.status ?? anyErr?.response?.status;
  const message =
    anyErr?.response?.data?.error?.message ??
    anyErr?.response?.data?.message ??
    anyErr?.message ??
    `${provider} provider request failed`;
  const normalized = new Error(String(message));
  if (status) (normalized as any).status = status;
  (normalized as any).provider = provider;
  (normalized as any).details = anyErr?.response?.data;
  return normalized;
};
