export class ApiClientError extends Error {
  status: number;
  code?: string;
  data?: unknown;

  constructor(message: string, status: number, options?: { code?: string; data?: unknown }) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = options?.code;
    this.data = options?.data;
  }
}

type RequestJsonOptions = {
  body?: BodyInit | FormData | Record<string, unknown> | null;
  headers?: Record<string, string>;
  method?: string;
  signal?: AbortSignal;
  token?: string | null;
};

const isPlainObjectBody = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) &&
  typeof value === 'object' &&
  !(value instanceof FormData) &&
  !(value instanceof Blob) &&
  !(value instanceof ArrayBuffer);

const parseResponseBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    try {
      return await response.text();
    } catch {
      return null;
    }
  }
};

export const requestJson = async <T>(url: string, options: RequestJsonOptions = {}): Promise<T> => {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body = options.body as BodyInit | FormData | undefined;

  if (options.token && !headers.Authorization) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  if (typeof options.body !== 'undefined' && options.body !== null && isPlainObjectBody(options.body)) {
    body = JSON.stringify(options.body);
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const response = await fetch(url, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
    signal: options.signal,
  });

  const parsedBody = await parseResponseBody(response);
  if (!response.ok) {
    const message =
      (typeof parsedBody === 'object' && parsedBody && 'error' in parsedBody && typeof (parsedBody as any).error === 'string'
        ? (parsedBody as any).error
        : null) ?? `Request failed with status ${response.status}`;
    const code =
      typeof parsedBody === 'object' && parsedBody && 'code' in parsedBody && typeof (parsedBody as any).code === 'string'
        ? (parsedBody as any).code
        : undefined;
    throw new ApiClientError(message, response.status, { code, data: parsedBody });
  }

  return parsedBody as T;
};
