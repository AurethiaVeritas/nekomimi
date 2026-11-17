import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { getWork } from '../lib/api'
import { getErrorMessage } from '../lib/errors'
import { ageRatingLabel, getAgeRating } from '../lib/ageRating'
import CoverImage from '../components/CoverImage'
import MediaViewer from '../components/MediaViewer'
import AddToCollection from '../components/AddToCollection'
import WorkFileBrowser from '../components/WorkFileBrowser'
import { useI18n } from '../lib/i18n'
import type { Work as WorkType, ViewerState } from '../types'
import { normalizeNamedItems } from '../lib/namedItems'
import './Work.css'

export default function Work() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [work, setWork] = useState<WorkType | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [viewer, setViewer] = useState<ViewerState>({ open: false, type: null, title: '', src: '', content: '' })
  const tags = normalizeNamedItems(work?.tags)
  const vas = normalizeNamedItems(work?.vas)
  const rjDigits = work?.rjcode ? String(work.rjcode).replace(/\D/g, '') : ''
  
  useEffect(() => {
    if (!id) return
    let active = true
    setErr('')
    setLoading(true)
    getWork(id)
      .then(value => { if (active) setWork(value) })
      .catch(e => { if (active) setErr(getErrorMessage(e)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  if (loading) return <div className="card">{t('Loading…')}</div>
  if (err) return <div className="card"><div className="text-muted">{err}</div></div>
  if (!work) return <div className="card">{t('Not found')}</div>

  return (
    <div className="work-page">
      <div className="work-hero card">
        <div className="work-hero__top-bar">
          <button type="button"
            className="work-back-btn"
            onClick={(e) => {
              e.preventDefault()
              if (window.history.length > 1) navigate(-1)
              else navigate('/')
            }}
            title={t('Go back')}
            aria-label={t('Go back')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 19l-7-7 7-7" />
            </svg>
            <span>{t('Back')}</span>
          </button>
          
          <div className="work-hero__actions">
            <AddToCollection workId={work.id} />
            <Link className="btn work-hero__edit-btn" to={`/edit/${work.id}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              <span>{t('Edit')}</span>
            </Link>
          </div>
        </div>
        
        <div className="work-hero__content">
          <div className="work-hero__cover">
            <CoverImage coverPath={work.cover_path ?? null} workId={work.id} alt="cover" className="work-cover" />
          </div>
          
          <div className="work-hero__info">
            <h1 className="work-hero__title">{work.title}</h1>
            
            <div className="work-hero__metadata">
              {work.circle?.name && (
                <div className="work-hero__meta-item">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M2 13V6L8 2.5L14 6V13H10V9H6V13H2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  </svg>
                  <span className="work-hero__meta-label">{t('Circle:')}</span>
                  <Link className="work-hero__meta-link" to={`/circles/${encodeURIComponent(work.circle.name)}`}>{work.circle.name}</Link>
                </div>
              )}

              {(vas.length > 0) && (
                <div className="work-hero__meta-item">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1.5V9M8 9C6.75 9 5.5 7.75 5.5 6.5V3.5C5.5 2.25 6.75 1.5 8 1.5C9.25 1.5 10.5 2.25 10.5 3.5V6.5C10.5 7.75 9.25 9 8 9Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M4 6.5C4 9.25 5.75 11 8 11C10.25 11 12 9.25 12 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M8 11V14.5M5 14.5H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <span className="work-hero__meta-label">{t('VAs:')}</span>
                  <span className="work-hero__meta-text">
                    {vas.map((v, idx) => (
                      <span key={v.name}>
                        {idx>0 && ', '}
                        <Link className="work-hero__meta-link" to={`/search?va=${encodeURIComponent(v.name)}`}>{v.name}</Link>
                      </span>
                    ))}
                  </span>
                </div>
              )}

              {rjDigits && (
                <div className="work-hero__meta-item">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2.25" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M5.25 5.75H10.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M5.25 10.25H8.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <span className="work-hero__meta-label">{t('RJ:')}</span>
                  <a
                    className="work-hero__meta-link work-hero__meta-link--external"
                    href={`https://www.dlsite.com/maniax/work/=/product_id/RJ${rjDigits}.html`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t('Open on DLsite')}
                  >
                    {`RJ${rjDigits}`}
                    <svg
                      className="work-hero__external-icon"
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="M9 3.5H12.5V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M7 9L12.4 3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M6.25 4H3.5C2.673 4 2 4.673 2 5.5v7C2 13.327 2.673 14 3.5 14h7c.827 0 1.5-.673 1.5-1.5V9.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </a>
                </div>
              )}

              {work.release && (
                <div className="work-hero__meta-item">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="3.5" width="12" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M2 7H14" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M5.5 1.5V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M10.5 1.5V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <span className="work-hero__meta-label">{t('Release:')}</span>
                  <span>{work.release}</span>
                </div>
              )}
              
              <div className="work-hero__meta-item">
                <span className={`work-hero__badge work-hero__badge--${getAgeRating(work) === 'r18' ? 'nsfw' : getAgeRating(work)}`}>
                  {ageRatingLabel(getAgeRating(work))}
                </span>
              </div>
            </div>
            
            {(tags.length > 0) && (
              <div className="work-hero__tags">
                {tags.map(t => (
                  <Link key={t.name} className="work-hero__tag" to={`/search?tag=${encodeURIComponent(t.name)}`}>{t.name}</Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      <WorkFileBrowser workId={work.id} openViewer={setViewer} />

      <MediaViewer viewer={viewer} onClose={() => setViewer({ open: false })} />
    </div>
  )
}
