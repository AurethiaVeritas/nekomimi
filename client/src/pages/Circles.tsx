import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listCircles } from '../lib/api'
import { rememberLastAnchor, useScrollRestoration } from '../lib/scroll'
import CoverImage from '../components/CoverImage'
import Dropdown from '../components/ui/Dropdown'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { useI18n } from '../lib/i18n'
import './Circles.css'

type Circle = {
  name: string;
  count: number;
  newestCoverPath?: string | null;
  newestWorkId?: number | string;
  newestTitle?: string | null;
};

const INITIAL_PRIORITY_COUNT = 12

function CircleCard({ circle, index }: { circle: Circle; index: number }) {
  const { t } = useI18n()
  const url = `/circles/${encodeURIComponent(circle.name)}`
  const anchorId = `circle-${encodeURIComponent(circle.name)}`
  const prioritizeImage = index < INITIAL_PRIORITY_COUNT

  return (
    <Link
      id={anchorId}
      to={url}
      className="circles-card"
      style={{ '--item-index': index } as React.CSSProperties}
      onClick={() => rememberLastAnchor(anchorId)}
    >
      <div className="circles-card__cover-wrapper">
        <CoverImage
          coverPath={circle.newestCoverPath ?? null}
          workId={circle.newestWorkId ?? ''}
          alt="cover"
          className="circles-card__cover"
          loading={prioritizeImage ? 'eager' : 'lazy'}
          fetchPriority={index < 4 ? 'high' : 'auto'}
          deferUntilVisible={!prioritizeImage}
        />
        <div className="circles-card__count">{circle.count}</div>
      </div>
      <div className="circles-card__content">
        <h3 className="circles-card__title" title={circle.name}>{circle.name}</h3>
        <div className="circles-card__meta">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>{circle.count} {t(circle.count === 1 ? 'work' : 'works')}</span>
        </div>
        {circle.newestTitle && (
          <div className="circles-card__newest" title={circle.newestTitle}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
            <span>{circle.newestTitle}</span>
          </div>
        )}
      </div>
    </Link>
  )
}

export default function Circles() {
  const { t } = useI18n()
  const [circles, setCircles] = useState<Circle[]>([])
  const [loading, setLoading] = useState(true)
  useScrollRestoration('circles')
  
  // Load sort preference from localStorage, default to 'name_asc'
  const [sort, setSort] = useState<'name_asc' | 'name_desc' | 'count_desc' | 'count_asc'>(() => {
    try {
      const saved = localStorage.getItem('circles_sort')
      return saved === 'name_desc' || saved === 'count_desc' || saved === 'count_asc' ? saved : 'name_asc'
    } catch {
      return 'name_asc'
    }
  })

  // Persist sort preference to localStorage when it changes
  const handleSortChange = (newSort: 'name_asc' | 'name_desc' | 'count_desc' | 'count_asc') => {
    setSort(newSort)
    try {
      localStorage.setItem('circles_sort', newSort)
    } catch (err) {
      console.error('Failed to save sort preference:', err)
    }
  }

  useEffect(() => {
    let mounted = true
    setLoading(true)
    const load = async () => {
      try {
        const data = await listCircles({ sort }) as Circle[]
        if (mounted) setCircles(data)
      } catch (err) {
        if (mounted) console.error(err)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [sort])

  return (
    <div className="circles-page">
      <div className="circles-header">
        <div className="circles-header__content">
          <p className="circles-header__subtitle">
            {loading ? t('Loading…') : `${circles.length} ${t('Circles')}`}
          </p>
        </div>
        <div className="circles-header__controls">
          <div className="circles-sort-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="16" y2="6"></line>
              <line x1="4" y1="12" x2="13" y2="12"></line>
              <line x1="4" y1="18" x2="10" y2="18"></line>
            </svg>
            <span>{t('Sort')}</span>
          </div>
          <Dropdown
            value={sort}
            onChange={(value) => handleSortChange(value as 'name_asc' | 'name_desc' | 'count_desc' | 'count_asc')}
            options={[
              { value: 'name_asc', label: t('Name: A → Z') },
              { value: 'name_desc', label: t('Name: Z → A') },
              { value: 'count_desc', label: t('Works: Most') },
              { value: 'count_asc', label: t('Works: Fewest') },
            ]}
          />
        </div>
      </div>

      <div className="circles-grid">
        {circles.map((circle, index) => (
          <CircleCard key={circle.name} circle={circle} index={index} />
        ))}
      </div>

      {loading && (
        <div className="circles-grid-loading">
          <LoadingSpinner size="md" centered label={t('Loading circles…')} />
        </div>
      )}

      {!loading && circles.length === 0 && (
        <div className="circles-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>{t('No circles found.')}</p>
        </div>
      )}
    </div>
  )
}
