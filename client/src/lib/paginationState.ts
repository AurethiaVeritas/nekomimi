import type { PageEntry, PageInfo } from '../types'

export type PaginatedResponse<T> = {
  page?: number
  pageSize?: number
  items?: T[]
  totalPages?: number
  total?: number
  hasPrev?: boolean
  hasNext?: boolean
}

export type PaginationState<T> = {
  pages: PageEntry<T>[]
  pageInfo: PageInfo | null
}

export type AnchorSnapshot = {
  node: Element
  top: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const toPageNumber = (value: unknown, fallback = 1): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const createEmptyPageInfo = (): PageInfo => ({
  minPage: null,
  maxPage: null,
  totalPages: null,
  total: 0,
  pageSize: null,
  hasPrev: false,
  hasNext: false,
})

export function hasPageItems<T>(entries: PageEntry<T>[] | null | undefined): entries is PageEntry<T>[] {
  return Boolean(entries?.some(entry => Array.isArray(entry.items) && entry.items.length > 0))
}

export function toPageEntry<T>(response: PaginatedResponse<T> | null | undefined): PageEntry<T> {
  return {
    page: toPageNumber(response?.page),
    items: Array.isArray(response?.items) ? response.items : [],
  }
}

function normalizePageEntries<T>(value: unknown): PageEntry<T>[] {
  if (!Array.isArray(value)) return []
  return value.map(entry => {
    const page = isRecord(entry) ? entry.page : undefined
    const items = isRecord(entry) && Array.isArray(entry.items) ? entry.items as T[] : []
    return { page: toPageNumber(page), items }
  })
}

function normalizePageInfo(value: unknown): PageInfo | null {
  return isRecord(value)
    ? { ...createEmptyPageInfo(), ...value } as PageInfo
    : null
}

export function loadPaginationState<T, Extra extends object = Record<never, never>>(
  key: string | null,
  parseExtra?: (stored: Record<string, unknown>) => Extra,
): (PaginationState<T> & Extra) | null {
  if (!key) return null
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return null
    const extra = parseExtra?.(parsed) ?? ({} as Extra)
    return {
      ...extra,
      pages: normalizePageEntries<T>(parsed.pages),
      pageInfo: normalizePageInfo(parsed.pageInfo),
    }
  } catch {
    return null
  }
}

export function persistPaginationState<T>(
  key: string | null,
  state: PaginationState<T>,
  extra: Record<string, unknown> = {},
): void {
  if (!key) return
  try {
    const pages = Array.isArray(state.pages)
      ? state.pages.map(entry => ({
        page: entry.page,
        items: Array.isArray(entry.items) ? entry.items : [],
      }))
      : []
    sessionStorage.setItem(key, JSON.stringify({
      ...extra,
      pages,
      pageInfo: state.pageInfo ? { ...state.pageInfo } : null,
    }))
  } catch { }
}

export function clearPaginationState(key: string | null): void {
  if (!key) return
  try { sessionStorage.removeItem(key) } catch { }
}

export function captureAnchorSnapshot(container: HTMLElement | null): AnchorSnapshot | null {
  const node = container?.firstElementChild
  return node ? { node, top: node.getBoundingClientRect().top } : null
}

export function restoreAnchorSnapshot(snapshot: AnchorSnapshot | null): void {
  if (!snapshot?.node) return
  setTimeout(() => {
    const newTop = snapshot.node.getBoundingClientRect().top
    const diff = newTop - snapshot.top
    if (Number.isFinite(diff) && Math.abs(diff) > 1) window.scrollBy(0, diff)
  }, 0)
}

export function mergePageInfo<T>(
  previous: PageInfo | null,
  pageNumber: number | null,
  response: PaginatedResponse<T> = {},
): PageInfo {
  const next = { ...(previous ?? createEmptyPageInfo()) }
  const resolvedPage = Number.isFinite(pageNumber)
    ? Number(pageNumber)
    : (Number.isFinite(response.page) ? Number(response.page) : null)

  if (resolvedPage !== null) {
    next.minPage = next.minPage === null ? resolvedPage : Math.min(next.minPage, resolvedPage)
    next.maxPage = next.maxPage === null ? resolvedPage : Math.max(next.maxPage, resolvedPage)
  }

  if (Number.isFinite(response.totalPages)) next.totalPages = Number(response.totalPages)
  if (Number.isFinite(response.total)) next.total = Number(response.total)
  if (Number.isFinite(response.pageSize)) next.pageSize = Number(response.pageSize)

  if (typeof response.hasPrev === 'boolean' && resolvedPage !== null && next.minPage === resolvedPage) {
    next.hasPrev = response.hasPrev
  } else {
    next.hasPrev = next.minPage !== null && next.minPage > 1
  }

  if (typeof response.hasNext === 'boolean' && resolvedPage !== null && next.maxPage === resolvedPage) {
    next.hasNext = response.hasNext
  } else if (next.totalPages !== null && next.maxPage !== null) {
    next.hasNext = next.maxPage < next.totalPages
  } else if (typeof response.hasNext === 'boolean') {
    next.hasNext = response.hasNext
  }

  return next
}

export function mergePageEntry<T>(
  pages: PageEntry<T>[],
  entry: PageEntry<T>,
  reset = false,
): PageEntry<T>[] {
  if (reset) return [entry]
  return [...pages.filter(page => page.page !== entry.page), entry]
    .sort((a, b) => a.page - b.page)
}

export function flattenUniquePageItems<T, Key>(
  pages: PageEntry<T>[],
  getKey: (item: T) => Key,
): T[] {
  const seen = new Set<Key>()
  const items: T[] = []
  for (const page of pages) {
    for (const item of page.items || []) {
      if (!item) continue
      const key = getKey(item)
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  return items
}
