import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { isImageFile, resolvePathSafe } from '../filesystem/utils';
import axios from '../scraper/axios';
import type { ScrapedWorkMetadata } from '../scraper/types';
import type { DbWork } from './db';
import { getAllowedRoots } from './pathGuard';
import { getErrorMessage } from './requestUtils';
import { detectImageExtension, imageExtensionMatches, isAllowedRemoteCoverUrl, readValidatedImage, writeFileAtomically, type ImageExtension } from './httpSecurity';

const COVER_DIR = resolvePathSafe(config.coverDir);
const MAX_COVER_BYTES = config.maxCoverBytes;

export function ensureCoverDirExists(): string {
  try {
    if (!fs.existsSync(COVER_DIR)) fs.mkdirSync(COVER_DIR, { recursive: true });
    fs.accessSync(COVER_DIR, fs.constants.W_OK);
    return COVER_DIR;
  } catch (e) {
    throw new Error(`Cover directory is not writable (${COVER_DIR}): ${getErrorMessage(e)}`);
  }
}

function copyLocalCover(work: DbWork, source: string, allowedRoots: string[]): boolean {
  try {
    const directory = ensureCoverDirExists();
    const { body, extension } = readValidatedImage(source, MAX_COVER_BYTES, allowedRoots);
    const destination = path.join(directory, `RJ${work.rjcode}${extension}`);
    writeFileAtomically(destination, body);
    work.cover_path = destination;
    return true;
  } catch (error) {
    console.warn('Failed to copy local cover image:', getErrorMessage(error));
    return false;
  }
}

function copyDiscoveredCover(work: DbWork): void {
  if (!work.base_dir) return;
  try {
    const candidates: string[] = [];
    const coverDir = path.join(work.base_dir, 'cover');
    if (fs.existsSync(coverDir) && fs.statSync(coverDir).isDirectory()) {
      for (const filename of fs.readdirSync(coverDir)) candidates.push(path.join(coverDir, filename));
    }
    for (const filename of fs.readdirSync(work.base_dir)) {
      if (/^(cover|folder|poster)\./i.test(filename)) candidates.push(path.join(work.base_dir, filename));
    }
    for (const candidate of candidates.filter(isImageFile)) {
      if (copyLocalCover(work, candidate, [work.base_dir])) break;
    }
  } catch { }
}

function normalizeRemoteImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/&amp;/g, '&');
  if (!raw) return null;
  if (/^https:\/\//i.test(raw) && isAllowedRemoteCoverUrl(raw)) return raw;
  if (raw.startsWith('//')) {
    const normalized = `https:${raw}`;
    return isAllowedRemoteCoverUrl(normalized) ? normalized : null;
  }
  return null;
}

function inferExtFromMime(mimeType: string): ImageExtension | null {
  if (mimeType.includes('image/jpeg')) return '.jpg';
  if (mimeType.includes('image/png')) return '.png';
  if (mimeType.includes('image/webp')) return '.webp';
  return null;
}
function isDlsiteHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().includes('dlsite.');
  } catch {
    return false;
  }
}

function getRemoteCoverCandidates(metadata: ScrapedWorkMetadata, idDigits: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    const normalized = normalizeRemoteImageUrl(v);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      candidates.push(normalized);
    }
  };
  push(metadata.cover_url);
  // Additional cover URL patterns that might exist in extended responses
  const extMeta = metadata as ScrapedWorkMetadata & { coverUrl?: string; cover?: string; mainCoverUrl?: string; thumbnailCoverUrl?: string; samCoverUrl?: string; image?: string; images?: { cover?: string; main?: string; large?: string } };
  push(extMeta.coverUrl);
  push(extMeta.cover);
  // ASMROne specific fields
  push(extMeta.mainCoverUrl);
  push(extMeta.thumbnailCoverUrl);
  push(extMeta.samCoverUrl);
  push(extMeta.image);
  if (extMeta.images && typeof extMeta.images === 'object') {
    push(extMeta.images.cover);
    push(extMeta.images.main);
    push(extMeta.images.large);
  }
  // Heuristics for ASMROne cover endpoint
  const asmrBase = 'https://api.asmr-200.com/api/cover';
  const idNoPad = String(parseInt(idDigits, 10));
  const idPad = idDigits; // possibly with leading zero
  ['main', 'thumb'].forEach((type) => {
    push(`${asmrBase}/${idNoPad}.jpg?type=${type}`);
    push(`${asmrBase}/${idPad}.jpg?type=${type}`);
  });
  return candidates;
}

