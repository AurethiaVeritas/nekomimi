// Retry safe reads on transient failures. Writes require explicit opt-in because
// a failed response can arrive after the server has already committed a change.

export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  jitterMs?: number;
};

export type JsonRequestInit = Omit<RequestInit, 'body'> & {
  body?: BodyInit | null;
  json?: unknown;
  errorMessage?: string;
  retry?: RetryOptions;
};

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function isRetryableError(err: unknown): err is Error {
  if (!err || typeof err !== 'object') return false;
  const e = err as Error & { name?: string };
  // Fetch throws TypeError on network failure
  return e.name === 'TypeError' || e.message === 'Failed to fetch';
}

function responseErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown }
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message
  } catch { }
  return body
}

function isRetryableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504 || status === 429;
}

export async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit = {}, options: RetryOptions = {}): Promise<Response> {
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  const defaultRetries = ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 2 : 0;
  const retries = typeof options.retries === 'number' && Number.isFinite(options.retries) ? Math.max(0, Math.floor(options.retries)) : defaultRetries;
  const baseDelay = typeof options.baseDelayMs === 'number' && Number.isFinite(options.baseDelayMs) ? Math.max(0, options.baseDelayMs) : 300;
  const jitter = typeof options.jitterMs === 'number' && Number.isFinite(options.jitterMs) ? Math.max(0, options.jitterMs) : 200;
  let attempt = 0;
  for (;;) {
    signal?.throwIfAborted();
    try {
      const r = await fetch(input, init);
      signal?.throwIfAborted();
      if (isRetryableStatus(r.status)) {
        if (attempt >= retries) return r;
        const delay = baseDelay * 2 ** attempt + Math.random() * jitter;
        await sleep(delay, signal);
        attempt++;
        continue;
      }
      return r;
    } catch (e) {
      signal?.throwIfAborted();
      if (!isRetryableError(e) || attempt >= retries) throw e;
      const delay = baseDelay * 2 ** attempt + Math.random() * jitter;
      await sleep(delay, signal);
      attempt++;
    }
  }
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  options: JsonRequestInit = {},
): Promise<T> {
  const {
    body: rawBody,
    errorMessage,
    headers: rawHeaders,
    json,
    retry,
    ...init
  } = options;
  const headers = new Headers(rawHeaders);
  const body = json === undefined ? rawBody : JSON.stringify(json);
  if (json !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetchWithRetry(input, {
    credentials: 'include',
    ...init,
    headers,
    body,
  }, retry);
  if (!response.ok) {
    const responseMessage = responseErrorMessage(await response.text());
    throw new Error(errorMessage || responseMessage || `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}
