import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react'
import { listWorks, listWorkFacets, getWorksCache, getWorkFacetsCache } from '../lib/api'
import { useSearchParams } from 'react-router-dom'
import { useScrollRestoration } from '../lib/scroll'
import {
  captureAnchorSnapshot,
  clearPaginationState,
  createEmptyPageInfo,
  flattenUniquePageItems,
  hasPageItems,
  loadPaginationState,
  mergePageEntry,
  mergePageInfo,
  persistPaginationState,
  restoreAnchorSnapshot,
  toPageEntry,
} from '../lib/paginationState'
import useGridPageSize from '../lib/useGridPageSize'
import useInfiniteScrollSentinels from '../lib/useInfiniteScrollSentinels'
import useMediaQuery from '../lib/useMediaQuery'
import AgeRatingToggles from '../components/ui/AgeRatingToggles'
import Checkbox from '../components/ui/Checkbox'
import Dropdown from '../components/ui/Dropdown'
import GridWorkCard from '../components/ui/GridWorkCard'
import GridLoadingSpace from '../components/ui/GridLoadingSpace'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { useI18n } from '../lib/i18n'
import { ALL_AGE_RATINGS, ageRatingsLabel, normalizeAgeRatings, ratingsFromContentFilter } from '../lib/ageRating'
import type { AgeRating, NsfwFilter, Work, FacetItem, Facets, PageInfo, PageEntry, QuickSearchItem } from '../types'
import type { PaginatedResponse, PaginationState } from '../lib/paginationState'
import './Search.css'

const STATE_PREFIX = 'search:state:'
const SEARCH_SORT_OPTIONS = [
  { value: 'release_desc', label: 'Newest' },
  { value: 'release_asc', label: 'Oldest' },
  { value: 'title_asc', label: 'Title A → Z' },
  { value: 'title_desc', label: 'Title Z → A' },
]
interface NormalizedFilters {
  q: string;
  ageRatings: AgeRating[];
  sort: string;
  circles: string[];
  tags: string[];
  vas: string[];
}

interface PersistedState extends PaginationState<Work> {
  facets: Facets | null;
}

type ListWorksResponse = PaginatedResponse<Work>

const normalizeList = (list: string[] | unknown): string[] => (
  Array.isArray(list)
    ? [...new Set(list.map(v => String(v || '').trim()))].filter(Boolean).sort((a, b) => a.localeCompare(b))
    : []
)

const getStateKey = (filters: NormalizedFilters | null) => {
  const {
    q = '',
    ageRatings = ALL_AGE_RATINGS,
    sort = '',
    circles = [],
    tags = [],
    vas = [],
  } = filters || {}
  return `${STATE_PREFIX}${JSON.stringify({
    q: (q || '').trim().toLowerCase(),
    ageRatings,
    sort,
    circles,
    tags,
    vas,
  })}`
}

const ensureFacets = (facets: Partial<Facets> | null | undefined): Facets => ({
  circles: Array.isArray(facets?.circles) ? facets.circles : [],
  tags: Array.isArray(facets?.tags) ? facets.tags : [],
  vas: Array.isArray(facets?.vas) ? facets.vas : [],
})

const loadPersistedState = (key: string): PersistedState | null => {
  return loadPaginationState<Work, { facets: Facets | null }>(key, stored => ({
    facets: stored.facets ? ensureFacets(stored.facets as Partial<Facets>) : null,
  }))
}

