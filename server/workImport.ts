import fs from 'node:fs';
import path from 'node:path';
import { formatID, resolvePathSafe } from '../filesystem/utils';
import { scrapeWorkMetadataFromDLsite } from '../scraper/dlsite';
import { scrapeWorkMetadataFromAsmrOne } from '../scraper/asmrOne';
import { scrapeWorkMetadataFromHVDB } from '../scraper/hvdb';
import type { ScrapedWorkMetadata } from '../scraper/types';
import { getWork, upsertWork, type DbWork } from './db';
import { ensurePathAllowed, staticRoots } from './pathGuard';
import { mergeScrapedMetadata } from './metadataMerge';
import { scanAudioMedia } from './libraryMedia';
import { updateWorkCover } from './workCovers';
import { getErrorMessage } from './requestUtils';

async function scrapeMetadataWithFallback(numericId: number, idDigits: string, language: string, signal: AbortSignal): Promise<ScrapedWorkMetadata> {
  const providers = [
    { name: 'DLsite', scrape: () => scrapeWorkMetadataFromDLsite(numericId, language, signal) },
    { name: 'ASMROne', scrape: () => scrapeWorkMetadataFromAsmrOne(numericId, language, signal) },
    { name: 'HVDB', scrape: () => scrapeWorkMetadataFromHVDB(numericId, signal) },
  ];
  console.log(`Scraping metadata for RJ${idDigits} from DLsite...`);
  for (const [index, provider] of providers.entries()) {
    signal.throwIfAborted();
    try {
      return await provider.scrape();
    } catch (error) {
      signal.throwIfAborted();
      const next = providers[index + 1];
      const message = `${provider.name} scrape failed for RJ${idDigits}: ${getErrorMessage(error)}.`;
      if (next) console.warn(`${message} Falling back to ${next.name}.`);
      else {
        console.error(`${message} All providers failed.`);
        throw error instanceof Error ? error : new Error('Failed to scrape metadata');
      }
    }
  }
  throw new Error('Failed to scrape metadata');
}

export type ImportWorkOptions = {
  id: string | number;
  language?: string;
  mediaPath?: string;
  coverPath?: string;
  allowedRoots?: string[] | null;
  forceCoverRefresh?: boolean;
  metadataOnly?: boolean;
  signal: AbortSignal;
};

// Shared import implementation used by routes and scanner
export async function performImportWorkFromDLsite({
  id,
  language = 'ja-jp',
  mediaPath,
  coverPath,
  allowedRoots = null,
  forceCoverRefresh = false,
  metadataOnly = false,
  signal,
}: ImportWorkOptions): Promise<DbWork> {
  signal.throwIfAborted();
  const idDigits = String(id).replace(/[^0-9]/g, '');
  if (!(idDigits.length === 6 || idDigits.length === 8)) {
    throw new Error('Invalid RJ id length: must be 6 or 8 digits');
  }
  const numericId = parseInt(idDigits, 10);
  const guardRoots = Array.isArray(allowedRoots) && allowedRoots.length
    ? Array.from(new Set([
      ...allowedRoots.map(p => path.resolve(p)),
      ...staticRoots.map(p => path.resolve(p)),
    ]))
    : null;

  // Validate file system inputs up-front so we fail fast before scraping
  let normalizedMediaPath: string | null = null;
  if (mediaPath && !metadataOnly) {
    normalizedMediaPath = resolvePathSafe(mediaPath);
    await ensurePathAllowed(normalizedMediaPath, {
      allowedRoots: guardRoots || undefined,
      statusCode: 400,
      message: 'Media path must be inside allowed library directories. Add it in Settings → Library Paths first.',
    });
  }

  let normalizedCoverPath: string | null = null;
  if (coverPath && !metadataOnly) {
    normalizedCoverPath = resolvePathSafe(coverPath);
    await ensurePathAllowed(normalizedCoverPath, {
      allowedRoots: guardRoots || undefined,
      statusCode: 400,
      message: 'Cover path must be inside allowed library directories. Add it in Settings → Library Paths first.',
    });
  }
  const shouldForceCoverRefresh = Boolean(forceCoverRefresh) && !normalizedCoverPath && !metadataOnly;

  const meta = await scrapeMetadataWithFallback(numericId, idDigits, language, signal);
  signal.throwIfAborted();
  const existingWork = await getWork(numericId);
  signal.throwIfAborted();
  if (metadataOnly && !existingWork) {
    throw new Error(`Metadata-only rescrape requires an existing work: RJ${idDigits}`);
  }
  const mergedMeta = mergeScrapedMetadata(meta, existingWork);
  const work: DbWork = {
    id: existingWork?.id ?? numericId,
    rjcode: formatID(idDigits),
    title: mergedMeta.title,
    circle: mergedMeta.circle,
    nsfw: mergedMeta.nsfw,
    ageRating: mergedMeta.ageRating,
    release: mergedMeta.release,
    series: mergedMeta.series,
    tags: mergedMeta.tags,
    vas: mergedMeta.vas,
    stats: mergedMeta.stats,
    media: existingWork?.media.map(m => ({ filename: m.filename, filepath: m.filepath, mime: m.mime })) || [],
    base_dir: existingWork?.base_dir || null,
    cover_path: existingWork?.cover_path || null,
  };

  if (shouldForceCoverRefresh && work.cover_path) {
    console.log(`[RJ${work.rjcode}] Forcing cover refresh for rescan.`);
    work.cover_path = null;
  }

  // If mediaPath provided, attach audio files under that directory (non-recursive for now)
  if (!metadataOnly && normalizedMediaPath) {
    signal.throwIfAborted();
    const abs = normalizedMediaPath;
    if (fs.existsSync(abs)) {
      const scanned = scanAudioMedia(abs);
      work.base_dir = scanned.baseDir;
      work.media = scanned.media;
    }
  }

  if (!metadataOnly) {
    await updateWorkCover(work, meta, { idDigits, coverPath: normalizedCoverPath, allowedRoots: guardRoots, signal });
  }

  signal.throwIfAborted();
  const saved = await upsertWork(work, { preserveUpdatedAt: metadataOnly });
  if (!saved) throw new Error('Failed to save work');
  return saved;
}
