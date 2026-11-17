import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { listCollections, setCollectionWorkMembership } from '../lib/api'
import { getErrorMessage } from '../lib/errors'
import { useI18n } from '../lib/i18n'
import type { Collection } from '../types'
import './AddToCollection.css'

type AddToCollectionProps = {
  workId: number
}

export default function AddToCollection({ workId }: AddToCollectionProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [collections, setCollections] = useState<Collection[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const savedTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && !rootRef.current?.contains(target)) setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  useEffect(() => () => {
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current)
  }, [])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setCollections(await listCollections(workId))
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update collections'))
    } finally {
      setLoading(false)
    }
  }

  const toggleOpen = () => {
    setOpen(previous => {
      const next = !previous
      if (next) void load()
      return next
    })
  }

  const manualCollections = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return collections.filter(collection => (
      collection.type === 'manual'
      && (!normalizedQuery || collection.name.toLowerCase().includes(normalizedQuery))
    ))
  }, [collections, query])

  const smartCollectionCount = collections.filter(collection => collection.type === 'smart').length

  const toggleMembership = async (collection: Collection) => {
    if (savingId !== null) return
    const included = !collection.containsWork
    setSavingId(collection.id)
    setSavedId(null)
    setError('')
    try {
      const updated = await setCollectionWorkMembership(collection.id, workId, included)
      setCollections(previous => previous.map(item => item.id === collection.id ? updated : item))
      setSavedId(collection.id)
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current)
      savedTimerRef.current = window.setTimeout(() => setSavedId(null), 3500)
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update collections'))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="add-to-collection" ref={rootRef}>
      <button
        type="button"
        className={`btn work-hero__collection-btn${open ? ' is-active' : ''}`}
        onClick={toggleOpen}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <BookmarkPlusIcon />
        <span>{t('Add to collection')}</span>
      </button>

      {open ? (
        <div className="add-to-collection__popover" role="dialog" aria-label={t('Add to collection')}>
          <div className="add-to-collection__header">
            <h3>{t('Add to collection')}</h3>
            <button type="button" className="btn btn-icon-compact" onClick={() => setOpen(false)} aria-label={t('Close add to collection')}>×</button>
          </div>
          <div className="add-to-collection__search">
            <SearchIcon />
            <input
              className="input"
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('Find a collection…')}
              aria-label={t('Find a collection')}
              autoFocus
            />
          </div>

          <div className="add-to-collection__list">
            {loading ? <div className="add-to-collection__status text-muted">{t('Loading collections…')}</div> : null}
            {!loading && manualCollections.length === 0 ? (
              <div className="add-to-collection__status text-muted">
                {query ? t('No manual collections found.') : t('No manual collections yet.')}
              </div>
            ) : null}
            {manualCollections.map(collection => {
              const saving = savingId === collection.id
              const saved = savedId === collection.id
              return (
                <button
                  type="button"
                  className="add-to-collection__row"
                  key={collection.id}
                  role="checkbox"
                  aria-checked={!!collection.containsWork}
                  disabled={savingId !== null}
                  onClick={() => toggleMembership(collection)}
                >
                  <span className={`add-to-collection__checkbox${collection.containsWork ? ' is-checked' : ''}`} aria-hidden="true">
                    {collection.containsWork ? '✓' : ''}
                  </span>
                  <span className="add-to-collection__row-copy">
                    <span className="add-to-collection__row-name">{collection.name}</span>
                    <span className="text-muted text-tiny">{collection.workCount} {t(collection.workCount === 1 ? 'work' : 'works')}</span>
                  </span>
                  <span className="add-to-collection__row-state" aria-live="polite">
                    {saving ? t('Saving…') : saved ? <><CheckIcon /> {t('Saved')}</> : null}
                  </span>
                </button>
              )
            })}
          </div>

          {error ? <div className="add-to-collection__error" role="alert">{error}</div> : null}
          <div className="add-to-collection__footer">
            <span className="text-muted text-tiny">
              {t('Smart collections update automatically from tags')}{smartCollectionCount ? ` (${smartCollectionCount})` : ''}.
            </span>
            <Link to="/collections" onClick={() => setOpen(false)}>{t('Manage collections')}</Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function BookmarkPlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
      <path d="M12 7v6M9 10h6" />
    </svg>
  )
}

function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
}

function CheckIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
}
