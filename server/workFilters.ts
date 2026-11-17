import type { ParamsObject } from 'sql.js';
import type { AgeRating } from '../types/shared';

export const ALL_AGE_RATINGS: AgeRating[] = ['sfw', 'r15', 'r18'];

export function buildAgeRatingFilter(
  { nsfw, ageRatings }: { nsfw?: string; ageRatings?: AgeRating[] },
): { clause: string; params: ParamsObject } {
  const ratings = ageRatings ?? (nsfw === 'nsfw' || nsfw === 'r18' ? ['r18'] : nsfw === 'sfw' || nsfw === 'r15' ? [nsfw] : ALL_AGE_RATINGS);
  if (ratings.length === 0) return { clause: '0 = 1', params: {} };
  if (ratings.length >= ALL_AGE_RATINGS.length) return { clause: '', params: {} };
  const params: ParamsObject = {};
  const placeholders = ratings.map((rating, index) => {
    const key = `$ageRating${index}`;
    params[key] = rating;
    return key;
  });
  return { clause: `works.age_rating IN (${placeholders.join(', ')})`, params };
}

export const normalizeValue = (value: unknown) => String(value || '').trim().toLowerCase();

export type WorksFilterOptions = {
  q?: string;
  nsfw?: string;
  ageRatings?: AgeRating[];
  circles?: string[];
  tags?: string[];
  vas?: string[];
};

export function buildWorksFilter({ q, nsfw, ageRatings, circles = [], tags = [], vas = [] }: WorksFilterOptions) {
  const clauses: string[] = [];
  const params: ParamsObject = {};

  const ratingFilter = buildAgeRatingFilter({ nsfw, ageRatings });
  if (ratingFilter.clause) clauses.push(ratingFilter.clause);
  Object.assign(params, ratingFilter.params);

  const normalizedCircles = circles.map(normalizeValue).filter(Boolean);
  if (normalizedCircles.length) {
    const placeholders = normalizedCircles.map((_, idx) => `$circle${idx}`);
    normalizedCircles.forEach((value, idx) => { params[`$circle${idx}`] = value; });
    clauses.push(`NORMALIZE_TEXT(works.circle_name) IN (${placeholders.join(', ')})`);
  }

  const addJsonFilter = (column: string, values: string[], label: string) => {
    const normalized = values.map(normalizeValue).filter(Boolean);
    if (!normalized.length) return;
    const placeholders = normalized.map((_, idx) => `$${label}${idx}`);
    normalized.forEach((value, idx) => { params[`$${label}${idx}`] = value; });
    clauses.push(`EXISTS (
      SELECT 1 FROM json_each(works.${column})
      WHERE NORMALIZE_TEXT(json_extract(value, '$.name')) IN (${placeholders.join(', ')})
    )`);
  };

  addJsonFilter('tags_json', tags, 'tag');
  addJsonFilter('vas_json', vas, 'va');

  const qNorm = normalizeValue(q);
  if (qNorm) {
    const likeParam = `%${qNorm}%`;
    params.$qLike = likeParam;
    const matchers = [
      'NORMALIZE_TEXT(works.title) LIKE $qLike',
      'NORMALIZE_TEXT(works.circle_name) LIKE $qLike',
      `EXISTS (
        SELECT 1 FROM json_each(works.tags_json)
        WHERE NORMALIZE_TEXT(json_extract(value, '$.name')) LIKE $qLike
      )`,
      `EXISTS (
        SELECT 1 FROM json_each(works.vas_json)
        WHERE NORMALIZE_TEXT(json_extract(value, '$.name')) LIKE $qLike
      )`,
    ];
    const qDigits = qNorm.replace(/[^0-9]/g, '');
    if (qDigits) {
      params.$qDigits = `%${qDigits}%`;
      matchers.push('works.rjcode LIKE $qDigits');
    }
    clauses.push(`(${matchers.join(' OR ')})`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { whereClause, fromClause: 'FROM works', params };
}

export function worksSortClause(sort?: string) {
  switch (sort) {
    case 'title_asc':
      return 'ORDER BY LOWER(works.title) ASC, works.id ASC';
    case 'title_desc':
      return 'ORDER BY LOWER(works.title) DESC, works.id DESC';
    case 'release_asc':
      return `ORDER BY
        CASE WHEN works.release IS NULL OR works.release = '' THEN 1 ELSE 0 END,
        works.release ASC,
        works.id ASC`;
    case 'release_desc':
      return `ORDER BY
        CASE WHEN works.release IS NULL OR works.release = '' THEN 1 ELSE 0 END,
        works.release DESC,
        works.id DESC`;
    default:
      return 'ORDER BY datetime(works.updated_at) DESC, works.id DESC';
  }
}

