import type { AgeRating, Work } from '../types'

export const ALL_AGE_RATINGS: AgeRating[] = ['sfw', 'r15', 'r18']

export function normalizeAgeRatings(values: readonly AgeRating[]): AgeRating[] {
  return ALL_AGE_RATINGS.filter(rating => values.includes(rating))
}

export function ratingsFromContentFilter(filter: unknown): AgeRating[] {
  if (filter === 'nsfw' || filter === 'r18') return ['r18']
  if (filter === 'sfw' || filter === 'r15') return [filter]
  return [...ALL_AGE_RATINGS]
}

export function ageRatingsLabel(ratings: readonly AgeRating[]): string {
  if (ratings.length === 3) return 'all content'
  if (ratings.length === 0) return 'no content'
  if (ratings.length === 1) return `${ageRatingLabel(ratings[0])} only`
  return ratings.map(ageRatingLabel).join(' + ')
}

export function getAgeRating(work: Pick<Work, 'ageRating' | 'nsfw'>): AgeRating {
  return work.ageRating ?? (work.nsfw ? 'r18' : 'sfw')
}

export function ageRatingLabel(rating: AgeRating): string {
  return rating === 'r15' ? 'R-15' : rating === 'r18' ? 'R-18' : 'SFW'
}
