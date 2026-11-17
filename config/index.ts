// Basic runtime configuration for scrapers and server

export interface RuntimeConfig {
  httpProxyHost: string;
  httpProxyPort: number;
  httpProxyUsername: string;
  httpProxyPassword: string;
  retry: number;
  retryDelay: number;
  dlsiteTimeout: number;
  hvdbTimeout: number;
  dataDir: string;
  coverDir: string;
  dbPath: string | null;
  maxCoverBytes: number;
  tempCoverTtlHours: number;
}

const env = process.env;

const toInt = (v: string | undefined, def: number): number => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : def;
};

export const config: RuntimeConfig = {
  // Proxy for outgoing HTTP(S) requests (optional)
  httpProxyHost: env.HTTP_PROXY_HOST || '',
  httpProxyPort: toInt(env.HTTP_PROXY_PORT, 0),
  httpProxyUsername: env.HTTP_PROXY_USERNAME || '',
  httpProxyPassword: env.HTTP_PROXY_PASSWORD || '',

  // Retry policy
  retry: toInt(env.HTTP_RETRY_LIMIT, 5),
  retryDelay: toInt(env.HTTP_RETRY_DELAY_MS, 2000),

  // Per-site timeouts
  dlsiteTimeout: toInt(env.DLSITE_TIMEOUT_MS, 10000),
  hvdbTimeout: toInt(env.HVDB_TIMEOUT_MS, 10000),

  // Media library
  dataDir: env.DATA_DIR || 'data',
  coverDir: env.COVER_DIR || 'cover',
  dbPath: env.DB_PATH || null, // if null, default to `${dataDir}/nekomimi.db`
  maxCoverBytes: Math.max(1, toInt(env.MAX_COVER_BYTES, 10 * 1024 * 1024)),
  tempCoverTtlHours: Math.max(1, toInt(env.TEMP_COVER_TTL_HOURS, 24)),
};
