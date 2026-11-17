import { Link } from 'react-router-dom'
import CoverImage from '../CoverImage'
import type { Tag, VA, Work } from '../../types'
import { ageRatingLabel, getAgeRating } from '../../lib/ageRating'
import { normalizeNamedItems } from '../../lib/namedItems'
import './WorkCard.css'

type WorkCardWork = Omit<Work, 'tags' | 'vas'> & {
  tags?: Array<Tag | string>
  vas?: Array<VA | string>
}

type WorkCardProps = {
  work: WorkCardWork
  onOpen?: () => void
  anchorId?: string | null
  imageLoading?: 'eager' | 'lazy'
  deferImageUntilVisible?: boolean
}

export default function WorkCard({
  work,
  onOpen,
  anchorId = `work-${work.id}`,
  imageLoading = 'eager',
  deferImageUntilVisible = false,
}: WorkCardProps) {
  const title = work.title || work.rjcode || `Work ${work.id}`
  const tags = normalizeNamedItems<Tag>(work.tags).slice(0, 8)
  const vas = normalizeNamedItems<VA>(work.vas)
  const rating = getAgeRating(work)
  const contentRating = ageRatingLabel(rating)

  const handleRelatedLink = () => {
    onOpen?.()
  }

  return (
    <article id={anchorId ?? undefined} className="work-card">
      <Link
        to={`/work/${work.id}`}
        className="work-card__main-link"
        aria-label={`Open ${title}`}
        onClick={onOpen}
      />

      <div className="work-card__cover-wrapper">
        <CoverImage
          coverPath={work.cover_path ?? null}
          workId={work.id}
          alt={`${title} cover`}
          className="work-card__cover"
          loading={imageLoading}
          deferUntilVisible={deferImageUntilVisible}
        />
      </div>

      <div className="work-card__content">
        <h3 className="work-card__title" title={title}>{title}</h3>

        <div className="work-card__meta-list">
          {work.circle?.name ? (
            <div className="work-card__meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              <Link
                to={`/circles/${encodeURIComponent(work.circle.name)}`}
                className="work-card__meta-link"
                title={`View circle: ${work.circle.name}`}
                onClick={handleRelatedLink}
              >
                {work.circle.name}
              </Link>
            </div>
          ) : null}

          {vas.length ? (
            <div className="work-card__meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              <span className="work-card__meta-text" title={vas.map(va => va.name).join(', ')}>
                {vas.map((va, index) => (
                  <span key={va.name}>
                    <Link
                      to={`/search?va=${encodeURIComponent(va.name)}`}
                      className="work-card__meta-link"
                      title={`Filter by VA: ${va.name}`}
                      onClick={handleRelatedLink}
                    >
                      {va.name}
                    </Link>
                    {index < vas.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </span>
            </div>
          ) : null}

          {work.release ? (
            <div className="work-card__meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span className="work-card__meta-text">{work.release}</span>
            </div>
          ) : null}

          <div className="work-card__meta-item">
            <span className={`work-card__badge work-card__badge--${rating === 'r18' ? 'nsfw' : rating}`}>
              {contentRating}
            </span>
          </div>
        </div>

        {tags.length ? (
          <div className="work-card__tags">
            {tags.map(tag => (
              <Link
                key={tag.name}
                className="work-card__tag"
                to={`/search?tag=${encodeURIComponent(tag.name)}`}
                title={`Filter by tag: ${tag.name}`}
                onClick={handleRelatedLink}
              >
                {tag.name}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
}
