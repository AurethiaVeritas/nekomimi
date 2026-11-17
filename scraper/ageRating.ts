import type { AgeRating } from '../types/shared';

/** DLsite and ASMROne expose numeric and/or text age categories. */
export function parseSourceAgeRating(value: unknown): AgeRating | undefined {
  if (value === 1) return 'sfw';
  if (value === 2) return 'r15';
  if (value === 3) return 'r18';
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]/g, '');
  if (normalized === '1' || normalized === 'general' || normalized === 'allages' || normalized === 'sfw') return 'sfw';
  if (normalized === '2' || normalized === 'r15') return 'r15';
  if (normalized === '3' || normalized === 'r18' || normalized === 'adult' || normalized === 'nsfw') return 'r18';
  return undefined;
}
