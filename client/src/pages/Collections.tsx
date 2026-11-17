import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  createCollection as createCollectionApi,
  deleteCollection as deleteCollectionApi,
  listCollections,
  listCollectionWorks,
  listWorkFacets,
  updateCollection as updateCollectionApi,
} from '../lib/api'
import useGridPageSize from '../lib/useGridPageSize'
import useInfiniteScrollSentinels from '../lib/useInfiniteScrollSentinels'
import useMediaQuery from '../lib/useMediaQuery'
import { getErrorMessage } from '../lib/errors'
import type { AgeRating, Collection, CollectionMatch, CollectionType, FacetItem, Work } from '../types'
import Dropdown from '../components/ui/Dropdown'
import Segmented from '../components/ui/Segmented'
import AgeRatingToggles from '../components/ui/AgeRatingToggles'
import GridWorkCard from '../components/ui/GridWorkCard'
import GridLoadingSpace from '../components/ui/GridLoadingSpace'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Modal from '../components/Modal'
import { useI18n } from '../lib/i18n'
import { ALL_AGE_RATINGS, ageRatingsLabel, ratingsFromContentFilter } from '../lib/ageRating'
import './Search.css'
import './Collections.css'

type EditorState = { open: boolean; collection: Collection | null }

export default function Collections() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const selectedId = Number(params.get('collection')) || null
  const { gridRef, pageSize, remainingHeight } = useGridPageSize(48)
  const [collections, setCollections] = useState<Collection[]>([])
  const [tagFacets, setTagFacets] = useState<FacetItem[]>([])
  const [works, setWorks] = useState<Work[]>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [sort, setSort] = useState('release_desc')
  const [loadingCollections, setLoadingCollections] = useState(true)
  const [loadingWorks, setLoadingWorks] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [collectionQuery, setCollectionQuery] = useState('')
  const [mobileCollectionsOpen, setMobileCollectionsOpen] = useState(false)
  const showDesktopCollections = useMediaQuery('(min-width: 768px)')
  const [editor, setEditor] = useState<EditorState>({ open: false, collection: null })
  const loadingPagesRef = useRef<Set<number>>(new Set())
  const requestTokenRef = useRef(0)

  useEffect(() => {
    if (showDesktopCollections) setMobileCollectionsOpen(false)
  }, [showDesktopCollections])

  const selectCollection = useCallback((id: number | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('collection', String(id))
    else next.delete('collection')
    setParams(next, { replace: true })
    setMobileCollectionsOpen(false)
  }, [params, setParams])

  const refreshCollections = useCallback(async (preferredId?: number | null) => {
    const data = await listCollections()
    setCollections(data)
    const currentId = preferredId === undefined ? selectedId : preferredId
    const nextId = currentId && data.some(collection => collection.id === currentId)
      ? currentId
      : data[0]?.id ?? null
    if (nextId !== selectedId) selectCollection(nextId)
    return data
  }, [selectedId, selectCollection])

  useEffect(() => {
    let active = true
    const initialParams = new URLSearchParams(window.location.search)
    const initialSelectedId = Number(initialParams.get('collection')) || null
    setLoadingCollections(true)
    setError('')
    Promise.all([listCollections(), listWorkFacets()])
      .then(([collectionData, facets]) => {
        if (!active) return
        setCollections(collectionData)
        setTagFacets(facets.tags || [])
        if (!initialSelectedId || !collectionData.some(collection => collection.id === initialSelectedId)) {
          const nextId = collectionData[0]?.id ?? null
          if (nextId) {
            const next = new URLSearchParams(initialParams)
            next.set('collection', String(nextId))
            setParams(next, { replace: true })
          }
        }
      })
      .catch(err => active && setError(getErrorMessage(err, 'Failed to load collections')))
      .finally(() => active && setLoadingCollections(false))
    return () => { active = false }
  }, [setParams])

  const loadWorks = useCallback(async (targetPage: number, append: boolean) => {
    if (!selectedId) {
      setWorks([])
      setPage(1)
      setHasNext(false)
      setLoadingWorks(false)
      return null
    }
    if (!pageSize || loadingPagesRef.current.has(targetPage)) return null
    const token = requestTokenRef.current
    loadingPagesRef.current.add(targetPage)
    append ? setLoadingMore(true) : setLoadingWorks(true)
    setError('')
    try {
      const data = await listCollectionWorks(selectedId, { page: targetPage, pageSize, sort })
      if (token !== requestTokenRef.current) return null
      setWorks(previous => {
        if (!append) return data.items
        const existingIds = new Set(previous.map(work => work.id))
        const incoming = data.items.filter(work => !existingIds.has(work.id))
        return [...previous, ...incoming]
      })
      setPage(data.page)
      setHasNext(data.hasNext)
      return data
    } catch (err) {
      if (token === requestTokenRef.current) {
        setError(getErrorMessage(err, 'Failed to load collection works'))
      }
      return null
    } finally {
      loadingPagesRef.current.delete(targetPage)
      if (token === requestTokenRef.current) {
        append ? setLoadingMore(false) : setLoadingWorks(false)
      }
    }
  }, [pageSize, selectedId, sort])

  const reloadWorks = useCallback(() => {
    requestTokenRef.current += 1
    loadingPagesRef.current.clear()
    setLoadingMore(false)
    return loadWorks(1, false)
  }, [loadWorks])

  useEffect(() => {
    void reloadWorks()
  }, [reloadWorks])

  const handleEndReached = useCallback(() => {
    if (!hasNext || loadingMore || loadingWorks) return
    void loadWorks(page + 1, true)
  }, [hasNext, loadWorks, loadingMore, loadingWorks, page])

  const { bottomSentinelRef } = useInfiniteScrollSentinels({
    onEndReached: handleEndReached,
  })

  const selectedCollection = useMemo(
    () => collections.find(collection => collection.id === selectedId) || null,
    [collections, selectedId]
  )

  const filteredCollections = useMemo(() => {
    const query = collectionQuery.trim().toLowerCase()
    return query
      ? collections.filter(collection => collection.name.toLowerCase().includes(query))
      : collections
  }, [collections, collectionQuery])

  const openCreate = () => {
    setMobileCollectionsOpen(false)
    setEditor({ open: true, collection: null })
  }
  const openEdit = (collection: Collection) => {
    setMobileCollectionsOpen(false)
    setEditor({ open: true, collection })
  }

  const handleEditorSaved = async (saved: Collection) => {
    setEditor({ open: false, collection: null })
    await refreshCollections(saved.id)
    if (saved.id === selectedId) {
      await reloadWorks()
    }
  }

  const handleDelete = async (collection: Collection) => {
    if (!window.confirm(`Delete “${collection.name}”? The works themselves will not be deleted.`)) return
    setError('')
    try {
      await deleteCollectionApi(collection.id)
      await refreshCollections(collection.id === selectedId ? null : selectedId)
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete collection'))
    }
  }

  const rail = (
    <CollectionRail
      collections={filteredCollections}
      selectedId={selectedId}
      query={collectionQuery}
      loading={loadingCollections}
      onQueryChange={setCollectionQuery}
      onCreate={openCreate}
      onSelect={selectCollection}
      onEdit={openEdit}
      onDelete={handleDelete}
    />
  )

  return (
    <div className="collections-page">
      {error ? <div className="card collections-error" role="alert">{error}</div> : null}
      <div className="collections-layout">
        {showDesktopCollections ? <aside className="card collections-sidebar">{rail}</aside> : null}

        <section className="collections-content">
          {!showDesktopCollections ? <div className="collections-mobile-toolbar">
            <button type="button" className="btn" onClick={() => setMobileCollectionsOpen(true)}>
              {t('Collections')}{collections.length ? ` (${collections.length})` : ''}
            </button>
            <Dropdown
              value={sort}
              onChange={setSort}
              options={sortOptions.map(option => ({ ...option, label: t(option.label) }))}
            />
          </div> : null}

          {selectedCollection ? (
            <>
              <div className="card collections-header">
                <div className="collections-header__copy">
                  <h2>{selectedCollection.name}</h2>
                  <div className="text-muted text-small">{collectionDescription(selectedCollection, t)}</div>
                  {selectedCollection.type === 'smart' ? (
                    <div className="collections-header__tags">
                      {selectedCollection.tags.map(tag => <span className="tag" key={tag}>{tag}</span>)}
                    </div>
                  ) : null}
                </div>
                <div className="collections-header__actions">
                  <button type="button" className="btn" onClick={() => openEdit(selectedCollection)}>
                    <EditIcon />
                    <span>{t('Edit collection')}</span>
                  </button>
                  <div className="collections-desktop-sort">
                    <Dropdown value={sort} onChange={setSort} options={sortOptions.map(option => ({ ...option, label: t(option.label) }))} />
                  </div>
                </div>
              </div>

              <div className="search-results-grid" ref={gridRef}>
                {works.map(work => <GridWorkCard key={work.id} work={work} />)}
              </div>

              {(loadingWorks || pageSize === null) && (
                <div className="collections-grid-loading">
                  <LoadingSpinner size="md" centered label={t('Loading collection works…')} />
                </div>
              )}

              {!loadingWorks && pageSize !== null && works.length === 0 && (
                <div className="card collections-empty" role="status">
                  <CollectionIcon />
                  <h3>{t('No works in this collection')}</h3>
                  <p className="text-muted">
                    {selectedCollection.type === 'manual'
                      ? 'Open a work and use Add to collection to place it here.'
                      : 'No works currently match this collection’s tag rules.'}
                  </p>
                </div>
              )}

              {works.length > 0 && (
                <GridLoadingSpace
                  sentinelRef={bottomSentinelRef}
                  height={remainingHeight((selectedCollection?.workCount || 0) - works.length, !loadingWorks && hasNext)}
                  loading={loadingMore}
                />
              )}
            </>
          ) : (
            <div className="card collections-empty collections-empty--welcome">
              <CollectionIcon />
              <h2>{t('Create your first collection')}</h2>
              <p className="text-muted">{t('Group works yourself or let tags keep a smart collection up to date.')}</p>
              <button type="button" className="btn btn-primary" onClick={openCreate}>{t('New collection')}</button>
            </div>
          )}
        </section>
      </div>

      {!showDesktopCollections ? <div className={`search-drawer md:hidden ${mobileCollectionsOpen ? 'search-drawer--open' : ''}`} data-no-ptr>
        <button
          type="button"
          className="search-drawer__backdrop"
          onClick={() => setMobileCollectionsOpen(false)}
          aria-label={t('Close collections')}
        />
        <div className="search-drawer__panel collections-drawer__panel" data-no-ptr>
          <div className="search-drawer__header">
            <div className="form-title">{t('My Collections')}</div>
            <button type="button" className="btn btn-sm" onClick={() => setMobileCollectionsOpen(false)}>{t('Done')}</button>
          </div>
          <div className="search-drawer__body collections-drawer__body">
            {mobileCollectionsOpen ? rail : null}
          </div>
        </div>
      </div> : null}

      <CollectionEditor
        editor={editor}
        tagFacets={tagFacets}
        onClose={() => setEditor({ open: false, collection: null })}
        onSaved={handleEditorSaved}
      />
    </div>
  )
}

