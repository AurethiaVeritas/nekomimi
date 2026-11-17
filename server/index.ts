import express from 'express';
import { performImportWorkFromDLsite, type ImportWorkOptions } from './workImport';
import { ensureCoverDirExists } from './workCovers';
import libraryRoutes from './libraryRoutes';
import fileRoutes from './fileRoutes';
import { toStringParam, toArrayParam, parseBooleanParam, getErrorMessage } from './requestUtils';
import { SMB_FILENAME_UNREACHABLE, describeInaccessibleSmbPath, toAudioMediaFile, scanAudioMedia } from './libraryMedia';
import fs from 'node:fs';
import path from 'node:path';
import helmet from 'helmet';
import { EventEmitter } from 'node:events';
import type { Request, Response, NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';
// Avoid ESM-only mime v4 issues by using our own guesser

import {
  upsertWork,
  listWorks,
  getWork,
  getExistingWorkIds,
  attachMedia,
  deleteWork,
  type DbWork,
  type DbMedia,
  initializeDatabase,
  flushDatabase,
  beginDatabaseShutdown,
} from './db';
import { getSettings, updateSettings } from './settings';
import {
  isAudioFile,
  isPathUnderRoot,
  resolvePathSafe,
  formatID,
  guessMimeType,
  extractRJFromName,
  inspectListedButInaccessiblePath,
} from '../filesystem/utils';
import axios from '../scraper/axios';
import * as auth from './auth';
import { getAllowedRoots, ensurePathAllowed, isPathWithinAllowed, staticRoots } from './pathGuard';
import type { Settings } from './types';
import { config } from '../config';
import { openApiDocument } from './openapi';
import { isValidTimeZone, msUntilNextDaily, resolveTimeZone } from './timezone';
import { ensureWritableDirectory, ensureWritableFileIfExists } from './storage';
import { createLogEntry, formatConsoleLog, isLogLevel, LOG_LEVELS, type LogEntry, type LogLevel } from './logging';
import {
  cleanupExpiredCoverFiles,
  openRegularFileNoFollow,
  receiveValidatedImage,
  streamFileDescriptor,
  UploadError,
  type ImageExtension,
} from './httpSecurity';

const DATA_DIR = resolvePathSafe(config.dataDir);
const COVER_DIR = resolvePathSafe(config.coverDir);
const DB_FILE = config.dbPath ? resolvePathSafe(config.dbPath) : path.join(DATA_DIR, 'nekomimi.db');
const COVER_UPLOAD_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_COVER_BYTES = config.maxCoverBytes;
const TEMP_COVER_TTL_MS = config.tempCoverTtlHours * 60 * 60 * 1000;
const app = express();
const serverLifetimeController = new AbortController();
const activeImports = new Set<Promise<unknown>>();

// Security headers via helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Vite dev needs unsafe-inline
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for media streaming compatibility
}));

// Enable trust proxy for reverse proxy support (nginx, Cloudflare, etc.)
// This allows Express to read X-Forwarded-* headers correctly
const trustProxyEnv = process.env.TRUST_PROXY?.trim();
const trustProxy = (() => {
  if (!trustProxyEnv) return 'loopback'; // Safe default for local reverse proxies without allowing spoofed IPs
  if (trustProxyEnv === 'false') return false;
  if (trustProxyEnv === 'true') return 'loopback'; // Avoid permissive "trust all"
  if (/^\d+$/.test(trustProxyEnv)) return parseInt(trustProxyEnv, 10);
  if (trustProxyEnv.includes(',')) return trustProxyEnv.split(',').map(v => v.trim()).filter(Boolean);
  return trustProxyEnv;
})();
app.set('trust proxy', trustProxy);
const PORT = process.env.PORT || 3000;

// Server logging system with memory limits
const serverLogs: LogEntry[] = [];
const MAX_LOGS = 500;
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5MB total log limit
let serverLogsApproxSize = 0; // Track approximate size incrementally to avoid O(n²) serialization
const logEmitter = new EventEmitter();

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;
let enabledServerLogLevels = new Set<LogLevel>(LOG_LEVELS);

function applyServerLogLevels(levels: unknown): void {
  const validLevels = Array.isArray(levels) && levels.every(isLogLevel) ? levels : LOG_LEVELS;
  enabledServerLogLevels = new Set(validLevels);
}

function addLog(level: LogLevel, ...args: unknown[]): LogEntry {
  const entry = createLogEntry(level, args);

  // Calculate size of this entry only (not entire buffer)
  const entrySize = JSON.stringify(entry).length;
  serverLogsApproxSize += entrySize;

  serverLogs.push(entry);
  if (serverLogs.length > MAX_LOGS) {
    const removed = serverLogs.shift();
    if (removed) {
      serverLogsApproxSize -= JSON.stringify(removed).length;
    }
  }

  // Check using incrementally tracked size (avoids O(n) serialization per log)
  if (serverLogsApproxSize > MAX_LOG_SIZE_BYTES) {
    const removeCount = Math.floor(serverLogs.length * 0.2); // Remove 20%
    for (let i = 0; i < removeCount; i++) {
      const removed = serverLogs.shift();
      if (removed) {
        serverLogsApproxSize -= JSON.stringify(removed).length;
      }
    }
  }

  logEmitter.emit('log', entry);
  return entry;
}

console.log = (...args: unknown[]) => {
  if (!enabledServerLogLevels.has('info')) return;
  originalConsoleLog(formatConsoleLog(addLog('info', ...args)));
};

console.warn = (...args: unknown[]) => {
  if (!enabledServerLogLevels.has('warn')) return;
  originalConsoleWarn(formatConsoleLog(addLog('warn', ...args)));
};

console.error = (...args: unknown[]) => {
  if (!enabledServerLogLevels.has('error')) return;
  originalConsoleError(formatConsoleLog(addLog('error', ...args)));
};

app.use(express.json({ limit: '2mb' }));
// Attach user info to every request so non-/api routes can enforce auth
app.use(auth.attachUser);

// helpers
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

const getHttpStatusFromError = (err: unknown) => {
  const status = (err as { response?: { status?: unknown } })?.response?.status;
  return typeof status === 'number' ? status : undefined;
};

const extractIpAddress = (input: unknown) => {
  const text = String(input ?? '').trim();
  const match = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:[a-f0-9]{1,4}:){2,}[a-f0-9]{1,4}\b/i);
  if (match) return match[0];
  if (text.length <= 64 && !/\s|<[^>]+>/.test(text)) return text;
  return '';
};

const ifNoneMatchMatches = (header: string | string[] | undefined, etag: string) => {
  if (!header) return false;
  const raw = Array.isArray(header) ? header.join(',') : header;
  const normalizedEtag = etag.startsWith('W/') ? etag.slice(2) : etag;
  return raw.split(',').some(value => {
    const candidate = value.trim();
    if (candidate === '*') return true;
    return (candidate.startsWith('W/') ? candidate.slice(2) : candidate) === normalizedEtag;
  });
};

/** Helper to extract error properties for HTTP responses */
interface PathError extends Error {
  statusCode?: number;
  code?: string;
}
const getPathErrorStatus = (err: unknown): number => {
  const e = err as Partial<PathError>;
  return e?.statusCode || (e?.code === 'PATH_NOT_ALLOWED' ? 400 : 500);
};

function validateRuntimeStorage(): void {
  const directories = new Map<string, string>([
    [DATA_DIR, 'data'],
    [COVER_DIR, 'cover'],
  ]);
  const databaseParent = path.dirname(DB_FILE);
  if (!directories.has(databaseParent)) directories.set(databaseParent, 'database parent');

  for (const [directory, label] of directories) {
    ensureWritableDirectory(directory, label);
  }

  ensureWritableFileIfExists(DB_FILE, 'database file');
  ensureWritableFileIfExists(path.join(DATA_DIR, 'settings.json'), 'settings file');
  ensureWritableFileIfExists(path.join(DATA_DIR, 'users.json'), 'users file');
  ensureWritableFileIfExists(path.join(DATA_DIR, 'secret.key'), 'authentication secret');
}

function getCoverUploadExtension(filename: unknown): ImageExtension | null {
  const extension = path.extname(String(filename || '').trim()).toLowerCase();
  return COVER_UPLOAD_EXTENSIONS.has(extension) ? extension as ImageExtension : null;
}

