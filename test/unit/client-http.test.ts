/// <reference lib="dom" />
import type { fetchWithRetry as FetchWithRetry, requestJson as RequestJson } from '../../client/src/lib/http.js' with { 'resolution-mode': 'import' };

let fetchWithRetry: typeof FetchWithRetry;
let requestJson: typeof RequestJson;
beforeAll(async () => { ({ fetchWithRetry, requestJson } = await import('../../client/src/lib/http.js')); });

describe('Client HTTP retries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(['POST', 'PUT', 'DELETE'])('does not replay a %s request after a network failure', async method => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestJson('/api/mutation', { method, json: { name: 'fixture' }, retry: { baseDelayMs: 0, jitterMs: 0 } }))
      .rejects.toThrow('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still retries safe reads after a transient response', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValue(new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestJson('/api/health', { retry: { baseDelayMs: 0, jitterMs: 0 } })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops immediately when aborted during backoff', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const promise = fetchWithRetry('/api/works', { signal: controller.signal }, { baseDelayMs: 5000, jitterMs: 0 });
    const rejected = expect(promise).rejects.toThrow('Cancelled by caller');
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error('Cancelled by caller'));
    await vi.runAllTimersAsync();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not call fetch for an already aborted request', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Already cancelled'));
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWithRetry('/api/works', { signal: controller.signal })).rejects.toThrow('Already cancelled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a caller to opt into a known-safe mutation retry', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetchWithRetry('/api/probe', { method: 'POST' }, { retries: 1, baseDelayMs: 0, jitterMs: 0 });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