const sortOptions = [
  { value: 'release_desc', label: 'Newest' },
  { value: 'release_asc', label: 'Oldest' },
  { value: 'title_asc', label: 'Title A → Z' },
  { value: 'title_desc', label: 'Title Z → A' },
]

function collectionDescription(collection: Collection, t: (key: string) => string) {
  const count = `${collection.workCount} ${t(collection.workCount === 1 ? 'work' : 'works')}`
  if (collection.type === 'manual') return `${t('Manual')} ${t('collection')} · ${count}`
  const content = t(ageRatingsLabel(collection.ageRatings ?? ratingsFromContentFilter(collection.contentFilter)))
  return `${t('Smart')} ${t('collection')} · ${t(collection.match === 'and' ? 'all tags' : 'any tag')} · ${content} · ${count}`
}

type CollectionRailProps = {
  collections: Collection[]
  selectedId: number | null
  query: string
  loading: boolean
  onQueryChange: (value: string) => void
  onCreate: () => void
  onSelect: (id: number) => void
  onEdit: (collection: Collection) => void
  onDelete: (collection: Collection) => void
}

function CollectionRail({
  collections,
  selectedId,
  query,
  loading,
  onQueryChange,
  onCreate,
  onSelect,
  onEdit,
  onDelete,
}: CollectionRailProps) {
  const { t } = useI18n()
  return (
    <div className="collection-rail">
      <div className="collection-rail__title">{t('My Collections')}</div>
      <button type="button" className="btn btn-primary collection-rail__new" onClick={onCreate}>
        <PlusIcon />
        {t('New collection')}
      </button>
      <div className="collection-rail__search">
        <SearchIcon />
        <input
          className="input"
          type="search"
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder={t('Find a collection…')}
          aria-label={t('Find a collection')}
        />
      </div>
      <div className="collection-rail__list">
        {loading ? <div className="text-muted text-small collection-rail__status">{t('Loading collections…')}</div> : null}
        {!loading && collections.length === 0 ? (
          <div className="text-muted text-small collection-rail__status">
            {query ? t('No collections found.') : t('No collections yet.')}
          </div>
        ) : null}
        {collections.map(collection => {
          const selected = collection.id === selectedId
          return (
            <div
              key={collection.id}
              className={`collection-row${selected ? ' is-selected' : ''}`}
            >
              <button type="button" className="collection-row__main" onClick={() => onSelect(collection.id)}>
                <span className="collection-row__icon">
                  {collection.type === 'manual' ? <CollectionIcon /> : <SmartIcon />}
                </span>
                <span className="collection-row__copy">
                  <span className="collection-row__name">{collection.name}</span>
                  <span className="collection-row__meta">
                    {collection.type === 'manual' ? t('Manual') : `${t('Smart')} · ${t(collection.match === 'and' ? 'all tags' : 'any tag')}`}
                    {' · '}{collection.workCount} {t(collection.workCount === 1 ? 'work' : 'works')}
                  </span>
                </span>
              </button>
              {selected ? (
                <span className="collection-row__actions">
                  <button type="button" className="btn btn-icon-compact" onClick={() => onEdit(collection)} aria-label={`${t('Edit')} ${collection.name}`} title={t('Edit collection')}>
                    <EditIcon />
                  </button>
                  <button type="button" className="btn btn-icon-compact collection-row__delete" onClick={() => onDelete(collection)} aria-label={`${t('Delete')} ${collection.name}`} title={t('Delete collection')}>
                    <TrashIcon />
                  </button>
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type CollectionEditorProps = {
  editor: EditorState
  tagFacets: FacetItem[]
  onClose: () => void
  onSaved: (collection: Collection) => void | Promise<void>
}

function CollectionEditor({ editor, tagFacets, onClose, onSaved }: CollectionEditorProps) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [type, setType] = useState<CollectionType>('manual')
  const [match, setMatch] = useState<CollectionMatch>('and')
  const [ageRatings, setAgeRatings] = useState<AgeRating[]>(ALL_AGE_RATINGS)
  const [tags, setTags] = useState<string[]>([])
  const [tagQuery, setTagQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!editor.open) return
    setName(editor.collection?.name || '')
    setType(editor.collection?.type || 'manual')
    setMatch(editor.collection?.match || 'and')
    setAgeRatings(editor.collection?.ageRatings ?? ratingsFromContentFilter(editor.collection?.contentFilter || 'all'))
    setTags(editor.collection?.tags || [])
    setTagQuery('')
    setError('')
  }, [editor])

  const suggestions = useMemo(() => {
    const query = tagQuery.trim().toLowerCase()
    if (!query) return []
    const selected = new Set(tags.map(tag => tag.toLowerCase()))
    return tagFacets
      .filter(tag => !selected.has(tag.name.toLowerCase()) && tag.name.toLowerCase().includes(query))
      .slice(0, 8)
  }, [tagFacets, tagQuery, tags])

  const addTag = (tag: string) => {
    setTags(previous => previous.some(value => value.toLowerCase() === tag.toLowerCase()) ? previous : [...previous, tag])
    setTagQuery('')
  }

  const handleSave = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) return setError(t('Enter a collection name.'))
    if (type === 'smart' && tags.length === 0) return setError('Choose at least one tag for a smart collection.')
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: trimmedName,
        type,
        match,
        ageRatings: type === 'smart' ? ageRatings : ALL_AGE_RATINGS,
        tags: type === 'smart' ? tags : [],
      }
      const saved = editor.collection
        ? await updateCollectionApi(editor.collection.id, payload)
        : await createCollectionApi(payload)
      await onSaved(saved)
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to save collection'))
    } finally {
      setSaving(false)
    }
  }

  const ruleJoiner = match === 'and' ? ' AND ' : ' OR '

  return (
    <Modal
      open={editor.open}
      onClose={saving ? undefined : onClose}
      title={editor.collection ? t('Edit collection') : t('New collection')}
      maxWidth={560}
      resizable={false}
      fitContent
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>{t('Cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? t('Saving…') : editor.collection ? t('Save changes') : t('Create collection')}
          </button>
        </>
      )}
    >
      <div className="collection-editor">
        <div className="collection-editor__field">
          <label htmlFor="collection-name">{t('Name')}</label>
          <input
            id="collection-name"
            className="input"
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder={t('Collection name')}
            maxLength={100}
            autoFocus
          />
        </div>
        <div className="collection-editor__field">
          <span className="collection-editor__label">{t('Type')}</span>
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { value: 'manual', label: t('Manual') },
              { value: 'smart', label: t('Smart') },
            ]}
          />
        </div>
        {type === 'smart' ? (
          <>
            <p className="text-muted text-small collection-editor__helper">{t('Works are included automatically when their tags and content setting match.')}</p>
            <div className="collection-editor__field">
              <label htmlFor="collection-tag-search">{t('Tags')}</label>
              <div className="collection-tag-picker">
                <div className="collection-tag-picker__input">
                  <SearchIcon />
                  <input
                    id="collection-tag-search"
                    className="input"
                    value={tagQuery}
                    onChange={event => setTagQuery(event.target.value)}
                    placeholder={t('Find a tag…')}
                    autoComplete="off"
                  />
                </div>
                {suggestions.length ? (
                  <div className="collection-tag-picker__suggestions">
                    {suggestions.map(tag => (
                      <button key={tag.name} type="button" onClick={() => addTag(tag.name)}>
                        <span>{tag.name}</span>
                        <span className="text-muted">{tag.count || 0}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {tags.length ? (
                  <div className="collection-tag-picker__chips">
                    {tags.map(tag => (
                      <button key={tag} type="button" className="tag" onClick={() => setTags(previous => previous.filter(value => value !== tag))}>
                        {tag}<span aria-hidden="true">×</span><span className="sr-only">Remove {tag}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="collection-editor__field">
              <span className="collection-editor__label">{t('Match')}</span>
              <Segmented
                value={match}
                onChange={setMatch}
                options={[
                  { value: 'and', label: t('All tags') },
                  { value: 'or', label: t('Any tag') },
                ]}
              />
            </div>
            <div className="collection-editor__field">
              <span className="collection-editor__label">{t('Content')}</span>
              <AgeRatingToggles value={ageRatings} onChange={setAgeRatings} />
            </div>
            {tags.length ? (
              <div className="text-muted text-small collection-editor__summary">
                Includes works tagged {tags.join(ruleJoiner)} · {t(ageRatingsLabel(ageRatings))}
              </div>
            ) : null}
          </>
        ) : null}
        {error ? <div className="collection-editor__error" role="alert">{error}</div> : null}
      </div>
    </Modal>
  )
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}

function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
}

function CollectionIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4a2 2 0 0 0-2 2v14l9-4 9 4V6a2 2 0 0 0-2-2H5Z" /></svg>
}

function SmartIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 1 0 6 6c0 6-3 9-9 9a6 6 0 0 0 9 0" /><path d="M18 3v4M16 5h4" /></svg>
}

function EditIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>
}

function TrashIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" /></svg>
}