export default function Search() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const qText = params.get('q') || ''
  const selCircles = useMemo(() => params.getAll('circle'), [params])
  const selTags = useMemo(() => params.getAll('tag'), [params])
  const selVas = useMemo(() => params.getAll('va'), [params])
  const sort = params.get('sort') || 'release_desc'
  const ageRatings = useMemo(() => {
    const values = params.getAll('ageRating')
    if (values.length > 0) return values.includes('none') ? [] : normalizeAgeRatings(values.filter((value): value is AgeRating => value === 'sfw' || value === 'r15' || value === 'r18'))
    return ratingsFromContentFilter((params.get('nsfw') || 'all') as NsfwFilter)
  }, [params])

  const fetchParams = useMemo(() => ({
    q: qText,
    ageRatings,
    circles: selCircles,
    tags: selTags,
    vas: selVas,
    sort,
  }), [qText, ageRatings, sort, selCircles, selTags, selVas])

  const normalizedFilters = useMemo((): NormalizedFilters => ({
    q: qText,
    ageRatings,
    sort,
    circles: normalizeList(selCircles),
    tags: normalizeList(selTags),
    vas: normalizeList(selVas),
  }), [qText, ageRatings, sort, selCircles, selTags, selVas])

  const filterStateKey = useMemo(() => getStateKey(normalizedFilters), [normalizedFilters])
  useScrollRestoration(filterStateKey || 'search')

  const listRef = useRef<HTMLDivElement | null>(null)
  const loadingPagesRef = useRef<Set<number>>(new Set())
  const requestTokenRef = useRef(0)
  const persistedRef = useRef<{ key: string | null; value: PersistedState | null }>({ key: null, value: null })
  const facetRequestTokenRef = useRef(0)
  const { gridRef, pageSize, remainingHeight } = useGridPageSize(24)
  const setListGridRef = useCallback((grid: HTMLDivElement | null) => {
    listRef.current = grid
    gridRef(grid)
  }, [gridRef])
  const stateKey = pageSize ? `${filterStateKey}::${pageSize}` : null

  const cacheOptions = useMemo(() => pageSize ? ({
    page: 1,
    pageSize,
    ...fetchParams,
  }) : null, [fetchParams, pageSize])
  const initialCache = useMemo(
    () => cacheOptions ? getWorksCache(cacheOptions) as ListWorksResponse | null : null,
    [cacheOptions],
  )
  const initialFacetCache = useMemo(() => getWorkFacetsCache(fetchParams) as Facets | null, [fetchParams])

  if (persistedRef.current.key !== stateKey) {
    persistedRef.current = { key: stateKey, value: stateKey ? loadPersistedState(stateKey) : null }
  }
  const persistedState = persistedRef.current.value
  const hasPersistedItems = hasPageItems(persistedState?.pages)
  const cachedFirstPage = hasPersistedItems ? null : initialCache

  const [pages, setPages] = useState<PageEntry<Work>[]>(() => {
    if (hasPersistedItems) return persistedState?.pages ?? []
    if (cachedFirstPage?.items?.length) return [toPageEntry(cachedFirstPage)]
    return []
  })
  const [pageInfo, setPageInfo] = useState<PageInfo>(() => {
    if (hasPersistedItems && persistedState?.pageInfo) return { ...createEmptyPageInfo(), ...persistedState.pageInfo }
    if (cachedFirstPage) return mergePageInfo(createEmptyPageInfo(), cachedFirstPage.page || 1, cachedFirstPage)
    return createEmptyPageInfo()
  })
  const [facets, setFacets] = useState<Facets>(() => {
    if (persistedState?.facets) return ensureFacets(persistedState.facets)
    if (initialFacetCache) return ensureFacets(initialFacetCache)
    return ensureFacets(null)
  })
  const [resolvedStateKey, setResolvedStateKey] = useState<string | null>(null)
  const [loadingPrev, setLoadingPrev] = useState(false)
  const [loadingNext, setLoadingNext] = useState(false)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const showDesktopFilters = useMediaQuery('(min-width: 768px)')
  const initialLoading = !stateKey || resolvedStateKey !== stateKey

  useEffect(() => {
    if (showDesktopFilters) setMobileFiltersOpen(false)
  }, [showDesktopFilters])

  interface LoadPageOptions {
    direction?: 'up' | 'down';
    force?: boolean;
    initial?: boolean;
  }

  const loadPage = useCallback(async (page: number, options: LoadPageOptions = {}) => {
    const targetPage = Number(page)
    if (!Number.isFinite(targetPage) || targetPage < 1) return null
    if (loadingPagesRef.current.has(targetPage)) return null
    const {
      direction,
      force = false,
      initial = false,
    } = options
    const token = requestTokenRef.current
    const anchorSnapshot = direction === 'up' ? captureAnchorSnapshot(listRef.current) : null

    loadingPagesRef.current.add(targetPage)
    if (direction === 'up') setLoadingPrev(true)
    if (direction === 'down') setLoadingNext(true)

    try {
      const data = await listWorks({
        page: targetPage,
        pageSize: pageSize || undefined,
        q: fetchParams.q,
        ageRatings: fetchParams.ageRatings,
        circles: fetchParams.circles,
        tags: fetchParams.tags,
        vas: fetchParams.vas,
        sort: fetchParams.sort,
        force,
      })
      if (token !== requestTokenRef.current) return null
      const resolvedPage = Number.isFinite(data?.page) ? data.page : targetPage
      const items = Array.isArray(data?.items) ? data.items : []
      startTransition(() => {
        setPages(prev => mergePageEntry(prev, { page: resolvedPage, items }, initial))
        setPageInfo(prev => mergePageInfo(prev, resolvedPage, data))
        if (initial) setResolvedStateKey(stateKey)
      })
      if (direction === 'up' && anchorSnapshot?.node && token === requestTokenRef.current) {
        restoreAnchorSnapshot(anchorSnapshot)
      }
      return data
    } catch (err) {
      console.error(err)
      if (initial && token === requestTokenRef.current) {
        setResolvedStateKey(stateKey)
      }
      return null
    } finally {
      if (token === requestTokenRef.current) {
        loadingPagesRef.current.delete(targetPage)
        startTransition(() => {
          if (direction === 'up') setLoadingPrev(false)
          if (direction === 'down') setLoadingNext(false)
        })
      }
    }
  }, [fetchParams, pageSize, stateKey])

  const loadFacets = useCallback(async (force = false) => {
    const token = facetRequestTokenRef.current
    try {
      const data = await listWorkFacets({
        q: fetchParams.q,
        ageRatings: fetchParams.ageRatings,
        circles: fetchParams.circles,
        tags: fetchParams.tags,
        vas: fetchParams.vas,
        force,
      })
      if (token !== facetRequestTokenRef.current) return null
      startTransition(() => {
        setFacets(ensureFacets(data))
      })
      return data
    } catch (err) {
      console.error(err)
      return null
    }
  }, [fetchParams])

  useEffect(() => {
    if (!pageSize || !stateKey) return
    requestTokenRef.current += 1
    facetRequestTokenRef.current += 1
    loadingPagesRef.current.clear()
    setLoadingPrev(false)
    setLoadingNext(false)

    const persisted = loadPersistedState(stateKey)
    persistedRef.current = { key: stateKey, value: persisted }

    let nextPages: PageEntry<Work>[] = []
    let nextInfo: PageInfo = createEmptyPageInfo()
    let nextFacets: Facets = ensureFacets(null)
    let hasInitialItems = false
    let refreshPage = 1

    if (hasPageItems(persisted?.pages)) {
      nextPages = persisted.pages
      nextInfo = persisted.pageInfo ? { ...createEmptyPageInfo(), ...persisted.pageInfo } : createEmptyPageInfo()
      nextFacets = persisted.facets ? ensureFacets(persisted.facets) : ensureFacets(initialFacetCache)
      hasInitialItems = true
      refreshPage = nextInfo.minPage ?? persisted.pages[0]?.page ?? 1
    } else if (initialCache?.items?.length) {
      nextPages = [toPageEntry(initialCache)]
      nextInfo = mergePageInfo(createEmptyPageInfo(), initialCache.page || 1, initialCache)
      nextFacets = ensureFacets(initialFacetCache)
      hasInitialItems = true
      refreshPage = initialCache.page || 1
    } else {
      nextPages = []
      nextInfo = createEmptyPageInfo()
      nextFacets = ensureFacets(initialFacetCache)
      refreshPage = 1
    }

    if (!hasInitialItems) setResolvedStateKey(null)
    startTransition(() => {
      setPages(nextPages)
      setPageInfo(nextInfo)
      setFacets(nextFacets)
      if (hasInitialItems) setResolvedStateKey(stateKey)
    })

    loadPage(refreshPage, {
      force: true,
      initial: !hasInitialItems,
      direction: hasInitialItems ? undefined : 'down',
    })
    void loadFacets(true)
  }, [stateKey, initialCache, initialFacetCache, loadPage, loadFacets, pageSize, cachedFirstPage?.items?.length])

  const handleEndReached = useCallback(() => {
    const nextPage = Number(pageInfo.maxPage || 0) + 1
    const hasNext =
      pageInfo.hasNext ||
      (pageInfo.totalPages !== null && pageInfo.maxPage !== null && pageInfo.maxPage < pageInfo.totalPages)
    if (!hasNext || loadingNext || initialLoading) return
    loadPage(nextPage, { direction: 'down' })
  }, [pageInfo, loadPage, loadingNext, initialLoading])

  const handleStartReached = useCallback(() => {
    const prevPage = Number(pageInfo.minPage || 1) - 1
    const canLoadPrev = (pageInfo.hasPrev || prevPage >= 1) && prevPage >= 1
    if (!canLoadPrev || loadingPrev || initialLoading) return
    loadPage(prevPage, { direction: 'up' })
  }, [pageInfo, loadPage, loadingPrev, initialLoading])

  const { bottomSentinelRef, topSentinelRef } = useInfiniteScrollSentinels({
    onEndReached: handleEndReached,
    onStartReached: handleStartReached,
  })

  useEffect(() => {
    if (!stateKey) return
    if (pageInfo.pageSize !== pageSize) return
    if (!hasPageItems(pages)) {
      clearPaginationState(stateKey)
      return
    }
    persistPaginationState(stateKey, { pages, pageInfo }, {
      facets: facets ? ensureFacets(facets) : null,
    })
  }, [pages, pageInfo, facets, pageSize, stateKey])

  const works = useMemo(() => flattenUniquePageItems(pages, item => item.id), [pages])

  const circles = facets?.circles || []
  const tags = facets?.tags || []
  const vas = facets?.vas || []

  // Local search inputs for large lists
  const [circleQuery, setCircleQuery] = useState('')
  const [tagQuery, setTagQuery] = useState('')
  const [vaQuery, setVaQuery] = useState('')

  const filterOptions = useCallback((list: FacetItem[], query: string, selected: string[]): FacetItem[] => {
    const q = (query || '').trim().toLowerCase()
    const src = Array.isArray(list) ? list : []
    const selectedNames = new Set(selected)
    let items = q ? src.filter(x => x.name.toLowerCase().includes(q)) : src
    items = items.slice().sort((a, b) => {
      const aSel = selectedNames.has(a.name) ? 1 : 0
      const bSel = selectedNames.has(b.name) ? 1 : 0
      if (aSel !== bSel) return bSel - aSel
      return a.name.localeCompare(b.name)
    })
    return items
  }, [])

  const circleOptions = useMemo(() => filterOptions(circles, circleQuery, selCircles), [circles, circleQuery, selCircles, filterOptions])
  const tagOptions = useMemo(() => filterOptions(tags, tagQuery, selTags), [tags, tagQuery, selTags, filterOptions])
  const vaOptions = useMemo(() => filterOptions(vas, vaQuery, selVas), [vas, vaQuery, selVas, filterOptions])

  // Quick add typeahead across all facets
  const [quickQ, setQuickQ] = useState('')
  const quickResults = useMemo((): QuickSearchItem[] => {
    const q = quickQ.trim().toLowerCase()
    if (!q) return []
    const withType = <T extends 'circle' | 'tag' | 'va'>(arr: FacetItem[], type: T): QuickSearchItem[] =>
      arr.map(x => ({ ...x, type }))
    const all: QuickSearchItem[] = [
      ...withType(circles, 'circle'),
      ...withType(tags, 'tag'),
      ...withType(vas, 'va'),
    ]
    return all
      .filter(x => x.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStart = a.name.toLowerCase().startsWith(q) ? 1 : 0
        const bStart = b.name.toLowerCase().startsWith(q) ? 1 : 0
        if (aStart !== bStart) return bStart - aStart
        if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0)
        return a.name.localeCompare(b.name)
      })
      .slice(0, 12)
  }, [quickQ, circles, tags, vas])

  const updateMulti = (key: string, values: string[]): void => {
    const next = new URLSearchParams(params)
    next.delete(key)
    values.forEach(v => {
      next.append(key, v)
    })
    setParams(next)
  }

  const toggleValue = (key: string, value: string): void => {
    const all = params.getAll(key)
    const exists = all.includes(value)
    const next = exists ? all.filter(v => v !== value) : [...all, value]
    updateMulti(key, next)
  }

  const setOne = (key: string, value: string): void => {
    const next = new URLSearchParams(params)
    if (value?.length) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  const setAgeRatingsParam = (selected: AgeRating[]): void => {
    const next = new URLSearchParams(params)
    next.delete('nsfw')
    next.delete('ageRating')
    if (selected.length === 0) next.append('ageRating', 'none')
    else if (selected.length < ALL_AGE_RATINGS.length) selected.forEach(rating => { next.append('ageRating', rating) })
    setParams(next)
  }

  const clearAll = (): void => setParams(new URLSearchParams())

  // Count and chips for active filters (mobile)
  const activeCount = (qText ? 1 : 0) + (ageRatings.length !== 3 ? 1 : 0) + selCircles.length + selTags.length + selVas.length

  const removeFilter = (type: string, value?: string): void => {
    if (type === 'q') setOne('q', '')
    else if (type === 'ageRating') setAgeRatingsParam(ALL_AGE_RATINGS)
    else if (value) toggleValue(type, value)
  }

  const filtersContent = (
    <FiltersContent
      quickQ={quickQ}
      setQuickQ={setQuickQ}
      quickResults={quickResults}
      onQuickSelect={(item) => { toggleValue(item.type, item.name); setQuickQ('') }}
      qText={qText}
      setQText={(value) => setOne('q', value)}
      ageRatings={ageRatings}
      setAgeRatings={setAgeRatingsParam}
      sort={sort}
      setSort={(value) => setOne('sort', value)}
      circleQuery={circleQuery}
      setCircleQuery={setCircleQuery}
      circleOptions={circleOptions}
      selCircles={selCircles}
      toggleCircle={(name) => toggleValue('circle', name)}
      tagQuery={tagQuery}
      setTagQuery={setTagQuery}
      tagOptions={tagOptions}
      selTags={selTags}
      toggleTag={(name) => toggleValue('tag', name)}
      vaQuery={vaQuery}
      setVaQuery={setVaQuery}
      vaOptions={vaOptions}
      selVas={selVas}
      toggleVa={(name) => toggleValue('va', name)}
      clearAll={clearAll}
    />
  )

  return (
    <div className="search-page">
      <div className="search-layout">
        {showDesktopFilters ? (
          <aside className="card search-sidebar">
            <div className="form-title">{t('Filters')}</div>
            {filtersContent}
          </aside>
        ) : null}

        <section className="search-content">
          {!showDesktopFilters ? <div className="search-mobile-toolbar">
            <Dropdown
              value={sort}
              onChange={(v) => setOne('sort', v)}
              options={SEARCH_SORT_OPTIONS.map(option => ({ ...option, label: t(option.label) }))}
            />
            <button type="button" className="btn" onClick={() => setMobileFiltersOpen(true)}>
              {t('Filters')}{activeCount ? ` (${activeCount})` : ''}
            </button>
          </div> : null}

          {!showDesktopFilters && activeCount > 0 && (
            <div className="card search-chip-card">
              <div className="search-chips search-chips--scroll">
                {qText ? (
                  <button type="button" className="tag" onClick={() => removeFilter('q')} title={t('Remove text filter')}>“{qText}” ×</button>
                ) : null}
                {ageRatings.length !== 3 ? (
                  <button type="button" className="tag" onClick={() => removeFilter('ageRating')} title={t('Clear content filter')}>{t(ageRatingsLabel(ageRatings))} ×</button>
                ) : null}
                {selCircles.map(name => (
                  <button type="button" key={`c:${name}`} className="tag" onClick={() => removeFilter('circle', name)} title={`Remove circle: ${name}`}>Circle: {name} ×</button>
                ))}
                {selTags.map(name => (
                  <button type="button" key={`t:${name}`} className="tag" onClick={() => removeFilter('tag', name)} title={`Remove tag: ${name}`}>Tag: {name} ×</button>
                ))}
                {selVas.map(name => (
                  <button type="button" key={`v:${name}`} className="tag" onClick={() => removeFilter('va', name)} title={`Remove VA: ${name}`}>VA: {name} ×</button>
                ))}
                <button type="button" className="btn btn-sm" onClick={clearAll}>{t('Clear all')}</button>
              </div>
            </div>
          )}

          <div className="search-results-wrapper">
            {loadingPrev && !initialLoading && (
              <div className="search-loading-bar" aria-hidden="true">
                <LoadingSpinner size="sm" label={t('Loading previous results…')} />
              </div>
            )}

            {works.length > 0 && (
              <div ref={topSentinelRef} style={{ width: '100%', height: 1, opacity: 0, pointerEvents: 'none' }} />
            )}

            <div className="search-results-grid" ref={setListGridRef} aria-busy={initialLoading}>
              {works.map(work => <GridWorkCard key={work.id} work={work} />)}
            </div>

            {initialLoading && (
              <div className="search-grid-loading">
                <LoadingSpinner size="md" centered label={t('Loading search results…')} />
              </div>
            )}

            {!initialLoading && works.length === 0 && (
              <div className="card search-empty-state" role="status">
                <div className="text-muted">{t('No results.')}</div>
              </div>
            )}

            {works.length > 0 && (
              <GridLoadingSpace
                sentinelRef={bottomSentinelRef}
                height={remainingHeight(pageInfo.total - (pageInfo.maxPage || 0) * (pageInfo.pageSize || pageSize || 24), !initialLoading && pageInfo.hasNext)}
                loading={loadingNext && !initialLoading}
              />
            )}
          </div>
        </section>
      </div>

      {!showDesktopFilters ? <div className={`search-drawer md:hidden ${mobileFiltersOpen ? 'search-drawer--open' : ''}`} data-no-ptr>
        <button
          type="button"
          className="search-drawer__backdrop"
          onClick={() => setMobileFiltersOpen(false)}
          aria-label={t('Close filters')}
        />
        <div className="search-drawer__panel" data-no-ptr>
          <div className="search-drawer__header">
            <div className="form-title">{t('Filters')}</div>
            <button type="button" className="btn btn-sm" onClick={() => setMobileFiltersOpen(false)}>{t('Done')}</button>
          </div>
          <div className="search-drawer__body" data-no-ptr>
            {mobileFiltersOpen ? filtersContent : null}
          </div>
        </div>
      </div> : null}
    </div>
  )
}