const MANAGED_COVER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif'];

function findExistingManagedCoverPath(rjcode: string | number): string | null {
  const normalized = formatID(rjcode);
  if (!normalized) return null;
  for (const extension of MANAGED_COVER_EXTENSIONS) {
    const candidate = path.join(COVER_DIR, `RJ${normalized}${extension}`);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { }
  }
  return null;
}

function restoreManagedCoverLink(work: DbWork): boolean {
  if (work.cover_path) return false;
  const managedCoverPath = findExistingManagedCoverPath(work.rjcode || work.id);
  if (!managedCoverPath) return false;
  work.cover_path = managedCoverPath;
  return true;
}

type ScanCandidate = { id: string; mediaPath: string; reason: 'folder' | 'file' };
type ScanHistoryEntry = { event: string; data: unknown; ts: number };
type ImportSummary = { imported: number; errors: number; invalidPaths: string[] };
type AlignmentSummary = { updated: number; markedMissing: number; errors: number };
type ErrorSummary = { error: string };
type ScanSummary = ImportSummary | AlignmentSummary | ErrorSummary | null;
type ScanJobParams = { startPaths: string[]; language: string; dryRun?: boolean; newOnly?: boolean; metadataOnly?: boolean; allowedRoots?: string[] | null; alignmentScan?: boolean };

async function markInvalidCoversUnderPaths(startPaths: string[], candidates: ScanCandidate[] = []) {
  const works = await listWorks();
  const updated: { id: number | string; rjcode: string; title: string | null }[] = [];
  const normalizedStartPaths = Array.from(new Set(startPaths.map(p => path.resolve(p))));
  const startPathStatus = new Map<string, boolean>();
  for (const p of normalizedStartPaths) {
    try {
      const stat = await fs.promises.stat(p);
      startPathStatus.set(p, stat.isDirectory());
    } catch {
      startPathStatus.set(p, false);
    }
  }
  const hasHealthyStartPath = Array.from(startPathStatus.values()).some(Boolean);
  if (!hasHealthyStartPath) {
    console.warn('[scan] Skipping invalid cover marking because all scan roots are unavailable.');
    return updated;
  }

  const findContainingStartPath = (base: string) => {
    let hit: string | null = null;
    for (const p of normalizedStartPaths) {
      if (isPathUnderRoot(base, p)) {
        if (!hit || p.length > hit.length) hit = p;
      }
    }
    return hit;
  };

  const observedCandidateRoots = new Set<string>();
  for (const c of candidates) {
    const mediaBase = path.resolve(c.mediaPath);
    const ownerStartPath = findContainingStartPath(mediaBase);
    if (ownerStartPath) observedCandidateRoots.add(ownerStartPath);
  }
  if (observedCandidateRoots.size === 0) {
    console.warn('[scan] Skipping invalid cover marking because no works were detected under scan roots.');
    return updated;
  }

  const isTransientFsError = (err: unknown) => {
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === 'EACCES'
      || code === 'EPERM'
      || code === 'EIO'
      || code === 'ENOTCONN'
      || code === 'ETIMEDOUT'
      || code === 'ECONNRESET'
      || code === 'ENETDOWN'
      || code === 'ENETUNREACH'
      || code === 'EHOSTUNREACH';
  };

  for (const w of works) {
    if (!w.base_dir) continue;
    const base = path.resolve(w.base_dir);
    const ownerStartPath = findContainingStartPath(base);
    if (!ownerStartPath) continue;
    if (!startPathStatus.get(ownerStartPath)) continue;
    if (!observedCandidateRoots.has(ownerStartPath)) continue;
    try {
      const stat = await fs.promises.stat(base);
      if (!stat.isDirectory()) {
        if (w.cover_path !== null) {
          w.cover_path = null;
          await upsertWork(w);
          updated.push({ id: w.id, rjcode: w.rjcode, title: w.title });
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (isTransientFsError(err)) continue;
      if (code !== 'ENOENT') continue;
      const smbIssue = inspectListedButInaccessiblePath(base);
      if (smbIssue) {
        console.warn(`[scan] Preserving cover for RJ${w.rjcode}: ${describeInaccessibleSmbPath(smbIssue)}`);
        continue;
      }
      if (w.cover_path !== null) {
        w.cover_path = null;
        await upsertWork(w);
        updated.push({ id: w.id, rjcode: w.rjcode, title: w.title });
      }
    }
  }
  return updated;
}

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// OpenAPI + Swagger UI documentation
app.get('/api/openapi.json', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(openApiDocument);
});

const swaggerDocsCsp = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
    ].join('; ')
  );
  next();
};

const swaggerDocsHandler = swaggerUi.setup(openApiDocument, {
  customSiteTitle: 'Nekomimi API Docs',
  swaggerOptions: {
    displayRequestDuration: true,
    persistAuthorization: true,
    tryItOutEnabled: false,
  },
});

app.get(/^\/api\/docs$/, (_req, res) => res.redirect(301, '/api/docs/'));
app.get(/^\/api\/docs\/$/, swaggerDocsCsp, swaggerDocsHandler);
app.use('/api/docs', swaggerDocsCsp, swaggerUi.serve);

// Auth endpoints
auth.mountAuthRoutes(app);

// Require auth for subsequent API routes
app.use('/api', (req, res, next) => {
  const open = req.path === '/health' || req.path.startsWith('/auth/')
  if (open) return next();
  return auth.requireAuth(req, res, next);
});

// --------------------
// Scan job manager (in-memory) with cleanup
// --------------------
type ScanJobStatus = 'running' | 'done' | 'error' | 'timeout';
type ScanJob = {
  id: string;
  status: ScanJobStatus;
  params: ScanJobParams;
  emitter: EventEmitter;
  history: ScanHistoryEntry[];
  summary: ScanSummary;
  startedAt: number;
  errors: string[];
};

const scanJobs = new Map<string, ScanJob>(); // id -> { id, status, params, emitter, history, summary }
const MAX_SCAN_JOBS = 100;
const SCAN_JOB_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
let activeScanId: string | null = null;
let scanSeq = 1;

function cleanupOldScanJobs() {
  const now = Date.now();

  // First, remove expired jobs (always run this check)
  for (const [id, job] of scanJobs.entries()) {
    if (job.startedAt && (now - job.startedAt) > SCAN_JOB_RETENTION_MS) {
      console.log(`[scan] Removing expired scan job: ${id}`);
      try { job.emitter.removeAllListeners(); } catch { }
      job.history.length = 0; // Clear history to free memory
      scanJobs.delete(id);
    }
  }

  // Then, if still over limit, remove oldest jobs
  if (scanJobs.size > MAX_SCAN_JOBS) {
    const sorted = Array.from(scanJobs.entries())
      .sort((a, b) => (b[1].startedAt || 0) - (a[1].startedAt || 0));

    const toDelete = sorted.slice(MAX_SCAN_JOBS);
    toDelete.forEach(([id, job]) => {
      console.log(`[scan] Cleaning up old scan job: ${id}`);
      try { job.emitter.removeAllListeners(); } catch { }
      job.history.length = 0; // Clear history to free memory
      scanJobs.delete(id);
    });
  }
}

function newScanId(): string {
  return `${Date.now()}-${scanSeq++}`;
}

function getActiveScan(): ScanJob | null {
  return activeScanId ? scanJobs.get(activeScanId) ?? null : null;
}

function createScanJob(params: ScanJobParams): {
  job: ScanJob;
  send: (event: string, data: unknown) => void;
} {
  const job: ScanJob = {
    id: newScanId(),
    status: 'running',
    params,
    emitter: new EventEmitter(),
    history: [],
    summary: null,
    startedAt: Date.now(),
    errors: [],
  };
  scanJobs.set(job.id, job);
  activeScanId = job.id;

  const send = (event: string, data: unknown) => {
    const payload: ScanHistoryEntry = { event, data, ts: Date.now() };
    if (job.history.length >= 1000) job.history.shift();
    job.history.push(payload);
    job.emitter.emit('event', payload);
  };
  return { job, send };
}

