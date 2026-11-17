import originAxios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { Agent as HttpAgent } from 'node:http';
import type { Agent as HttpsAgent } from 'node:https';
import { httpsOverHttp, httpOverHttp } from 'tunnel-agent';

import { config as runtimeConfig } from '../config';
import { getSettings } from '../server/settings';

type ProxyConfig = { host: string; port: number; proxyAuth?: string };

type RetrySettings = {
  limit: number;
  retryCount: number;
  retryDelay: number;
  timeout: number;
};

export type RetryableRequestConfig<T = unknown> = AxiosRequestConfig<T> & {
  retry?: Partial<RetrySettings>;
  httpAgent?: HttpAgent;
  httpsAgent?: HttpsAgent;
  proxy?: false | ProxyConfig;
};

interface RetryableAxiosInstance extends AxiosInstance {
  retryGet<T = unknown>(url: string, config: RetryableRequestConfig): Promise<AxiosResponse<T>>;
}

const axios = originAxios.create() as RetryableAxiosInstance;

export const isScraperRequestCancelled = (error: unknown): boolean => originAxios.isCancel(error);

function cancellationError(): Error {
  return new originAxios.CanceledError('Request cancelled');
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancellationError());
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      reject(cancellationError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const buildProxyOptions = (host?: string, port?: number, username?: string, password?: string): { proxy: ProxyConfig } | null => {
  if (!host || !port) return null;
  const proxyOpts: ProxyConfig = { host, port };
  if (username) {
    const pass = password !== undefined && password !== null ? String(password) : '';
    proxyOpts.proxyAuth = `${username}:${pass}`;
  }
  return { proxy: proxyOpts };
};

// Cache tunnel agents to avoid creating new ones per request (memory leak prevention)
let cachedProxyKey: string | null = null;
let cachedHttpAgent: HttpAgent | null = null;
let cachedHttpsAgent: HttpsAgent | null = null;

function getOrCreateTunnelAgents(tunnelOpts: { proxy: ProxyConfig }): { httpAgent: HttpAgent; httpsAgent: HttpsAgent } {
  const key = `${tunnelOpts.proxy.host}:${tunnelOpts.proxy.port}:${tunnelOpts.proxy.proxyAuth || ''}`;
  if (cachedProxyKey === key && cachedHttpAgent && cachedHttpsAgent) {
    return { httpAgent: cachedHttpAgent, httpsAgent: cachedHttpsAgent };
  }

  // Proxy config changed, create new agents
  cachedProxyKey = key;
  cachedHttpAgent = httpOverHttp(tunnelOpts);
  cachedHttpsAgent = httpsOverHttp(tunnelOpts);

  return { httpAgent: cachedHttpAgent, httpsAgent: cachedHttpsAgent };
}

type ProxySettings = Awaited<ReturnType<typeof getSettings>>;

function applyProxyConfiguration(
  requestConfig: InternalAxiosRequestConfig & Partial<RetryableRequestConfig>,
  settings?: ProxySettings,
): void {
  const host = settings?.httpProxyHost
    ? String(settings.httpProxyHost).trim()
    : runtimeConfig.httpProxyHost;
  const port = settings?.httpProxyPort ?? runtimeConfig.httpProxyPort;
  const username = typeof settings?.httpProxyUsername === 'string'
    ? settings.httpProxyUsername.trim()
    : runtimeConfig.httpProxyUsername.trim();
  const password = typeof settings?.httpProxyPassword === 'string'
    ? settings.httpProxyPassword
    : runtimeConfig.httpProxyPassword;
  const tunnelOpts = buildProxyOptions(host, port, username, password);
  if (!tunnelOpts) return;

  requestConfig.proxy = false;
  const agents = getOrCreateTunnelAgents(tunnelOpts);
  requestConfig.httpAgent = agents.httpAgent;
  requestConfig.httpsAgent = agents.httpsAgent;
}

// Apply the user-configured HTTP proxy, falling back to environment configuration.
axios.interceptors.request.use(async (cfg: InternalAxiosRequestConfig) => {
  const requestConfig = cfg as InternalAxiosRequestConfig & Partial<RetryableRequestConfig>;
  try {
    const settings = await getSettings();
    if (settings.httpProxyEnabled === false) return cfg;
    applyProxyConfiguration(requestConfig, settings);
  } catch {
    // Ignore settings read failures and use only the environment configuration, if any.
    applyProxyConfiguration(requestConfig);
  }
  return cfg;
});

const retryGet = async <T = unknown>(url: string, config: RetryableRequestConfig): Promise<AxiosResponse<T>> => {
  const defaultLimit = runtimeConfig.retry;
  const defaultRetryDelay = runtimeConfig.retryDelay;
  let defaultTimeout = 10000;

  if (url.indexOf('dlsite') !== -1) {
    defaultTimeout = runtimeConfig.dlsiteTimeout;
  } else if (url.indexOf('hvdb') !== -1) {
    defaultTimeout = runtimeConfig.hvdbTimeout;
  }

  const retryState: RetrySettings = {
    limit: config.retry?.limit ?? defaultLimit,
    retryCount: config.retry?.retryCount ?? 0,
    retryDelay: config.retry?.retryDelay ?? defaultRetryDelay,
    timeout: config.retry?.timeout ?? defaultTimeout
  };

  const callerSignal = config.signal as AbortSignal | undefined;
  let retryCount = retryState.retryCount;
  while (true) {
    if (callerSignal?.aborted) throw cancellationError();

    const requestController = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => requestController.abort(callerSignal?.reason);
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
    const timeoutId = setTimeout(
      () => {
        timedOut = true;
        requestController.abort(new Error(`Timeout of ${retryState.timeout}ms.`));
      },
      retryState.timeout,
    );
    const retryConfig: RetryableRequestConfig = {
      ...config,
      retry: { ...retryState, retryCount },
      signal: requestController.signal,
    };

    try {
      return await axios.get<T>(url, retryConfig);
    } catch (error: unknown) {
      const axiosError = error as { response?: unknown };
      const callerCancelled = callerSignal?.aborted === true;
      if (callerCancelled || (isScraperRequestCancelled(error) && !timedOut)) {
        throw error;
      }
      if (retryCount >= retryState.limit || axiosError?.response) throw error;

      retryCount += 1;
      await waitForRetry(retryState.retryDelay, callerSignal);
      console.log(`${url} 第 ${retryCount} 次重试请求`);
    } finally {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }
};
axios.retryGet = retryGet;

export default axios;