async function downloadCover(work: DbWork, metadata: ScrapedWorkMetadata, idDigits: string, signal: AbortSignal): Promise<void> {
  const candidates = getRemoteCoverCandidates(metadata, idDigits);
  let targetDir: string;
  try {
    targetDir = ensureCoverDirExists();
  } catch (e) {
    console.warn(`[RJ${work.rjcode}] Cover download skipped: ${getErrorMessage(e)}`);
    return;
  }
  const attemptErrors: string[] = [];
  for (const url of candidates) {
    try {
      const requestHeaders: Record<string, string> = {
        'accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      };
      if (isDlsiteHost(url)) {
        requestHeaders.cookie = 'locale=ja-jp';
        requestHeaders.referer = `https://www.dlsite.com/maniax/work/=/product_id/RJ${idDigits}.html`;
        requestHeaders['user-agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
      }
      const response = await axios.retryGet<ArrayBuffer>(url, {
        retry: {},
        responseType: 'arraybuffer',
        maxContentLength: MAX_COVER_BYTES,
        maxBodyLength: MAX_COVER_BYTES,
        maxRedirects: 0,
        headers: requestHeaders,
        signal,
      });
      const body = Buffer.from(response.data);
      if (body.length === 0 || body.length > MAX_COVER_BYTES) {
        throw new Error(`Cover exceeds the ${MAX_COVER_BYTES}-byte limit or is empty.`);
      }
      const headerContentType = response.headers?.['content-type'];
      const contentType = Array.isArray(headerContentType)
        ? String(headerContentType[0] || '').toLowerCase()
        : String(headerContentType || '').toLowerCase();
      const extFromMime = inferExtFromMime(contentType);
      const detectedExtension = detectImageExtension(body);
      if (contentType && !contentType.startsWith('image/')) {
        throw new Error(`Non-image content type: ${contentType || 'unknown'}`);
      }
      if (!detectedExtension) {
        throw new Error('Unable to verify downloaded cover as an image.');
      }
      if (extFromMime && !imageExtensionMatches(extFromMime, detectedExtension)) {
        throw new Error('Downloaded cover content does not match its content type.');
      }
      const filename = `RJ${work.rjcode}${detectedExtension}`;
      const dest = path.join(targetDir, filename);
      writeFileAtomically(dest, body);
      work.cover_path = dest;
      break;
    } catch (e) {
      signal.throwIfAborted();
      attemptErrors.push(`${url} -> ${getErrorMessage(e)}`);
    }
  }
  if (!work.cover_path && attemptErrors.length) {
    console.warn(`[RJ${work.rjcode}] Failed to fetch cover into "${targetDir}". Tried ${candidates.length} URL(s).`, attemptErrors.slice(0, 5));
  }
}

export async function updateWorkCover(
  work: DbWork,
  metadata: ScrapedWorkMetadata,
  { idDigits, coverPath, allowedRoots, signal }: { idDigits: string; coverPath: string | null; allowedRoots: string[] | null; signal: AbortSignal },
): Promise<void> {
  signal.throwIfAborted();
  if (!coverPath) copyDiscoveredCover(work);
  else if (fs.existsSync(coverPath) && fs.statSync(coverPath).isFile() && isImageFile(coverPath)) {
    const copied = copyLocalCover(work, coverPath, allowedRoots || await getAllowedRoots());
    // Keep a failed temporary upload so that it can be retried or inspected.
    if (copied && path.dirname(coverPath) === COVER_DIR && path.basename(coverPath).startsWith('temp-')) {
      try { fs.unlinkSync(coverPath); } catch { }
    }
  }
  signal.throwIfAborted();
  if (!work.cover_path) await downloadCover(work, metadata, idDigits, signal);
}
