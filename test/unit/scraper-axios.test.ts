import originAxios from 'axios';
import scraperAxios, { isScraperRequestCancelled } from '../../scraper/axios';

describe('scraper retry cancellation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops immediately without retrying when the caller cancels', async () => {
    const getSpy = vi.spyOn(scraperAxios, 'get').mockImplementation((_url, config) => (
      new Promise((_resolve, reject) => {
        config?.signal?.addEventListener?.('abort', () => {
          reject(new originAxios.CanceledError('cancelled by test'));
        }, { once: true });
      })
    ));
    const controller = new AbortController();

    const request = scraperAxios.retryGet('https://example.test/resource', {
      retry: { limit: 3, retryDelay: 1, timeout: 1000 },
      signal: controller.signal,
    });
    controller.abort();

    await expect(request).rejects.toSatisfy(isScraperRequestCancelled);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('does not start a request when the caller signal is already aborted', async () => {
    const getSpy = vi.spyOn(scraperAxios, 'get');
    const controller = new AbortController();
    controller.abort();

    const request = scraperAxios.retryGet('https://example.test/resource', {
      retry: { limit: 3, retryDelay: 1, timeout: 1000 },
      signal: controller.signal,
    });

    await expect(request).rejects.toSatisfy(isScraperRequestCancelled);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('continues to retry request timeouts', async () => {
    const getSpy = vi.spyOn(scraperAxios, 'get').mockImplementation((_url, config) => (
      new Promise((_resolve, reject) => {
        config?.signal?.addEventListener?.('abort', () => {
          reject(new originAxios.CanceledError('timed out by test'));
        }, { once: true });
      })
    ));

    const request = scraperAxios.retryGet('https://example.test/resource', {
      retry: { limit: 1, retryDelay: 0, timeout: 5 },
    });

    await expect(request).rejects.toSatisfy(isScraperRequestCancelled);
    expect(getSpy).toHaveBeenCalledTimes(2);
  });
});
