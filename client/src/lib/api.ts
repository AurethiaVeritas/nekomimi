import { withBasePath } from './basePath'
import { requestJson } from './http'
import { clearSavedWorkGridStates } from './workGridState'
import type { AgeRating, CircleSummary, Collection, CollectionMatch, CollectionType, Facets, FileListing, LogEntry, NsfwFilter, Settings, Work, WorkListResponse, ProxyCheckResult } from '../types'

type SortOption = 'name_asc' | 'name_desc' | 'count_desc' | 'count_asc' | string

export type ListWorksOptions = {
  page?: number
  pageSize?: number
  q?: string
  nsfw?: NsfwFilter
  ageRatings?: AgeRating[]
  circles?: string[]
  tags?: string[]
  vas?: string[]
  sort?: string
  force?: boolean
}

// Lightweight in-memory cache keyed by query params
const _worksCache = new Map<string, WorkListResponse>()
const _workFacetsCache = new Map<string, Facets>()
const _circlesCache = new Map<string, CircleSummary[]>()
const _circlesPending = new Map<string, Promise<CircleSummary[]>>()
let cacheGeneration = 0

export type ListWorkFacetsOptions = Omit<ListWorksOptions, 'page' | 'pageSize' | 'sort'>

const normalizeList = (list: string[] | unknown) => (
  Array.isArray(list) ? [...new Set(list.map(v => String(v || '').trim()))].sort() : []
)

const appendAgeRatingFilter = (url: URL, ageRatings: AgeRating[] | undefined, nsfw: NsfwFilter) => {
  if (ageRatings === undefined) {
    url.searchParams.set('nsfw', nsfw)
  } else if (ageRatings.length === 0) {
    url.searchParams.set('ageRating', 'none')
  } else {
    normalizeList(ageRatings).forEach(rating => { url.searchParams.append('ageRating', rating) })
  }
}

const toCacheKey = (options: ListWorksOptions = {}) => {
  const {
    page = 1,
    pageSize,
    q = '',
    nsfw = 'all',
    ageRatings,
    circles = [],
    tags = [],
    vas = [],
    sort = '',
  } = options || {}
  return JSON.stringify({
    page,
    pageSize: pageSize || null,
    q,
    nsfw,
    ageRatings: ageRatings === undefined ? null : normalizeList(ageRatings),
    circles: normalizeList(circles),
    tags: normalizeList(tags),
    vas: normalizeList(vas),
    sort,
  })
}

const toFacetCacheKey = (options: ListWorkFacetsOptions = {}) => {
  const {
    q = '',
    nsfw = 'all',
    ageRatings,
    circles = [],
    tags = [],
    vas = [],
  } = options || {}
  return JSON.stringify({
    q,
    nsfw,
    ageRatings: ageRatings === undefined ? null : normalizeList(ageRatings),
    circles: normalizeList(circles),
    tags: normalizeList(tags),
    vas: normalizeList(vas),
  })
}

const toCirclesCacheKey = (options: { nsfw?: NsfwFilter; ageRatings?: AgeRating[]; sort?: SortOption } = {}) => {
  const { nsfw = 'all', ageRatings, sort = 'name_asc' } = options || {}
  return JSON.stringify({ nsfw, ageRatings: ageRatings === undefined ? null : normalizeList(ageRatings), sort })
}

export function getWorksCache(options: ListWorksOptions = {}): WorkListResponse | undefined {
  return _worksCache.get(toCacheKey(options))
}

export function getWorkFacetsCache(options: ListWorkFacetsOptions = {}): Facets | undefined {
  return _workFacetsCache.get(toFacetCacheKey(options))
}

export function invalidateWorksCache(options?: ListWorksOptions) {
  if (!options) {
    cacheGeneration += 1
    _worksCache.clear()
    _workFacetsCache.clear()
    _circlesCache.clear()
    _circlesPending.clear()
    try { clearSavedWorkGridStates(sessionStorage) } catch { }
    return
  }
  _worksCache.delete(toCacheKey(options))
  _workFacetsCache.delete(toFacetCacheKey(options))
}

