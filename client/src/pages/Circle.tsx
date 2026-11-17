import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { listWorks, getWorksCache } from '../lib/api'
import { useScrollRestoration } from '../lib/scroll'
import useGridPageSize from '../lib/useGridPageSize'
import useInfiniteScrollSentinels from '../lib/useInfiniteScrollSentinels'
import Dropdown from '../components/ui/Dropdown'
import GridWorkCard from '../components/ui/GridWorkCard'
import GridLoadingSpace from '../components/ui/GridLoadingSpace'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { useI18n } from '../lib/i18n'
import './Circle.css'
import type { Work } from '../types'

type Tag = { id?: number | string; name: string };
type WorkListItem = Work & { tags?: Tag[] };
type ListResponse = { items?: WorkListItem[]; page?: number; pageSize?: number; total?: number; totalPages?: number; hasNext?: boolean; hasPrev?: boolean };
type PageMeta = { page: number; pageSize?: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };

export default function Circle() {
  const { t } = useI18n()
  const params = useParams()
  const navigate = useNavigate()
  let circleName = params?.name || ''
  try { circleName = decodeURIComponent(circleName) } catch { }
  const [sort, setSort] = useState<'release_desc' | 'release_asc' | 'title_asc' | 'title_desc'>('release_desc') // release_desc|release_asc|title_asc|title_desc
  const { gridRef, pageSize, remainingHeight } = useGridPageSize(24)
  const queryOptions = circleName && pageSize ? { page: 1, pageSize, circles: [circleName], sort } : null
  const initialCache = queryOptions ? (getWorksCache(queryOptions) as ListResponse | null) : null
  const [results, setResults] = useState<WorkListItem[]>(() => (initialCache?.items as WorkListItem[] | undefined) || [])
  const [pageMeta, setPageMeta] = useState<PageMeta>(() => ({
    page: initialCache?.page || 1,
    pageSize: initialCache?.pageSize || undefined,
    total: initialCache?.total || (initialCache?.items?.length ?? 0),
    totalPages: initialCache?.totalPages || 0,
    hasNext: initialCache?.hasNext ?? false,
    hasPrev: initialCache?.hasPrev ?? false,
  }))
  const [loading, setLoading] = useState(() => circleName ? !initialCache : false)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestTokenRef = useRef(0)
  const loadingMoreRef = useRef(false)

  useScrollRestoration(`circle:${circleName || 'unknown'}`)

  useEffect(() => {
    let mounted = true
    requestTokenRef.current += 1
    loadingMoreRef.current = false
    setLoadingMore(false)
    if (!pageSize) return () => { mounted = false }
    if (!circleName) {
      startTransition(() => {
        setResults([])
        setPageMeta({
          page: 1,
          pageSize: undefined,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        })
      })
      setLoading(false)
      return () => { mounted = false }
    }
    const fetchOptions = { page: 1, pageSize, circles: [circleName], sort }
    const cached = getWorksCache(fetchOptions) as ListResponse | undefined

    if (cached) {
      startTransition(() => {
        setResults(cached.items || [])
        setPageMeta({
          page: cached.page || 1,
          pageSize: cached.pageSize,
          total: cached.total || (cached.items?.length ?? 0),
          totalPages: cached.totalPages || 0,
          hasNext: cached.hasNext ?? false,
          hasPrev: cached.hasPrev ?? false,
        })
      })
      setLoading(false)
    } else {
      setLoading(true)
      listWorks(fetchOptions)
        .then((data: ListResponse) => {
          if (!mounted || !data) return
          startTransition(() => {
            setResults(data.items || [])
            setPageMeta({
              page: data.page || 1,
              pageSize: data.pageSize,
              total: data.total || (data.items?.length ?? 0),
              totalPages: data.totalPages || 0,
              hasNext: data.hasNext ?? false,
              hasPrev: data.hasPrev ?? false,
            })
          })
        })
        .catch(err => { if (mounted) console.error(err) })
        .finally(() => {
          if (mounted) {
            setLoading(false)
            setLoadingMore(false)
          }
        })
    }

    return () => { mounted = false; requestTokenRef.current += 1 }
  }, [circleName, pageSize, sort])

  const handleLoadMore = useCallback(() => {
    if (loading || loadingMore || loadingMoreRef.current || !pageMeta.hasNext || !circleName) return
    const token = requestTokenRef.current
    loadingMoreRef.current = true
    const nextPage = (pageMeta.page || 1) + 1
    setLoadingMore(true)
    listWorks({ page: nextPage, pageSize: pageSize || undefined, circles: [circleName], sort })
      .then((data: ListResponse) => {
        if (!data || token !== requestTokenRef.current) return
        startTransition(() => {
          setResults(prev => {
            const existing = new Set(prev.map(w => w.id))
            const incoming = (data.items || []).filter(w => !existing.has(w.id))
            return [...prev, ...incoming]
          })
          setPageMeta({
            page: data.page || nextPage,
            pageSize: data.pageSize,
            total: data.total || 0,
            totalPages: data.totalPages || 0,
            hasNext: data.hasNext ?? false,
            hasPrev: data.hasPrev ?? ((data.page || nextPage) > 1),
          })
        })
      })
      .catch(err => console.error(err))
      .finally(() => {
        if (token !== requestTokenRef.current) return
        loadingMoreRef.current = false
        startTransition(() => setLoadingMore(false))
      })
  }, [circleName, loading, loadingMore, pageMeta.hasNext, pageMeta.page, pageSize, sort])

  const { bottomSentinelRef } = useInfiniteScrollSentinels({
    onEndReached: handleLoadMore,
  })

  if (!circleName) {
    return (
      <div className="page-stack">
        <div className="card">{t('Circle not found.')}</div>
      </div>
    )
  }

  return (
    <div className="circle-page">
      <div className="circle-header">
        <button type="button"
          className="circle-back-btn"
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
        <div className="circle-header__content">
          <h1 className="circle-header__title">{circleName}</h1>
          <p className="circle-header__subtitle">
            {loading ? 'Loading...' : `${pageMeta.total} work${pageMeta.total !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="circle-header__controls">
          <div className="circle-sort-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="16" y2="6"></line>
              <line x1="4" y1="12" x2="13" y2="12"></line>
              <line x1="4" y1="18" x2="10" y2="18"></line>
            </svg>
            <span>{t('Sort')}</span>
          </div>
          <Dropdown
            value={sort}
            onChange={(value) => setSort(value as 'release_desc' | 'release_asc' | 'title_asc' | 'title_desc')}
            options={[
              { value: 'release_desc', label: 'Release: Newest' },
              { value: 'release_asc', label: 'Release: Oldest' },
              { value: 'title_asc', label: 'Title: A → Z' },
              { value: 'title_desc', label: 'Title: Z → A' },
            ]}
          />
        </div>
      </div>

      <div className="circle-grid" ref={gridRef}>
        {results.map(work => <GridWorkCard key={work.id} work={work} />)}
      </div>

      {loading && (
        <div className="circle-grid-loading">
          <LoadingSpinner size="md" centered label="Loading circle works…" />
        </div>
      )}

      {!loading && results.length === 0 && (
        <div className="circle-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>{t('No works found for this circle.')}</p>
        </div>
      )}

      {results.length > 0 && (
        <GridLoadingSpace
          sentinelRef={bottomSentinelRef}
          height={remainingHeight(pageMeta.total - results.length, !loading && pageMeta.hasNext)}
          loading={loadingMore}
        />
      )}

    </div>
  )
}
