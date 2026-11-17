import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useNavigationType } from 'react-router-dom'
import { useScrollRestoration } from '../lib/scroll'
import { listWorks, getWorksCache } from '../lib/api'
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
import AgeRatingToggles from '../components/ui/AgeRatingToggles'
import { ALL_AGE_RATINGS, normalizeAgeRatings, ratingsFromContentFilter } from '../lib/ageRating'
import GridWorkCard from '../components/ui/GridWorkCard'
import GridLoadingSpace from '../components/ui/GridLoadingSpace'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import './Home.css'
import type { AgeRating, PageEntry, PageInfo, Work } from '../types'
import type { PaginatedResponse, PaginationState } from '../lib/paginationState'
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, SetStateAction } from 'react'
import { useI18n } from '../lib/i18n'

const STATE_PREFIX = 'home:state:'
const QUERY_STORAGE_KEY = 'home:lastQuery'
const SEARCH_COMPACT_STORAGE_KEY = 'home:searchCompact'

type Tag = { id?: number | string; name: string };
type VoiceActor = { name: string };
type WorkListItem = Work & { tags?: Tag[]; vas?: VoiceActor[] };
type WorksPageEntry = PageEntry<WorkListItem>;
type PersistedState = PaginationState<WorkListItem>;
type ListResponse = PaginatedResponse<WorkListItem>;
type LoadPageOptions = { direction?: 'up' | 'down'; force?: boolean; initial?: boolean };

const normalizeQuery = (value = ''): string => value.trim().toLowerCase()
const getStateKey = (ageRatings: AgeRating[], query: string) => `${STATE_PREFIX}${ageRatings.join(',') || 'none'}::${normalizeQuery(query)}`

function SearchBar({ query, setQuery }: { query: string; setQuery: Dispatch<SetStateAction<string>> }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const navType = useNavigationType()
  const [isCompact, setIsCompact] = useState(() => {
    if (navType !== 'POP') return false
    try { return sessionStorage.getItem(SEARCH_COMPACT_STORAGE_KEY) === 'true' } catch { return false }
  })
  const [sharesNavRow, setSharesNavRow] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const smallScreen = window.matchMedia('(max-width: 639px)')
    let frame = 0
    let lastScrollY = window.scrollY

    const updateCompact = (keepRestoredMode = false) => {
      frame = 0
      const scrollY = window.scrollY
      if (smallScreen.matches) {
        const stickyTop = Number.parseFloat(window.getComputedStyle(container).top) || 0
        const search = container.querySelector('.home-search-wrapper')?.getBoundingClientRect()
        const toggle = document.querySelector('.app-mobile-nav-toggle')?.getBoundingClientRect()
        setSharesNavRow(Boolean(search && toggle && toggle.width > 0 && search.top < toggle.bottom + 6 && search.bottom > toggle.top))
        if (!keepRestoredMode) {
          if (scrollY < 50) {
            setIsCompact(false)
          } else if (scrollY > 100 && scrollY >= lastScrollY && container.getBoundingClientRect().top <= stickyTop + 1) {
            setIsCompact(true)
          }
        }
      } else {
        setSharesNavRow(false)
        // Keep the sticky slot stable so changing the bar never moves the results.
        if (!keepRestoredMode) setIsCompact(scrollY > 8)
      }
      lastScrollY = scrollY
    }
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(() => updateCompact())
    }

    // Restore the mode on the first render; let subsequent scroll events measure
    // the restored position without replaying the expanded-to-compact animation.
    updateCompact(navType === 'POP')
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    smallScreen.addEventListener('change', scheduleUpdate)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      smallScreen.removeEventListener('change', scheduleUpdate)
    }
  }, [navType])

  useEffect(() => {
    try { sessionStorage.setItem(SEARCH_COMPACT_STORAGE_KEY, String(isCompact)) } catch { }
  }, [isCompact])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const q = (query || '').trim()
      navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search')
    }
  }

  return (
    <div ref={containerRef} className={`home-search-container ${isCompact ? 'compact' : ''} ${sharesNavRow ? 'shares-nav-row' : ''}`}>
      <div className="home-search-wrapper">
        <svg className="home-search-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 17C13.4183 17 17 13.4183 17 9C17 4.58172 13.4183 1 9 1C4.58172 1 1 4.58172 1 9C1 13.4183 4.58172 17 9 17Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19 19L14.65 14.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <input
          className="home-search-input"
          type="search"
          name="search"
          autoComplete="off"
          inputMode="text"
          spellCheck={false}
          aria-label={t('Search library')}
          placeholder={t('Search title, circle, tags, VAs or RJ number')}
          data-1p-ignore
          data-bwignore="true"
          data-lpignore="true"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  )
}

