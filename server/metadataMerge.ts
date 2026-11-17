import type { DbWork } from './db';
import type { ScrapedWorkMetadata } from '../scraper/types';

type MergedWorkMetadata = Pick<DbWork, 'title' | 'circle' | 'ageRating' | 'nsfw' | 'release' | 'series' | 'tags' | 'vas' | 'stats'>;

const hasOwn = (obj: object, key: PropertyKey) => Object.hasOwn(obj, key);

function normalizeText(value: unknown): string {
  return (typeof value === 'string' ? value.trim() : '');
}

function pickText(value: unknown, fallback: unknown, defaultValue = ''): string {
  const next = normalizeText(value);
  if (next) return next;
  const existing = normalizeText(fallback);
  if (existing) return existing;
  return defaultValue;
}

function pickArray<T>(value: unknown, fallback: T[] | undefined): T[] {
  if (Array.isArray(value) && value.length > 0) return value as T[];
  if (Array.isArray(fallback) && fallback.length > 0) return [...fallback];
  return Array.isArray(value) ? [] : (Array.isArray(fallback) ? [...fallback] : []);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toFiniteInt(value: unknown): number | undefined {
  const parsed = toFiniteNumber(value);
  return parsed === undefined ? undefined : Math.trunc(parsed);
}

function pickSeries(meta: ScrapedWorkMetadata, existing: DbWork | null): { name: string | null } | undefined {
  const seriesName = pickText(meta.series?.name, existing?.series?.name, '');
  return seriesName ? { name: seriesName } : undefined;
}

export function mergeScrapedMetadata(meta: ScrapedWorkMetadata, existing: DbWork | null): MergedWorkMetadata {
  const ageRating = meta.ageRating ?? (typeof meta.nsfw === 'boolean' ? (meta.nsfw ? 'r18' : 'sfw') : existing?.ageRating ?? 'sfw');
  const dlCount = toFiniteInt(meta.dl_count);
  const rateAverage = toFiniteNumber(meta.rate_average_2dp);
  const rateCount = toFiniteInt(meta.rate_count);
  const reviewCount = toFiniteInt(meta.review_count);
  const rank = pickArray(meta.rank, existing?.stats.rank);

  const rateCountDetail = hasOwn(meta as object, 'rate_count_detail')
    ? (meta.rate_count_detail ?? null)
    : (existing?.stats.rate_count_detail ?? null);

  return {
    title: pickText(meta.title, existing?.title, ''),
    circle: { name: pickText(meta.circle?.name, existing?.circle?.name, '') || null },
    ageRating,
    nsfw: ageRating === 'r18',
    release: pickText(meta.release, existing?.release, ''),
    series: pickSeries(meta, existing),
    tags: pickArray(meta.tags, existing?.tags),
    vas: pickArray(meta.vas, existing?.vas),
    stats: {
      dl_count: dlCount ?? existing?.stats.dl_count ?? 0,
      rate_average_2dp: rateAverage ?? existing?.stats.rate_average_2dp ?? 0,
      rate_count: rateCount ?? existing?.stats.rate_count ?? 0,
      review_count: reviewCount ?? existing?.stats.review_count ?? 0,
      rank,
      rate_count_detail: rateCountDetail,
    },
  };
}