export async function listWorks(options: ListWorksOptions = {}): Promise<WorkListResponse> {
  const {
    page = 1,
    pageSize,
    q,
    nsfw = 'all',
    ageRatings,
    circles = [],
    tags = [],
    vas = [],
    sort,
    force = false,
  } = options || {}
  const cacheKey = toCacheKey({ page, pageSize, q, nsfw, ageRatings, circles, tags, vas, sort })
  const cached = _worksCache.get(cacheKey)
  if (!force && cached) return cached
  const generation = cacheGeneration
  const url = new URL(withBasePath('/api/works'), window.location.origin)
  url.searchParams.set('page', String(page))
  if (pageSize) url.searchParams.set('pageSize', String(pageSize))
  if (q) url.searchParams.set('q', q)
  appendAgeRatingFilter(url, ageRatings, nsfw)
  if (sort) url.searchParams.set('sort', sort)
  circles.filter(Boolean).forEach(c => {
    url.searchParams.append('circle', c)
  })
  tags.filter(Boolean).forEach(t => {
    url.searchParams.append('tag', t)
  })
  vas.filter(Boolean).forEach(v => {
    url.searchParams.append('va', v)
  })
  const data = await requestJson<WorkListResponse>(url, { errorMessage: 'Failed to fetch works', cache: 'no-store' })
  if (generation === cacheGeneration) _worksCache.set(cacheKey, data)
  return data
}

export async function listWorkFacets(options: ListWorkFacetsOptions = {}): Promise<Facets> {
  const {
    q,
    nsfw = 'all',
    ageRatings,
    circles = [],
    tags = [],
    vas = [],
    force = false,
  } = options || {}
  const cacheKey = toFacetCacheKey({ q, nsfw, ageRatings, circles, tags, vas })
  const cached = _workFacetsCache.get(cacheKey)
  if (!force && cached) return cached
  const generation = cacheGeneration
  const url = new URL(withBasePath('/api/works/facets'), window.location.origin)
  if (q) url.searchParams.set('q', q)
  appendAgeRatingFilter(url, ageRatings, nsfw)
  circles.filter(Boolean).forEach(c => {
    url.searchParams.append('circle', c)
  })
  tags.filter(Boolean).forEach(t => {
    url.searchParams.append('tag', t)
  })
  vas.filter(Boolean).forEach(v => {
    url.searchParams.append('va', v)
  })
  const data = await requestJson<Facets>(url, { errorMessage: 'Failed to fetch work facets', cache: 'no-store' })
  if (generation === cacheGeneration) _workFacetsCache.set(cacheKey, data)
  return data
}

export type CollectionInput = {
  name: string
  type: CollectionType
  match?: CollectionMatch
  contentFilter?: NsfwFilter
  ageRatings?: AgeRating[]
  tags?: string[]
}

export async function listCollections(workId?: number | string): Promise<Collection[]> {
  const url = new URL(withBasePath('/api/collections'), window.location.origin)
  if (workId !== undefined) url.searchParams.set('workId', String(workId))
  return requestJson<Collection[]>(url, { cache: 'no-store' })
}

export async function getCollection(id: number | string): Promise<Collection> {
  return requestJson<Collection>(withBasePath(`/api/collections/${id}`), { cache: 'no-store' })
}

export async function createCollection(input: CollectionInput): Promise<Collection> {
  return requestJson<Collection>(withBasePath('/api/collections'), {
    method: 'POST',
    json: input,
  })
}

export async function updateCollection(id: number | string, input: CollectionInput): Promise<Collection> {
  return requestJson<Collection>(withBasePath(`/api/collections/${id}`), {
    method: 'PUT',
    json: input,
  })
}

export async function deleteCollection(id: number | string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(withBasePath(`/api/collections/${id}`), {
    method: 'DELETE',
  })
}

export async function listCollectionWorks(
  id: number | string,
  options: { page?: number; pageSize?: number; sort?: string } = {}
): Promise<WorkListResponse> {
  const url = new URL(withBasePath(`/api/collections/${id}/works`), window.location.origin)
  if (options.page) url.searchParams.set('page', String(options.page))
  if (options.pageSize) url.searchParams.set('pageSize', String(options.pageSize))
  if (options.sort) url.searchParams.set('sort', options.sort)
  return requestJson<WorkListResponse>(url, { cache: 'no-store' })
}

export async function setCollectionWorkMembership(
  collectionId: number | string,
  workId: number | string,
  included: boolean
): Promise<Collection> {
  return requestJson<Collection>(withBasePath(`/api/collections/${collectionId}/works/${workId}`), {
    method: 'PUT',
    json: { included },
  })
}