export default function Home() {
  const { t } = useI18n()
  const [query, setQuery] = useState<string>(() => {
    try { return sessionStorage.getItem(QUERY_STORAGE_KEY) || '' } catch { return '' }
  })
  const [ageRatings, setAgeRatings] = useState<AgeRating[]>(() => {
    try {
      const saved = localStorage.getItem('ageRatings')
      if (saved !== null) {
        try {
          const parsed: unknown = JSON.parse(saved)
          if (Array.isArray(parsed) && parsed.every(value => value === 'sfw' || value === 'r15' || value === 'r18')) {
            return normalizeAgeRatings(parsed)
          }
        } catch { /* Fall back to the older single-rating setting. */ }
      }
      const stored = localStorage.getItem('nsfwFilter')
      return ratingsFromContentFilter(stored)
    } catch { return [...ALL_AGE_RATINGS] }
  })
  useScrollRestoration('home')

  const loadingPagesRef = useRef<Set<number>>(new Set())
  const requestTokenRef = useRef(0)
  const persistedRef = useRef<{ key: string | null; value: PersistedState | null }>({ key: null, value: null })
  const listRef = useRef<HTMLDivElement | null>(null)
  const { gridRef, pageSize, remainingHeight } = useGridPageSize(24)
  const setListGridRef = useCallback((grid: HTMLDivElement | null) => {
    listRef.current = grid
    gridRef(grid)
  }, [gridRef])

  const stateKey = pageSize ? `${getStateKey(ageRatings, query)}::${pageSize}` : null
  if (persistedRef.current.key !== stateKey) {
    persistedRef.current = { key: stateKey, value: loadPaginationState<WorkListItem>(stateKey) }
  }
  const persistedState = persistedRef.current.value
  const hasPersistedItems = hasPageItems(persistedState?.pages)
  const cachedFirstPage = useMemo(() => {
    if (!pageSize || hasPersistedItems) return null
    return getWorksCache({ page: 1, pageSize, ageRatings, q: query }) as ListResponse | undefined
  }, [hasPersistedItems, ageRatings, pageSize, query])

  const [pages, setPages] = useState<WorksPageEntry[]>(() => {
    if (hasPersistedItems) return persistedState?.pages ?? []
    if (cachedFirstPage?.items?.length) return [toPageEntry(cachedFirstPage)]
    return []
  })
  const [pageInfo, setPageInfo] = useState<PageInfo>(() => {
    if (hasPersistedItems && persistedState?.pageInfo) return { ...createEmptyPageInfo(), ...persistedState.pageInfo }
    if (cachedFirstPage) return mergePageInfo(createEmptyPageInfo(), cachedFirstPage.page || 1, cachedFirstPage)
    return createEmptyPageInfo()
  })
  const [resolvedStateKey, setResolvedStateKey] = useState<string | null>(null)
  const [loadingPrev, setLoadingPrev] = useState(false)
  const [loadingNext, setLoadingNext] = useState(false)
  const initialLoading = !stateKey || resolvedStateKey !== stateKey

  useEffect(() => {
    try { localStorage.setItem('ageRatings', JSON.stringify(ageRatings)) } catch { }
  }, [ageRatings])

  useEffect(() => {
    try { sessionStorage.setItem(QUERY_STORAGE_KEY, query) } catch { }
  }, [query])

  const loadPage = useCallback(async (page: number, options: LoadPageOptions = {}) => {
    const targetPage = Number(page)
    if (!Number.isFinite(targetPage) || targetPage < 1) return null
    if (loadingPagesRef.current.has(targetPage)) return null
    const { direction, force = false, initial = false } = options
    const token = requestTokenRef.current
    const anchorSnapshot = direction === 'up' ? captureAnchorSnapshot(listRef.current) : null

    loadingPagesRef.current.add(targetPage)
    if (direction === 'up') setLoadingPrev(true)
    if (direction === 'down') setLoadingNext(true)

    try {
      const data = await listWorks({ page: targetPage, pageSize: pageSize || undefined, ageRatings, q: query, force }) as ListResponse
      if (token !== requestTokenRef.current) return null
      const resolvedPage: number = Number.isFinite(data?.page) ? Number(data.page) : targetPage
      const items = Array.isArray(data?.items) ? data.items as WorkListItem[] : []
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
  }, [ageRatings, pageSize, query, stateKey])

  useEffect(() => {
    if (!pageSize) return
    requestTokenRef.current += 1
    loadingPagesRef.current.clear()
    setLoadingPrev(false)
    setLoadingNext(false)

    const persisted = loadPaginationState<WorkListItem>(stateKey)
    persistedRef.current = { key: stateKey, value: persisted }

    if (hasPageItems(persisted?.pages)) {
      startTransition(() => {
        setPages(persisted.pages)
        setPageInfo(persisted.pageInfo ? { ...createEmptyPageInfo(), ...persisted.pageInfo } : createEmptyPageInfo())
        setResolvedStateKey(stateKey)
      })

      const firstPage = persisted.pageInfo?.minPage ?? persisted.pages[0]?.page ?? 1
      loadPage(firstPage, { force: true })
      return
    }

    if (cachedFirstPage?.items?.length) {
      startTransition(() => {
        setPages([toPageEntry(cachedFirstPage)])
        setPageInfo(mergePageInfo(createEmptyPageInfo(), cachedFirstPage.page || 1, cachedFirstPage))
        setResolvedStateKey(stateKey)
      })
      loadPage(cachedFirstPage.page || 1, { force: true })
      return
    }

    setResolvedStateKey(null)
    startTransition(() => {
      setPages([])
      setPageInfo(createEmptyPageInfo())
    })
    loadPage(1, { direction: 'down', force: true, initial: true })
  }, [stateKey, loadPage, pageSize, cachedFirstPage])

  const handleEndReached = useCallback(() => {
    const nextPage = Number(pageInfo.maxPage || 0) + 1
    const hasNext = pageInfo.hasNext || (pageInfo.totalPages !== null && nextPage <= pageInfo.totalPages)
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
    persistPaginationState(stateKey, { pages, pageInfo })
  }, [pages, pageInfo, pageSize, stateKey])

  const works = useMemo(() => flattenUniquePageItems(pages, item => item.id), [pages])

  return (
    <div className="home-layout">
      <SearchBar query={query} setQuery={setQuery} />
      <div className="home-filter-card card">
        <div className="home-filter-label">{t('Content Filter')}</div>
        <AgeRatingToggles value={ageRatings} onChange={setAgeRatings} />
      </div>
      <div className="home-content-wrapper">
        {loadingPrev && !initialLoading && (
          <div className="home-loading-bar" aria-hidden="true">
            <LoadingSpinner size="sm" label={t('Loading previous works…')} />
          </div>
        )}

        {works.length > 0 && (
          <div ref={topSentinelRef} style={{ width: '100%', height: 1, opacity: 0, pointerEvents: 'none' }} />
        )}

        <div className="home-grid" ref={setListGridRef} aria-busy={initialLoading}>
          {initialLoading ? (
            <div className="home-grid-loading">
              <LoadingSpinner size="md" centered label={t('Loading library…')} />
            </div>
          ) : (
            works.map(work => <GridWorkCard key={work.id} work={work} />)
          )}
        </div>

        {!initialLoading && works.length === 0 && (
          <div className="card home-empty-state" role="status">
            <svg className="home-empty-icon" width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" opacity="0.3" />
              <path d="M24 16V24M24 32H24.02" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <div className="home-empty-title">{t('No works found')}</div>
            <div className="home-empty-text">{t('Try adjusting your filters or search query')}</div>
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
    </div>
  )
}