async function finishScanJob(job: ScanJob): Promise<void> {
  try { await updateSettings({ lastScanAt: new Date().toISOString() }); } catch { }
  if (activeScanId === job.id) activeScanId = null;
  try { job.emitter.removeAllListeners(); } catch { }
  cleanupOldScanJobs();
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event} \n`);
  res.write(`data: ${JSON.stringify(data)} \n\n`);
}

function sendSseError(res: Response, message: string): void {
  res.writeHead(200, SSE_HEADERS);
  writeSseEvent(res, 'scan_error', { error: message });
  res.end();
}

function streamScanJob(
  req: Request,
  res: Response,
  job: ScanJob,
  { closeAfterMs }: { closeAfterMs?: number } = {},
): void {
  res.writeHead(200, SSE_HEADERS);
  const keepAlive = setInterval(() => {
    try { res.write(`: keep - alive\n\n`); } catch { }
  }, 25000);
  let closed = false;

  const onEvent = (entry: ScanHistoryEntry) => {
    try { writeSseEvent(res, entry.event, entry.data); } catch { }
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    job.emitter.off('event', onEvent);
    clearInterval(keepAlive);
  };

  for (const entry of job.history) writeSseEvent(res, entry.event, entry.data);
  job.emitter.on('event', onEvent);
  req.on('close', cleanup);

  if (closeAfterMs !== undefined) {
    setTimeout(() => {
      cleanup();
      try { res.end(); } catch { }
    }, closeAfterMs);
  }
}

const shouldSkipDir = (name: string) => name === 'cover' || name === 'node_modules' || name.startsWith('.');

async function discoverScanCandidates(startPaths: string[]): Promise<{ candidates: ScanCandidate[]; invalidPaths: string[] }> {
  const candidates: ScanCandidate[] = [];
  const invalidPaths: string[] = [];
  const seenDirs = new Set<string>();
  const stack: string[] = [];

  for (const p of startPaths) {
    try {
      const stat = await fs.promises.stat(p);
      if (stat.isDirectory()) stack.push(p);
      else invalidPaths.push(p);
    } catch {
      invalidPaths.push(p);
    }
  }

  while (stack.length) {
    const dir = stack.pop() as string;
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);
    const base = path.basename(dir);
    const folderId = extractRJFromName(base);
    if (folderId) {
      candidates.push({ id: folderId, mediaPath: dir, reason: 'folder' });
      continue;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    let fileId: string | null = null;
    for (const e of entries) {
      if (e.isFile()) {
        const bn = path.basename(e.name, path.extname(e.name));
        const id = extractRJFromName(bn);
        if (id) { fileId = id; break; }
      }
    }
    if (fileId) {
      candidates.push({ id: fileId, mediaPath: dir, reason: 'file' });
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && !shouldSkipDir(e.name)) stack.push(path.join(dir, e.name));
    }
  }

  return { candidates, invalidPaths };
}

async function filterCandidatesByExistence(list: ScanCandidate[], existing: boolean): Promise<ScanCandidate[]> {
  if (!list.length) return list;
  const existingIds = await getExistingWorkIds(list.map(c => c.id));
  return list.filter(candidate => existingIds.has(Number(candidate.id)) === existing);
}

function deduplicateScanCandidates(candidates: ScanCandidate[]): ScanCandidate[] {
  const byId = new Map<string, ScanCandidate>();
  for (const candidate of candidates) {
    const previous = byId.get(candidate.id);
    if (!previous || (previous.reason !== 'folder' && candidate.reason === 'folder')) {
      byId.set(candidate.id, candidate);
    }
  }
  return Array.from(byId.values());
}

async function selectScanCandidates(
  candidates: ScanCandidate[],
  { metadataOnly, newOnly }: { metadataOnly: boolean; newOnly: boolean },
): Promise<ScanCandidate[]> {
  const deduplicated = deduplicateScanCandidates(candidates);
  if (metadataOnly) return filterCandidatesByExistence(deduplicated, true);
  if (newOnly) return filterCandidatesByExistence(deduplicated, false);
  return deduplicated;
}

const getScanMode = (metadataOnly: boolean, newOnly: boolean) => (
  metadataOnly ? 'metadata-only' : (newOnly ? 'new-only' : 'full')
);

type ScanCandidateImportOptions = {
  language: string;
  metadataOnly: boolean;
  newOnly: boolean;
  allowedRoots: string[] | null;
};

function importScanCandidate(candidate: Pick<ScanCandidate, 'id' | 'mediaPath'>, options: ScanCandidateImportOptions): Promise<DbWork> {
  return importWorkFromDLsite({
    id: candidate.id,
    language: options.language,
    mediaPath: options.metadataOnly ? undefined : candidate.mediaPath,
    allowedRoots: options.allowedRoots,
    forceCoverRefresh: options.metadataOnly ? false : !options.newOnly,
    metadataOnly: options.metadataOnly,
  });
}

async function findWorkInScanPaths(scanPaths: string[], normalizedId: string): Promise<{ folderMatch: string | null; fileMatch: string | null }> {
  let folderMatch: string | null = null;
  let fileMatch: string | null = null;
  const seenDirs = new Set<string>();
  const stack: string[] = [];

  for (const scanPath of scanPaths) {
    try {
      const stat = await fs.promises.stat(scanPath);
      if (stat.isDirectory()) stack.push(scanPath);
    } catch { }
  }

  while (stack.length) {
    const dir = stack.pop() as string;
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);

    const base = path.basename(dir);
    const folderId = extractRJFromName(base);
    if (folderId && formatID(folderId) === normalizedId) {
      folderMatch = dir;
      break;
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      if (e.isFile()) {
        const bn = path.basename(e.name, path.extname(e.name));
        const id = extractRJFromName(bn);
        if (id && formatID(id) === normalizedId) {
          fileMatch = dir;
          break;
        }
      }
    }

    for (const e of entries) {
      if (e.isDirectory() && !shouldSkipDir(e.name)) stack.push(path.join(dir, e.name));
    }
  }

  return { folderMatch, fileMatch };
}

function startScanJob({ startPaths, language = 'ja-jp', dryRun = false, newOnly = true, metadataOnly = false, allowedRoots = null }: { startPaths: string[]; language?: string; dryRun?: boolean; newOnly?: boolean; metadataOnly?: boolean; allowedRoots?: string[] | null }): ScanJob {
  const scanMode = getScanMode(metadataOnly, newOnly);
  const { job, send } = createScanJob({ startPaths, language, dryRun, newOnly, metadataOnly, allowedRoots });
  const { id } = job;

  const baseRoots = (Array.isArray(allowedRoots) && allowedRoots.length)
    ? allowedRoots
    : startPaths;
  const guardRoots = Array.from(new Set([
    ...baseRoots.map(p => path.resolve(p)),
    ...staticRoots.map(p => path.resolve(p)),
  ]));
  const importOptions: ScanCandidateImportOptions = {
    language,
    metadataOnly,
    newOnly,
    allowedRoots: guardRoots,
  };

  // Set 24-hour timeout for scan job
  const SCAN_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
  const timeoutId = setTimeout(() => {
    if (job.status === 'running') {
      job.status = 'timeout';
      job.summary = { error: 'Scan timeout exceeded (24 hours)' };
      send('scan_error', { error: 'Scan timeout exceeded (24 hours)' });
      console.error(`[scan] Scan job ${id} timed out after 24 hours`);
      if (activeScanId === id) activeScanId = null;
    }
  }, SCAN_TIMEOUT_MS);

  (async () => {
    try {
      // Discover candidates (copied from /api/scan/stream)
      const { candidates, invalidPaths } = await discoverScanCandidates(startPaths);
      const importedSamples: { id: string; title: string | null; mediaPath: string }[] = [];

      const list = await selectScanCandidates(candidates, { metadataOnly, newOnly });

      send('start', { paths: startPaths, invalidPaths, total: list.length, mode: scanMode });

      if (dryRun) {
        send('found', { found: list });
        send('done', { imported: 0, errors: 0 });
        job.status = 'done';
        job.summary = { imported: 0, errors: 0, invalidPaths };
        const durationMs = Date.now() - job.startedAt;
        console.log('[scan] Dry-run completed', {
          mode: 'dry-run',
          startPaths,
          candidateCount: list.length,
          sampleIds: list.slice(0, 5).map(it => it.id),
          invalidPaths,
          durationMs,
        });
        return;
      }

      let imported = 0;
      let errors = 0;
      const failedItems: Array<ScanCandidate & { error: string }> = [];
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        try {
          const saved = await importScanCandidate(c, importOptions);
          imported += 1;
          send('progress', { index: i + 1, total: list.length, id: saved.id, rjcode: saved.rjcode, title: saved.title, mediaPath: c.mediaPath, imported, errors, mode: scanMode });
          if (importedSamples.length < 5) {
            const sampleId = String(saved?.rjcode || saved?.id || c.id);
            importedSamples.push({ id: sampleId, title: saved?.title || null, mediaPath: c.mediaPath });
          }
        } catch (e) {
          errors += 1;
          const errorMsg = getErrorMessage(e);
          send('scan_error', { index: i + 1, total: list.length, id: c.id, mediaPath: c.mediaPath, error: errorMsg, imported, errors, mode: scanMode });
          failedItems.push({ ...c, error: errorMsg });
        }
      }

      for (let attempt = 1; attempt <= 3 && failedItems.length > 0; attempt++) {
        const retryTotal = failedItems.length;
        send('retry', { attempt, pending: retryTotal, mode: scanMode });
        await sleep(10000);
        const remaining: Array<ScanCandidate & { error: string }> = [];
        for (let i = 0; i < failedItems.length; i++) {
          const f = failedItems[i];
          try {
            const saved = await importScanCandidate(f, importOptions);
            imported += 1;
            send('progress', { index: list.length + i + 1, total: list.length, retryIndex: i + 1, retryTotal, id: saved.id, rjcode: saved.rjcode, title: saved.title, mediaPath: f.mediaPath, imported, errors, retried: attempt, mode: scanMode });
            if (importedSamples.length < 5) {
              const sampleId = String(saved?.rjcode || saved?.id || f.id);
              importedSamples.push({ id: sampleId, title: saved?.title || null, mediaPath: f.mediaPath });
            }
          } catch (e) {
            errors += 1;
            const errorMsg = getErrorMessage(e);
            send('scan_error', { id: f.id, mediaPath: f.mediaPath, error: errorMsg, imported, errors, attempt, retryTotal, retryIndex: i + 1, mode: scanMode });
            remaining.push({ ...f, error: errorMsg });
          }
        }
        failedItems.length = 0;
        failedItems.push(...remaining);
      }

      const invalidUpdated = metadataOnly ? [] : await markInvalidCoversUnderPaths(startPaths, candidates);
      if (!metadataOnly) {
        send('invalid_cover', { count: invalidUpdated.length, items: invalidUpdated.slice(0, 10), mode: scanMode });
      }
      send('done', { imported, errors, mode: scanMode });
      job.status = 'done';
      job.summary = { imported, errors, invalidPaths };
      const durationMs = Date.now() - job.startedAt;
      const failureSamples = failedItems.slice(0, 5).map(({ id, mediaPath, error }) => ({ id, mediaPath, error }));
      const logFn = (errors === 0) ? console.log : ((imported === 0 && errors > 0) ? console.error : console.warn);
      logFn('[scan] Completed import scan', {
        mode: scanMode,
        startPaths,
        imported,
        errors,
        invalidPaths,
        importedSamples,
        failureSamples,
        invalidCoverUpdates: invalidUpdated.length,
        invalidCoverSamples: invalidUpdated.slice(0, 5),
        durationMs,
      });
    } catch (e) {
      job.status = 'error';
      const errorMsg = getErrorMessage(e) || 'Scan failed';
      job.summary = { error: errorMsg };
      send('scan_error', { error: job.summary.error });
      const durationMs = Date.now() - job.startedAt;
      console.error('[scan] Scan failed', {
        mode: dryRun ? `dry-run:${scanMode}` : scanMode,
        startPaths,
        error: errorMsg,
        durationMs,
      });
    } finally {
      clearTimeout(timeoutId);
      await finishScanJob(job);
    }
  })();

  return job;
}

// Alignment scan: updates file paths without dropping metadata
function startAlignmentScan({ startPaths, language = 'ja-jp' }: { startPaths: string[]; language?: string }): ScanJob {
  const { job, send } = createScanJob({ startPaths, language, alignmentScan: true });
  const guardRoots = Array.from(new Set([
    ...startPaths.map(p => path.resolve(p)),
    ...staticRoots.map(p => path.resolve(p)),
  ]));

  (async () => {
    try {
      // Get all existing works from DB
      const allWorks = await listWorks();
      send('start', { paths: startPaths, total: allWorks.length, mode: 'alignment' });

      // Discover all RJ folders in scan paths
      const { candidates } = await discoverScanCandidates(startPaths);

      // Create lookup map for found folders
      // Prefer folder-name matches over file-name matches
      const foundMap = new Map(
        deduplicateScanCandidates(candidates)
          .map(candidate => [candidate.id, { path: candidate.mediaPath, reason: candidate.reason }] as const),
      );

      let updated = 0;
      let markedMissing = 0;
      let errors = 0;
      const updatedSamples: { id: number | string; rjcode: string; title: string | null }[] = [];
      const missingSamples: { id: number | string; rjcode: string; title: string | null }[] = [];
      const errorSamples: { id: number | string; rjcode: string; title: string | null; error: string }[] = [];

      for (let i = 0; i < allWorks.length; i++) {
        const work = allWorks[i];
        try {
          const rjId = formatID(work.rjcode || work.id);
          const found = foundMap.get(rjId);
          const newPath = found ? found.path : null;

          // Check if current base_dir exists
          let currentPathExists = false;
          if (work.base_dir) {
            try {
              currentPathExists = fs.existsSync(work.base_dir) && fs.statSync(work.base_dir).isDirectory();
            } catch { }
          }

          let newPathExists = false;
          if (newPath) {
            try {
              newPathExists = fs.existsSync(newPath) && fs.statSync(newPath).isDirectory();
            } catch { }
          }

          if (newPath && newPathExists && newPath !== work.base_dir) {
            await ensurePathAllowed(newPath, { allowedRoots: guardRoots });
            // Path changed OR found correct path to replace corrupted one, update it and re-attach media
            work.base_dir = newPath;

            // Rescan media files in the new location (same logic as single-work alignment)
            let media: DbMedia[] = [];
            try {
              media = scanAudioMedia(newPath).media;
            } catch { }

            work.media = media;
            restoreManagedCoverLink(work);
            await upsertWork(work);
            updated += 1;
            send('progress', {
              index: i + 1,
              total: allWorks.length,
              id: work.id,
              rjcode: work.rjcode,
              title: work.title,
              status: 'updated',
              updated,
              markedMissing,
              errors
            });
            if (updatedSamples.length < 5) {
              updatedSamples.push({ id: work.id, rjcode: work.rjcode, title: work.title });
            }
          } else if (!currentPathExists) {
            const smbIssue = (work.base_dir && inspectListedButInaccessiblePath(work.base_dir))
              || (newPath && inspectListedButInaccessiblePath(newPath));
            if (smbIssue) {
              const coverRestored = restoreManagedCoverLink(work);
              if (coverRestored) await upsertWork(work);
              send('progress', {
                index: i + 1,
                total: allWorks.length,
                id: work.id,
                rjcode: work.rjcode,
                title: work.title,
                status: 'unchanged',
                issueCode: SMB_FILENAME_UNREACHABLE,
                message: describeInaccessibleSmbPath(smbIssue),
                coverRestored,
                updated,
                markedMissing,
                errors
              });
              continue;
            }
            // Files no longer exist, so clear the cover and let the client show its placeholder.
            if (work.cover_path !== null) {
              work.cover_path = null;
              await upsertWork(work);
              markedMissing += 1;
              send('progress', {
                index: i + 1,
                total: allWorks.length,
                id: work.id,
                rjcode: work.rjcode,
                title: work.title,
                status: 'missing',
                updated,
                markedMissing,
                errors
              });
              if (missingSamples.length < 5) {
                missingSamples.push({ id: work.id, rjcode: work.rjcode, title: work.title });
              }
            }
          } else {
            // Path unchanged (either found at same location OR current path still exists outside scan paths)
            const coverRestored = restoreManagedCoverLink(work);
            if (coverRestored) await upsertWork(work);
            send('progress', {
              index: i + 1,
              total: allWorks.length,
              id: work.id,
              rjcode: work.rjcode,
              title: work.title,
              status: 'unchanged',
              coverRestored,
              updated,
              markedMissing,
              errors
            });
          }
        } catch (e) {
          errors += 1;
          const errorMsg = getErrorMessage(e);
          send('scan_error', {
            index: i + 1,
            total: allWorks.length,
            id: work.id,
            error: errorMsg,
            updated,
            markedMissing,
            errors
          });
          if (errorSamples.length < 5) {
            errorSamples.push({ id: work.id, rjcode: work.rjcode, title: work.title, error: errorMsg });
          }
        }
      }

      send('done', { updated, markedMissing, errors, mode: 'alignment' });
      job.status = 'done';
      job.summary = { updated, markedMissing, errors };
      const durationMs = Date.now() - job.startedAt;
      console.log('[scan] Completed alignment scan', {
        mode: 'alignment',
        startPaths,
        total: allWorks.length,
        updated,
        markedMissing,
        errors,
        updatedSamples,
        missingSamples,
        errorSamples,
        durationMs,
      });
    } catch (e) {
      job.status = 'error';
      const errorMsg = getErrorMessage(e) || 'Alignment scan failed';
      job.summary = { error: errorMsg };
      send('scan_error', { error: job.summary.error });
      const durationMs = Date.now() - job.startedAt;
      console.error('[scan] Alignment scan failed', {
        mode: 'alignment',
        startPaths,
        error: errorMsg,
        durationMs,
      });
    } finally {
      await finishScanJob(job);
    }
  })();

  return job;
}

// --------------------
// Auto-scan scheduler (new-only)
// --------------------
let autoScanIntervalHandle: NodeJS.Timeout | null = null;
let autoScanDailyHandle: NodeJS.Timeout | null = null;

function clearAutoScanTimers() {
  if (autoScanIntervalHandle) { try { clearInterval(autoScanIntervalHandle) } catch { }; autoScanIntervalHandle = null; }
  if (autoScanDailyHandle) { try { clearTimeout(autoScanDailyHandle) } catch { }; autoScanDailyHandle = null; }
}

async function runAutoScanIfIdle() {
  try {
    if (getActiveScan()) return; // skip if a job is running
    const s = await getSettings();
    const rawPaths = Array.isArray(s.defaultScanPaths) ? s.defaultScanPaths.filter(Boolean) : [];
    if (!rawPaths.length) return; // nothing to scan
    const { startPaths, allowedRoots } = await normalizeStartPaths(rawPaths);
    if (!startPaths.length) return;
    // Always newOnly for auto-scans
    startScanJob({ startPaths, allowedRoots, language: 'ja-jp', dryRun: false, newOnly: true });
  } catch (e) {
    console.warn('Auto-scan trigger failed:', getErrorMessage(e));
  }
}

async function scheduleAutoScanFromSettings(settings?: Settings) {
  clearAutoScanTimers();
  const s = settings || await getSettings();
  if (!s?.autoScanEnabled) return;
  const mode = (s.autoScanMode === 'daily' || s.autoScanMode === 'interval') ? s.autoScanMode : 'interval';
  if (mode === 'interval') {
    const minutes = s.autoScanIntervalMinutes ?? 0;
    const ms = Math.max(1, minutes) * 60 * 1000; // minimum 1 minute
    autoScanIntervalHandle = setInterval(() => { runAutoScanIfIdle(); }, ms);
  } else {
    const timeZone = s.timeZone && isValidTimeZone(s.timeZone) ? s.timeZone : resolveTimeZone();
    const delay = msUntilNextDaily(s.autoScanDailyTime || '02:00', timeZone);
    const scheduleNext = async () => {
      try { await runAutoScanIfIdle(); } finally {
        try {
          const ns = await getSettings();
          if (ns.autoScanEnabled && ns.autoScanMode === 'daily') {
            const nextTimeZone = ns.timeZone && isValidTimeZone(ns.timeZone) ? ns.timeZone : resolveTimeZone();
            const d = msUntilNextDaily(ns.autoScanDailyTime || '02:00', nextTimeZone);
            autoScanDailyHandle = setTimeout(scheduleNext, Math.max(60 * 1000, d));
          }
        } catch {
          autoScanDailyHandle = setTimeout(scheduleNext, 24 * 60 * 60 * 1000);
        }
      }
    };
    autoScanDailyHandle = setTimeout(scheduleNext, Math.max(60 * 1000, delay));
  }
}

const sanitizePathInput = (p: unknown) => {
  if (!p) return '';
  let s = String(p).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
};

async function normalizeStartPaths(rawPaths: string[] = []) {
  const cleaned = rawPaths.map(sanitizePathInput).filter(Boolean);
  const allowedRoots = await getAllowedRoots();
  if (!cleaned.length) {
    return { startPaths: [], allowedRoots };
  }
  const startPaths: string[] = [];
  for (const inputPath of cleaned) {
    const abs = resolvePathSafe(inputPath);
    await ensurePathAllowed(abs, {
      allowedRoots,
      statusCode: 400,
      message: `Path ${inputPath} is not within allowed library directories. Add it in Settings → Library Paths first.`,
    });
    startPaths.push(abs);
  }
  return { startPaths, allowedRoots };
}

// Create a scan job from request query/body paths and settings
async function prepareScanParamsFromRequest(req: Request) {
  const settings = await getSettings();
  const qp = req.query || {};
  const qPaths = toArrayParam(qp.path);
  let rawPaths: string[] = qPaths;
  if (rawPaths.length === 0) {
    if (Array.isArray(settings.defaultScanPaths) && settings.defaultScanPaths.length) rawPaths = settings.defaultScanPaths;
  }
  const { startPaths, allowedRoots } = await normalizeStartPaths(rawPaths);
  const language = toStringParam(qp.language) || 'ja-jp';
  const dryRun = parseBooleanParam(qp.dryRun, false);
  const newOnly = parseBooleanParam(qp.newOnly, true);
  const metadataOnly = parseBooleanParam(qp.metadataOnly, false);
  return { startPaths, allowedRoots, language, dryRun, newOnly, metadataOnly };
}

// Settings
app.get('/api/settings', async (_req, res) => {
  const s = await getSettings();
  // Prevent caches (including service workers/reverse proxies) from caching settings
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json(s);
});

app.put('/api/settings', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Partial<Settings>;
    const out: Settings = {};
    if (typeof body.autoplayFolder === 'boolean') {
      out.autoplayFolder = body.autoplayFolder;
    }
    if (Array.isArray(body.defaultScanPaths)) {
      // Limit number of scan paths to prevent DoS
      if (body.defaultScanPaths.length > 50) {
        return res.status(400).json({ error: 'Too many scan paths (maximum 50)' });
      }
      const normalized = body.defaultScanPaths
        .map((p) => sanitizePathInput(p))
        .filter(Boolean)
        .map(p => resolvePathSafe(p));
      out.defaultScanPaths = Array.from(new Set(normalized));
    }
    // Scraper proxy settings (optional)
    if (typeof body.httpProxyHost === 'string') {
      out.httpProxyHost = body.httpProxyHost.trim();
    }
    if (body.httpProxyPort !== undefined) {
      if (typeof body.httpProxyPort !== 'number' || !Number.isInteger(body.httpProxyPort) || body.httpProxyPort < 0 || body.httpProxyPort > 65535) {
        return res.status(400).json({ error: 'Invalid proxy port' });
      }
      out.httpProxyPort = body.httpProxyPort;
    }
    if (typeof body.httpProxyUsername === 'string') {
      out.httpProxyUsername = body.httpProxyUsername.trim();
    }
    if (typeof body.httpProxyPassword === 'string') {
      out.httpProxyPassword = body.httpProxyPassword;
    }
    if (typeof body.httpProxyEnabled === 'boolean') {
      out.httpProxyEnabled = body.httpProxyEnabled;
    }
    // Auto-scan settings (optional)
    if (typeof body.autoScanEnabled === 'boolean') out.autoScanEnabled = body.autoScanEnabled;
    if (typeof body.autoScanMode === 'string' && (body.autoScanMode === 'interval' || body.autoScanMode === 'daily')) {
      out.autoScanMode = body.autoScanMode;
    }
    if (body.autoScanIntervalMinutes !== undefined) {
      if (typeof body.autoScanIntervalMinutes !== 'number' || !Number.isInteger(body.autoScanIntervalMinutes) || body.autoScanIntervalMinutes < 1) {
        return res.status(400).json({ error: 'Invalid auto-scan interval' });
      }
      out.autoScanIntervalMinutes = body.autoScanIntervalMinutes;
    }
    if (typeof body.autoScanDailyTime === 'string') {
      const t = body.autoScanDailyTime.trim();
      if (/^\d{1,2}:\d{2}$/.test(t)) out.autoScanDailyTime = t;
    }
    if (typeof body.timeZone === 'string') {
      const timeZone = body.timeZone.trim();
      if (!isValidTimeZone(timeZone)) {
        return res.status(400).json({ error: 'Invalid timezone' });
      }
      out.timeZone = timeZone;
    }
    if (body.serverLogLevels !== undefined) {
      if (!Array.isArray(body.serverLogLevels) || !body.serverLogLevels.every(isLogLevel)) {
        return res.status(400).json({ error: 'Invalid server log levels' });
      }
      out.serverLogLevels = Array.from(new Set(body.serverLogLevels));
    }
    const saved = await updateSettings(out);
    applyServerLogLevels(saved.serverLogLevels);
    // Re-schedule background auto-scan using the latest settings
    try { await scheduleAutoScanFromSettings(saved) } catch { }
    res.json(saved);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: getErrorMessage(e) || 'Failed to update settings' });
  }
});

app.post('/api/settings/proxy-check', async (_req, res) => {
  const result = {
    ip: { ok: false, address: '', error: undefined as string | undefined },
    dlsite: { ok: false, status: undefined as number | undefined, error: undefined as string | undefined },
    checkedAt: new Date().toISOString(),
  };

  try {
    const response = await axios.get<string>('https://ipconfig.org', {
      timeout: 8000,
      responseType: 'text',
      transformResponse: [(data) => data],
      validateStatus: (status) => status >= 200 && status < 500,
    });
    const address = extractIpAddress(response.data);
    result.ip.ok = !!address;
    result.ip.address = address;
    if (!address) result.ip.error = 'ipconfig.org returned an empty response';
  } catch (e) {
    result.ip.error = getErrorMessage(e);
  }

  try {
    const response = await axios.get<string>('https://www.dlsite.com/', {
      timeout: 8000,
      responseType: 'text',
      validateStatus: () => true,
    });
    result.dlsite.status = response.status;
    result.dlsite.ok = response.status >= 200 && response.status < 500;
    if (!result.dlsite.ok) result.dlsite.error = `DLsite returned HTTP ${response.status}`;
  } catch (e) {
    result.dlsite.status = getHttpStatusFromError(e);
    result.dlsite.error = getErrorMessage(e);
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ...result,
    ok: result.ip.ok && result.dlsite.ok,
  });
});

// Server logs endpoint (SSE stream) with improved cleanup
app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const includeHistory = parseBooleanParam(req.query.history, true);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    logEmitter.off('log', onLog);
    try { res.end(); } catch { }
  };

  // Optionally send existing logs
  if (includeHistory) {
    for (const log of serverLogs) {
      try {
        res.write(`data: ${JSON.stringify(log)} \n\n`);
      } catch (_e) {
        cleanup();
        return;
      }
    }
  }

  // Listen for new logs
  const onLog = (log: LogEntry) => {
    try {
      res.write(`data: ${JSON.stringify(log)} \n\n`);
    } catch (_e) {
      cleanup(); // Clean up on write error
    }
  };
  logEmitter.on('log', onLog);

  req.on('close', cleanup);
  req.on('error', cleanup);
});

// Get recent logs (REST endpoint)
app.get('/api/logs', (req, res) => {
  const limitParam = toStringParam(req.query.limit);
  const limit = parseInt(limitParam || '100', 10) || 100;
  const logs = serverLogs.slice(-Math.min(limit, MAX_LOGS));
  res.json({ logs });
});

app.use(libraryRoutes);

// Get work details
app.get('/api/works/:id', async (req, res) => {
  const w = await getWork(req.params.id);
  if (!w) return res.status(404).json({ error: 'Not found' });
  res.json(w);
});

// Update work metadata
// body can include: title, circle, ageRating (or legacy nsfw), release, series,
// tags (array), vas (array), stats (object), base_dir, cover_path
app.put('/api/works/:id', async (req, res) => {
  const existing = await getWork(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  try {
    const p = req.body || {};
    if (p.ageRating !== undefined && p.ageRating !== 'sfw' && p.ageRating !== 'r15' && p.ageRating !== 'r18') {
      return res.status(400).json({ error: 'ageRating must be "sfw", "r15", or "r18"' });
    }
    let nextBaseDir = existing.base_dir;
    if (p.base_dir !== undefined) {
      const rawBase = p.base_dir;
      if (rawBase === null || rawBase === '') {
        nextBaseDir = null;
      } else if (typeof rawBase === 'string') {
        const candidate = resolvePathSafe(rawBase);
        await ensurePathAllowed(candidate, {
          statusCode: 400,
          message: 'base_dir must be inside allowed library directories. Add it in Settings → Library Paths first.',
        });
        nextBaseDir = candidate;
      }
    }

    let nextCoverPath = existing.cover_path;
    if (p.cover_path !== undefined) {
      const rawCover = p.cover_path;
      if (rawCover === null || rawCover === '') {
        nextCoverPath = null;
      } else if (typeof rawCover === 'string') {
        const candidate = resolvePathSafe(rawCover);
        await ensurePathAllowed(candidate, {
          allowedRoots: [COVER_DIR],
          statusCode: 400,
          message: 'cover_path must be inside the server cover directory.',
        });
        nextCoverPath = candidate;
      }
    }

    const updated = {
      ...existing,
      title: p.title ?? existing.title,
      circle: { name: p.circle?.name ?? existing.circle?.name ?? '' },
      ageRating: p.ageRating ?? (typeof p.nsfw === 'boolean' ? (p.nsfw ? 'r18' : 'sfw') : existing.ageRating),
      release: p.release ?? existing.release,
      series: p.series === null
        ? undefined
        : { name: p.series?.name ?? existing.series?.name },
      tags: Array.isArray(p.tags) ? p.tags : existing.tags,
      vas: Array.isArray(p.vas) ? p.vas : existing.vas,
      stats: p.stats ? { ...existing.stats, ...p.stats } : existing.stats,
      base_dir: nextBaseDir,
      cover_path: nextCoverPath,
    };
    const saved = await upsertWork(updated);
    res.json(saved);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: getErrorMessage(e) || 'Update failed' });
  }
});

// Import from DLsite by RJ id
// body: { id: number|string, language?: 'ja-jp'|'zh-tw'|'zh-cn', mediaPath?: string, coverPath?: string, forceCoverRefresh?: boolean }
app.post('/api/import/dlsite', async (req, res) => {
  try {
    const { id, language = 'ja-jp', mediaPath, coverPath } = req.body || {};
    const forceCoverRefresh = parseBooleanParam(req.body?.forceCoverRefresh, false);
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const allowedRoots = await getAllowedRoots();
    const saved = await importWorkFromDLsite({ id, language, mediaPath, coverPath, allowedRoots, forceCoverRefresh });
    res.json(saved);
  } catch (err) {
    console.error(err);
    const status = getPathErrorStatus(err);
    res.status(status).json({ error: getErrorMessage(err) || 'Import failed' });
  }
});

// Attach media files to an existing work
// body: { files: string[] }
app.post('/api/works/:id/media', async (req, res) => {
  const w = await getWork(req.params.id);
  if (!w) return res.status(404).json({ error: 'Not found' });
  try {
    const allowedRoots = await getAllowedRoots();
    const files: unknown = req.body?.files;
    if (!Array.isArray(files) || files.some(entry => typeof entry !== 'string' || !entry)) {
      return res.status(400).json({ error: 'files must be an array of file paths' });
    }
    const resolvedPaths: string[] = [];
    for (const input of files as string[]) {
      const abs = resolvePathSafe(input);
      await ensurePathAllowed(abs, {
        allowedRoots,
        statusCode: 400,
        message: `File ${input} is not within allowed library directories.Add it in Settings → Library Paths first.`,
      });
      resolvedPaths.push(abs);
    }
    const newMedia = resolvedPaths
      .filter(p => fs.existsSync(p) && fs.statSync(p).isFile() && isAudioFile(p))
      .map(toAudioMediaFile);
    const updated = await attachMedia(w.id, newMedia);
    res.json(updated);
  } catch (e) {
    const status = getPathErrorStatus(e);
    res.status(status).json({ error: getErrorMessage(e) || 'Failed to attach media' });
  }
});

// Align file path for a single work
app.post('/api/works/:id/align', async (req, res) => {
  try {
    const w = await getWork(req.params.id);
    if (!w) return res.status(404).json({ error: 'Not found' });

    const settings = await getSettings();
    const scanPaths = (settings.defaultScanPaths || []).filter(p => p?.trim());
    if (scanPaths.length === 0) {
      return res.status(400).json({ error: 'No scan paths configured in settings' });
    }

    const rjcode = w.rjcode || w.id;
    const normalized = formatID(rjcode);

    // Scan all paths to find the work using same logic as regular scan
    const safeScanPaths = scanPaths.map(p => resolvePathSafe(p));
    const { folderMatch, fileMatch } = await findWorkInScanPaths(safeScanPaths, normalized);

    const newPath = folderMatch || fileMatch;

    let currentPathExists = false;
    if (w.base_dir) {
      try {
        currentPathExists = fs.existsSync(w.base_dir) && fs.statSync(w.base_dir).isDirectory();
      } catch { }
    }

    let newPathExists = false;
    if (newPath) {
      try {
        newPathExists = fs.existsSync(newPath) && fs.statSync(newPath).isDirectory();
      } catch { }
    }

    const smbIssue = (!currentPathExists && w.base_dir && inspectListedButInaccessiblePath(w.base_dir))
      || (!newPathExists && newPath && inspectListedButInaccessiblePath(newPath));
    if (smbIssue) {
      const coverRestored = restoreManagedCoverLink(w);
      const saved = coverRestored ? await upsertWork(w) : w;
      return res.json({
        ...saved,
        aligned: false,
        repairRequired: true,
        issueCode: SMB_FILENAME_UNREACHABLE,
        currentPath: w.base_dir,
        inaccessiblePath: smbIssue.path,
        suggestedPath: smbIssue.suggestedPath,
        coverRestored,
        message: describeInaccessibleSmbPath(smbIssue),
      });
    }

    if (!newPath || !newPathExists) {
      if (!currentPathExists) {
        return res.status(404).json({
          error: 'Work files not found in any scan path',
          currentPath: w.base_dir,
          currentPathExists: false
        });
      }
      const coverRestored = restoreManagedCoverLink(w);
      const saved = coverRestored ? await upsertWork(w) : w;
      return res.json({ ...saved, aligned: false, coverRestored, message: 'Path unchanged (already in scan path)' });
    }

    if (newPath === w.base_dir) {
      const coverRestored = restoreManagedCoverLink(w);
      const saved = coverRestored ? await upsertWork(w) : w;
      return res.json({ ...saved, aligned: false, coverRestored, message: 'Path unchanged (already correct)' });
    }

    // Update the work with the new path
    const updated = {
      ...w,
      base_dir: newPath
    };
    const coverRestored = restoreManagedCoverLink(updated);

    // Rescan media files in the new location (same logic as import)
    if (fs.existsSync(newPath)) {
      updated.media = scanAudioMedia(newPath).media;
    }

    const saved = await upsertWork(updated);
    res.json({ ...saved, aligned: true, coverRestored });
  } catch (e) {
    console.error('Alignment error:', e);
    res.status(500).json({ error: getErrorMessage(e) || 'Alignment failed' });
  }
});

// Stream cover image
app.get('/cover/:id', auth.requireAuth, async (req, res) => {
  const workId = toStringParam(req.params.id);
  if (!workId) return res.status(400).json({ error: 'Missing id' });
  const w = await getWork(workId);
  if (!w?.cover_path) return res.status(404).end();
  const coverRoot = COVER_DIR;
  if (!isPathWithinAllowed(w.cover_path, [coverRoot])) {
    return res.status(403).json({ error: 'Cover path is outside the server cover directory. Re-upload the cover.' });
  }
  let opened: { fd: number; stat: fs.Stats };
  try {
    opened = openRegularFileNoFollow(w.cover_path, [coverRoot]);
  } catch {
    return res.status(404).end();
  }
  const { stat } = opened;
  const type = guessMimeType(w.cover_path) || 'image/jpeg';
  if (type === 'image/svg+xml') res.setHeader('Content-Security-Policy', "sandbox; script-src 'none'");
  const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;

  res.set({
    'Content-Type': type,
    'Content-Length': String(stat.size),
    'Cache-Control': 'private, no-cache',
    'ETag': etag,
  });

  // ETag handling for conditional requests
  if (ifNoneMatchMatches(req.headers['if-none-match'], etag)) {
    fs.closeSync(opened.fd);
    return res.status(304).end();
  }
  streamFileDescriptor(req, res, opened.fd);
});

// Upload a temporary cover image; returns an absolute server path that can be
// supplied later to importWork({ coverPath }) when creating a work.
// POST /api/cover/temp?filename=name.jpg  body: raw bytes (not JSON)
app.post('/api/cover/temp', async (req, res) => {
  try {
    const finalExt = getCoverUploadExtension(req.query.filename);
    if (!finalExt) return res.status(400).json({ error: 'Unsupported or missing file extension' });
    const coverDir = ensureCoverDirExists();
    cleanupExpiredCoverFiles(coverDir, TEMP_COVER_TTL_MS);
    const tmp = path.join(coverDir, `temp-${Date.now()}-${Math.random().toString(36).slice(2)}${finalExt}`);
    await receiveValidatedImage(req, tmp, finalExt, MAX_COVER_BYTES);
    res.json({ path: tmp });
  } catch (e) {
    res.status(e instanceof UploadError ? e.statusCode : 500).json({ error: getErrorMessage(e) || 'Upload failed' });
  }
});

// Upload and set/replace the cover image for an existing work by id.
// POST /api/works/:id/cover?filename=name.jpg  body: raw bytes (not JSON)
app.post('/api/works/:id/cover', async (req, res) => {
  try {
    const w = await getWork(req.params.id);
    if (!w) return res.status(404).json({ error: 'Not found' });
    const finalExt = getCoverUploadExtension(req.query.filename);
    if (!finalExt) return res.status(400).json({ error: 'Unsupported or missing file extension' });
    const coverDir = ensureCoverDirExists();
    const dest = path.join(coverDir, `RJ${w.rjcode}${finalExt}`);
    await receiveValidatedImage(req, dest, finalExt, MAX_COVER_BYTES);
    w.cover_path = dest;
    const saved = await upsertWork(w);
    res.json(saved);
  } catch (e) {
    res.status(e instanceof UploadError ? e.statusCode : 500).json({ error: getErrorMessage(e) || 'Upload failed' });
  }
});

// Scan for works under one or more paths. Body: { path?: string|string[], language?: string, dryRun?: boolean }
app.post('/api/scan', async (req, res) => {
  try {
    const settings = await getSettings();
    const bodyPath = req.body?.path;
    let rawPaths: string[] = [];
    if (Array.isArray(bodyPath)) rawPaths = bodyPath;
    else if (typeof bodyPath === 'string' && bodyPath.trim().length) rawPaths = [bodyPath];
    else if (Array.isArray(settings.defaultScanPaths)) rawPaths = settings.defaultScanPaths;

    const { startPaths, allowedRoots } = await normalizeStartPaths(rawPaths);

    const language = typeof req.body?.language === 'string' ? req.body.language : 'ja-jp';
    const dryRun = parseBooleanParam(req.body?.dryRun, false);
    const newOnly = parseBooleanParam(req.body?.newOnly, true);
    const metadataOnly = parseBooleanParam(req.body?.metadataOnly, false);
    const mode = getScanMode(metadataOnly, newOnly);
    if (startPaths.length === 0) {
      return res.status(400).json({ error: 'No scan paths set. Provide path or configure defaultScanPaths in settings.' });
    }

    const { candidates, invalidPaths } = await discoverScanCandidates(startPaths);
    const list = await selectScanCandidates(candidates, { metadataOnly, newOnly });
    const importOptions: ScanCandidateImportOptions = {
      language,
      metadataOnly,
      newOnly,
      allowedRoots,
    };

    if (dryRun) {
      return res.json({ paths: startPaths, invalidPaths, found: list, mode });
    }

    const imported: { id: string | number; title: string | null; mediaPath: string; retried?: number }[] = [];
    let failures: { id: string; mediaPath: string; error: string; attempt?: number }[] = [];
    for (const c of list) {
      try {
        const saved = await importScanCandidate(c, importOptions);
        imported.push({ id: saved.id, title: saved.title, mediaPath: c.mediaPath });
      } catch (e) {
        failures.push({ id: c.id, mediaPath: c.mediaPath, error: getErrorMessage(e) });
      }
    }

    // Retry failed tasks up to 3 times with 10s delay between attempts
    for (let attempt = 1; attempt <= 3 && failures.length > 0; attempt++) {
      await sleep(10000);
      const nextFailures: { id: string; mediaPath: string; error: string; attempt?: number }[] = [];
      for (const f of failures) {
        try {
          const saved = await importScanCandidate(f, importOptions);
          imported.push({ id: saved.id, title: saved.title, mediaPath: f.mediaPath, retried: attempt });
        } catch (e) {
          nextFailures.push({ id: f.id, mediaPath: f.mediaPath, error: getErrorMessage(e), attempt });
        }
      }
      failures = nextFailures;
    }

    // After imports, clear covers for works whose media directories disappeared.
    const invalidUpdated = metadataOnly ? [] : await markInvalidCoversUnderPaths(startPaths, candidates);
    try { await updateSettings({ lastScanAt: new Date().toISOString() }); } catch { }
    res.json({ paths: startPaths, invalidPaths, imported, errors: failures, invalidUpdated, mode });
  } catch (e) {
    console.error(e);
    const err = e as { statusCode?: number; code?: string };
    const status = err.statusCode || (err.code === 'PATH_NOT_ALLOWED' ? 400 : 500);
    res.status(status).json({ error: getErrorMessage(e) || 'Scan failed' });
  }
});

// Scan with progress via Server-Sent Events (SSE), decoupled from client connection
// Query params: path (repeatable), language, dryRun
app.get('/api/scan/stream', async (req, res) => {
  try {
    const params = await prepareScanParamsFromRequest(req);
    if (params.startPaths.length === 0) {
      return sendSseError(res, 'No scan paths set. Provide path or configure defaultScanPaths in settings.');
    }

    // If an active scan exists and not a dryRun, attach to it; otherwise start new
    const job = (!params.dryRun && getActiveScan()) || startScanJob(params);

    streamScanJob(req, res, job);
  } catch (e) {
    sendSseError(res, getErrorMessage(e) || 'Scan failed');
  }
});

// Start a scan job explicitly and get a job id back
app.post('/api/scan/start', async (req, res) => {
  try {
    const params = await prepareScanParamsFromRequest(req);
    if (params.startPaths.length === 0) return res.status(400).json({ error: 'No scan paths set' });
    const existing = !params.dryRun && getActiveScan();
    const job = existing || startScanJob(params);
    res.json({ jobId: job.id, status: job.status });
  } catch (e) {
    const status = getPathErrorStatus(e);
    res.status(status).json({ error: getErrorMessage(e) || 'Failed to start scan' });
  }
});

// Query active job id
app.get('/api/scan/active', (_req, res) => {
  const job = getActiveScan();
  res.json({ jobId: job ? job.id : null, status: job ? job.status : 'idle' });
});

// Stream an existing job by id
app.get('/api/scan/jobs/:id/stream', (req, res) => {
  const job = scanJobs.get(req.params.id);
  if (!job) return res.status(404).end();
  streamScanJob(req, res, job);
});

// Alignment scan: update file paths without dropping metadata
app.get('/api/scan/alignment', async (req, res) => {
  try {
    const settings = await getSettings();
    const defaults = Array.isArray(settings.defaultScanPaths) ? settings.defaultScanPaths : [];
    const { startPaths } = await normalizeStartPaths(defaults);
    if (startPaths.length === 0) {
      return sendSseError(res, 'No scan paths set. Configure defaultScanPaths in settings.');
    }

    const language = toStringParam(req.query.language) || 'ja-jp';
    const existing = getActiveScan();
    const job = existing || startAlignmentScan({ startPaths, language });

    streamScanJob(req, res, job, {
      closeAfterMs: process.env.NODE_ENV === 'test' ? 200 : undefined,
    });
  } catch (e) {
    sendSseError(res, getErrorMessage(e) || 'Alignment scan failed');
  }
});

// Delete a work entirely (DB only; media files on disk are untouched)
app.delete('/api/works/:id', async (req, res) => {
  const w = await getWork(req.params.id);
  if (!w) return res.status(404).json({ error: 'Not found' });
  try {
    await deleteWork(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: getErrorMessage(e) || 'Delete failed' });
  }
});

// Safe resolve helper to a path under work base_dir with improved security
app.use(fileRoutes);

// Static UI from client/dist if built
const builtClientDir = resolvePathSafe('client', 'dist');
if (fs.existsSync(builtClientDir)) {
  app.use('/', express.static(builtClientDir));
}

// SPA fallback: send index.html for client routes
// Ensures deep links like /search resolve to the React app in production
app.get(/.*/, (req, res, next) => {
  if (req.method !== 'GET') return next();
  const p = req.path || '';
  if (
    p.startsWith('/api') ||
    p.startsWith('/media') ||
    p.startsWith('/files') ||
    p.startsWith('/cover') ||
    p.startsWith('/favicon') ||
    p === '/apple-touch-icon.png' ||
    p === '/manifest.webmanifest' ||
    p === '/sw.js' ||
    p.startsWith('/workbox-') ||
    p === '/registerSW.js'
  ) return next();
  try {
    if (fs.existsSync(builtClientDir)) {
      const indexFile = path.join(builtClientDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        // Ensure the SPA shell is revalidated on each navigation so clients
        // fetch the latest asset manifest instead of using a stale cached HTML.
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.sendFile(indexFile);
      }
    }
  } catch { }
  return next();
});

// Only start the server if not in test mode (Vitest sets VITEST)
const IS_TEST = process.env.NODE_ENV === 'test' || process.env.VITEST;
if (!IS_TEST) {
  void startServer();
}

async function startServer(): Promise<void> {
  try {
    validateRuntimeStorage();
    cleanupExpiredCoverFiles(COVER_DIR, TEMP_COVER_TTL_MS);
    const settings = await getSettings();
    applyServerLogLevels(settings.serverLogLevels);
    await initializeDatabase();
    auth.initializeAccountSetup();
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(message.startsWith('[startup]') ? message : `[startup] Failed to initialize storage: ${message}`);
    process.exitCode = 1;
    return;
  }

  const server = app.listen(PORT, () => {
    console.log(`Nekomimi ASMR server listening on http://localhost:${PORT}`);
    // Initialize auto-scan schedule on boot
    scheduleAutoScanFromSettings().catch((error) => {
      console.error(`[startup] Failed to schedule automatic scans: ${getErrorMessage(error)}`);
    });
  });

  let isShuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals | string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`${signal} received. Closing server...`);

    // Stop in-flight imports before they can enter their final database write.
    serverLifetimeController.abort(new Error(`${signal} received`));
    beginDatabaseShutdown();

    // 1. Clear scheduled auto-scan timers
    clearAutoScanTimers();

    // 2. Clean up active scan jobs
    for (const [, job] of scanJobs) {
      job.emitter.removeAllListeners();
    }
    scanJobs.clear();
    activeScanId = null;

    // 3. Clean up log emitter
    logEmitter.removeAllListeners();

    // 4. Stop accepting requests and force close HTTP connections (Node 18.2+)
    const serverClosed = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }

    // 5. Let cancelled imports settle, then persist the last committed transaction.
    try {
      await Promise.allSettled(Array.from(activeImports));
      await flushDatabase();
      await serverClosed;
      console.log('Server closed.');
      process.exit(0);
    } catch (error) {
      console.error(`Shutdown failed: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

// Export for testing
export default app;

function importWorkFromDLsite(options: Omit<ImportWorkOptions, 'signal'> & { signal?: AbortSignal }): Promise<DbWork> {
  const task = performImportWorkFromDLsite({ ...options, signal: options.signal ?? serverLifetimeController.signal });
  activeImports.add(task);
  void task.then(
    () => activeImports.delete(task),
    () => activeImports.delete(task),
  );
  return task;
}