export async function listCircles(options: { nsfw?: NsfwFilter; ageRatings?: AgeRating[]; sort?: SortOption } = {}): Promise<CircleSummary[]> {
  const { nsfw = 'all', ageRatings, sort = 'name_asc' } = options || {}
  const cacheKey = toCirclesCacheKey({ nsfw, ageRatings, sort })
  const cached = _circlesCache.get(cacheKey)
  if (cached) return cached
  const inflight = _circlesPending.get(cacheKey)
  if (inflight) return inflight
  const generation = cacheGeneration
  const url = new URL(withBasePath('/api/circles'), window.location.origin)
  appendAgeRatingFilter(url, ageRatings, nsfw)
  if (sort) url.searchParams.set('sort', sort)
  const pending = (async () => {
    const data = await requestJson<CircleSummary[]>(url, { errorMessage: 'Failed to fetch circles', cache: 'no-store' })
    if (generation === cacheGeneration) _circlesCache.set(cacheKey, data)
    return data
  })()
  _circlesPending.set(cacheKey, pending)
  try {
    return await pending
  } finally {
    if (_circlesPending.get(cacheKey) === pending) _circlesPending.delete(cacheKey)
  }
}

export async function getWork(id: number | string): Promise<Work> {
  return requestJson<Work>(withBasePath(`/api/works/${id}`), { cache: 'no-store' })
}

export async function importWork({ id, language, mediaPath, coverPath, forceCoverRefresh }: { id: string | number; language?: string; mediaPath?: string; coverPath?: string; forceCoverRefresh?: boolean }): Promise<Work> {
  return requestJson<Work>(withBasePath('/api/import/dlsite'), {
    method: 'POST',
    json: { id, language, mediaPath, coverPath, forceCoverRefresh },
  })
}

export async function attachMedia(id: number | string, files: string[]): Promise<Work> {
  return requestJson<Work>(withBasePath(`/api/works/${id}/media`), {
    method: 'POST',
    json: { files },
  })
}

export type WorkAlignmentResult = Work & {
  aligned?: boolean
  message?: string
  repairRequired?: boolean
  issueCode?: string
  currentPath?: string | null
  inaccessiblePath?: string
  suggestedPath?: string
  coverRestored?: boolean
}

export async function alignWork(id: number | string): Promise<WorkAlignmentResult> {
  return requestJson<WorkAlignmentResult>(withBasePath(`/api/works/${id}/align`), { method: 'POST' })
}

export async function updateWork(id: number | string, patch: Partial<Work>): Promise<Work> {
  return requestJson<Work>(withBasePath(`/api/works/${id}`), {
    method: 'PUT',
    json: patch,
  })
}

export async function deleteWork(id: number | string): Promise<{ ok?: boolean; deleted?: boolean }> {
  return requestJson<{ ok?: boolean; deleted?: boolean }>(withBasePath(`/api/works/${id}`), { method: 'DELETE' })
}

export async function listFiles(id: number | string, relPath = ''): Promise<FileListing> {
  const url = new URL(withBasePath(`/api/works/${id}/files`), window.location.origin)
  if (relPath) url.searchParams.set('p', relPath)
  return requestJson<FileListing>(url)
}

export async function getSettings(): Promise<Settings> {
  return requestJson<Settings>(withBasePath('/api/settings'), {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
  })
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  return requestJson<Settings>(withBasePath('/api/settings'), {
    method: 'PUT',
    json: patch,
  })
}

export async function checkProxyConnection(): Promise<ProxyCheckResult> {
  return requestJson<ProxyCheckResult>(withBasePath('/api/settings/proxy-check'), {
    method: 'POST',
    cache: 'no-store',
  })
}

export async function getActiveScan(): Promise<{ jobId: string | null; status: string }> {
  return requestJson<{ jobId: string | null; status: string }>(withBasePath('/api/scan/active'))
}

// Upload a temporary cover image; returns { path } to feed into importWork
export async function uploadTempCover(file: File | Blob): Promise<{ path: string }> {
  if (!file) throw new Error('No file')
  const url = new URL(withBasePath('/api/cover/temp'), window.location.origin)
  const filename = file instanceof File && file.name ? file.name : 'cover.jpg'
  url.searchParams.set('filename', filename)
  return requestJson<{ path: string }>(url, { method: 'POST', body: file })
}

// Upload and set the cover for an existing work; returns updated work
export async function uploadWorkCover(id: number | string, file: File | Blob): Promise<Work> {
  if (!file) throw new Error('No file')
  const url = new URL(withBasePath(`/api/works/${id}/cover`), window.location.origin)
  const filename = file instanceof File && file.name ? file.name : 'cover.jpg'
  url.searchParams.set('filename', filename)
  return requestJson<Work>(url, { method: 'POST', body: file })
}

// Get recent server logs
export async function getLogs(limit = 100): Promise<{ logs: LogEntry[] }> {
  const url = new URL(withBasePath('/api/logs'), window.location.origin)
  url.searchParams.set('limit', String(limit))
  return requestJson<{ logs: LogEntry[] }>(url)
}