interface FiltersContentProps {
  quickQ: string
  setQuickQ: (v: string) => void
  quickResults: QuickSearchItem[]
  onQuickSelect: (item: QuickSearchItem) => void
  qText: string
  setQText: (v: string) => void
  ageRatings: AgeRating[]
  setAgeRatings: (ratings: AgeRating[]) => void
  sort: string
  setSort: (v: string) => void
  circleQuery: string
  setCircleQuery: (v: string) => void
  circleOptions: FacetItem[]
  selCircles: string[]
  toggleCircle: (name: string) => void
  tagQuery: string
  setTagQuery: (v: string) => void
  tagOptions: FacetItem[]
  selTags: string[]
  toggleTag: (name: string) => void
  vaQuery: string
  setVaQuery: (v: string) => void
  vaOptions: FacetItem[]
  selVas: string[]
  toggleVa: (name: string) => void
  clearAll: () => void
}

function FiltersContent({
  quickQ, setQuickQ, quickResults, onQuickSelect,
  qText, setQText,
  ageRatings, setAgeRatings,
  sort, setSort,
  circleQuery, setCircleQuery, circleOptions, selCircles, toggleCircle,
  tagQuery, setTagQuery, tagOptions, selTags, toggleTag,
  vaQuery, setVaQuery, vaOptions, selVas, toggleVa,
  clearAll,
}: FiltersContentProps) {
  const { t } = useI18n()
  const hasActiveFilters = qText || ageRatings.length !== 3 || selCircles.length > 0 || selTags.length > 0 || selVas.length > 0

  return (
    <div className="search-filters">
      {/* Quick Search */}
      <div className="search-filter-group">
        <div className="search-filter-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.35-4.35"></path>
          </svg>
          <h3 className="search-filter-title">{t('Quick Search')}</h3>
        </div>
        <div className="search-typeahead">
          <input
            className="input search-filter-input"
            placeholder={t('Find circle, tag, or VA...')}
            value={quickQ}
            onChange={e => setQuickQ(e.target.value)}
          />
          {quickResults.length > 0 && (
            <div className="search-typeahead__results">
              {quickResults.map(item => (
                <button type="button"
                  key={`${item.type}:${item.name}`}
                  className="search-typeahead__item"
                  onClick={() => onQuickSelect(item)}
                >
                  <div className="search-typeahead__details">
                    <span className={`search-filter-badge search-filter-badge--${item.type}`}>
                      {item.type === 'circle' ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                          <polyline points="9 22 9 12 15 12 15 22"></polyline>
                        </svg>
                      ) : item.type === 'tag' ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                          <line x1="7" y1="7" x2="7.01" y2="7"></line>
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        </svg>
                      )}
                      <span>{item.type}</span>
                    </span>
                    <span className="text-ellipsis">{item.name}</span>
                  </div>
                  {item.count ? <span className="search-filter-count">{item.count}</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Text Search */}
      <div className="search-filter-group">
        <div className="search-filter-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
          <h3 className="search-filter-title">{t('Text Search')}</h3>
        </div>
        <input
          className="input search-filter-input"
          placeholder={t('Search in titles, circles, tags...')}
          value={qText}
          onChange={e => setQText(e.target.value)}
        />
        {qText && (
          <button type="button" className="search-filter-clear" onClick={() => setQText('')} title={t('Clear text search')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        )}
      </div>

      {/* Content Filter */}
      <div className="search-filter-group">
        <div className="search-filter-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <h3 className="search-filter-title">{t('Content')}</h3>
        </div>
        <AgeRatingToggles value={ageRatings} onChange={setAgeRatings} />
      </div>

      {/* Sort */}
      <div className="search-filter-group">
        <div className="search-filter-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="16" y2="6"></line>
            <line x1="4" y1="12" x2="13" y2="12"></line>
            <line x1="4" y1="18" x2="10" y2="18"></line>
          </svg>
          <h3 className="search-filter-title">{t('Sort')}</h3>
        </div>
        <Dropdown
          value={sort}
          onChange={setSort}
          options={SEARCH_SORT_OPTIONS.map(option => ({ ...option, label: t(option.label) }))}
        />
      </div>

      {/* Circles */}
      <div className="search-filter-group search-filter-group--collapsible">
        <div className="search-filter-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
          <h3 className="search-filter-title">{t('Circles')}</h3>
          {selCircles.length > 0 && (
            <span className="search-filter-count search-filter-count--badge">{selCircles.length}</span>
          )}
        </div>
        <input
          className="input search-filter-input"
          placeholder={t('Filter circles...')}
          value={circleQuery}
          onChange={e => setCircleQuery(e.target.value)}
        />
        <div className="search-filter-list">
          {circleOptions.slice(0, 100).map(c => (
            // biome-ignore lint/a11y/noLabelWithoutControl: Checkbox renders the labelable button control.
            <label key={c.name} className="search-filter-option">
              <Checkbox
                checked={selCircles.includes(c.name)}
                onChange={() => toggleCircle(c.name)}
              />
              <span className="search-filter-option__name">{c.name}</span>
              {c.count && <span className="search-filter-count">{c.count}</span>}
            </label>
          ))}
          {circleOptions.length === 0 && (
            <div className="search-filter-empty">{t('No circles found')}</div>
          )}
          {circleOptions.length > 100 && (
            <div className="search-filter-info">Showing 100 of {circleOptions.length} circles. Refine your search.</div>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="search-filter-group search-filter-group--collapsible">
        <div className="search-filter-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
            <line x1="7" y1="7" x2="7.01" y2="7"></line>
          </svg>
          <h3 className="search-filter-title">{t('Tags')}</h3>
          {selTags.length > 0 && (
            <span className="search-filter-count search-filter-count--badge">{selTags.length}</span>
          )}
        </div>
        <input
          className="input search-filter-input"
          placeholder={t('Filter tags...')}
          value={tagQuery}
          onChange={e => setTagQuery(e.target.value)}
        />
        <div className="search-filter-list">
          {tagOptions.slice(0, 100).map(t => (
            // biome-ignore lint/a11y/noLabelWithoutControl: Checkbox renders the labelable button control.
            <label key={t.name} className="search-filter-option">
              <Checkbox
                checked={selTags.includes(t.name)}
                onChange={() => toggleTag(t.name)}
              />
              <span className="search-filter-option__name">{t.name}</span>
              {t.count && <span className="search-filter-count">{t.count}</span>}
            </label>
          ))}
          {tagOptions.length === 0 && (
            <div className="search-filter-empty">{t('No tags found')}</div>
          )}
          {tagOptions.length > 100 && (
            <div className="search-filter-info">Showing 100 of {tagOptions.length} tags. Refine your search.</div>
          )}
        </div>
      </div>

      {/* Voice Actors */}
      <div className="search-filter-group search-filter-group--collapsible">
        <div className="search-filter-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
          <h3 className="search-filter-title">{t('Voice Actors')}</h3>
          {selVas.length > 0 && (
            <span className="search-filter-count search-filter-count--badge">{selVas.length}</span>
          )}
        </div>
        <input
          className="input search-filter-input"
          placeholder={t('Filter voice actors...')}
          value={vaQuery}
          onChange={e => setVaQuery(e.target.value)}
        />
        <div className="search-filter-list">
          {vaOptions.slice(0, 100).map(v => (
            // biome-ignore lint/a11y/noLabelWithoutControl: Checkbox renders the labelable button control.
            <label key={v.name} className="search-filter-option">
              <Checkbox
                checked={selVas.includes(v.name)}
                onChange={() => toggleVa(v.name)}
              />
              <span className="search-filter-option__name">{v.name}</span>
              {v.count && <span className="search-filter-count">{v.count}</span>}
            </label>
          ))}
          {vaOptions.length === 0 && (
            <div className="search-filter-empty">{t('No voice actors found')}</div>
          )}
          {vaOptions.length > 100 && (
            <div className="search-filter-info">Showing 100 of {vaOptions.length} VAs. Refine your search.</div>
          )}
        </div>
      </div>

      {/* Clear All */}
      {hasActiveFilters && (
        <div className="search-filter-actions">
          <button type="button" className="btn btn-ghost search-filter-clear-all" onClick={clearAll}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            {t('Clear All Filters')}
          </button>
        </div>
      )}
    </div>
  )
}
