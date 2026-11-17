import type { AgeRating } from '../../types'
import { ALL_AGE_RATINGS, ageRatingLabel, normalizeAgeRatings } from '../../lib/ageRating'
import { useI18n } from '../../lib/i18n'

type Props = {
  value: AgeRating[]
  onChange: (ratings: AgeRating[]) => void
}

export default function AgeRatingToggles({ value, onChange }: Props) {
  const { t } = useI18n()
  return (
    <div className="seg age-rating-toggles" role="group" aria-label={t('Content Filter')}>
      {ALL_AGE_RATINGS.map(rating => {
        const selected = value.includes(rating)
        return (
          <button
            key={rating}
            type="button"
            aria-pressed={selected}
            className={`seg__btn ${selected ? 'is-active' : ''}`}
            onClick={() => onChange(normalizeAgeRatings(selected ? value.filter(item => item !== rating) : [...value, rating]))}
          >
            {t(ageRatingLabel(rating))}
          </button>
        )
      })}
    </div>
  )
}
