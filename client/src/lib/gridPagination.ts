const DEFAULT_MAX_PAGE_SIZE = 200

export function getGridPageSize(
  columnCount: number,
  targetPageSize: number,
  maxPageSize = DEFAULT_MAX_PAGE_SIZE,
): number {
  const columns = Math.max(1, Math.floor(columnCount) || 1)
  const target = Math.max(columns, Math.floor(targetPageSize) || columns)
  const maximum = Math.max(1, Math.floor(maxPageSize) || DEFAULT_MAX_PAGE_SIZE)
  const roundedUp = Math.ceil(target / columns) * columns

  if (roundedUp <= maximum) return roundedUp
  if (columns > maximum) return maximum
  return Math.floor(maximum / columns) * columns
}

// Missing totals still reserve one page, but a known partial final page reserves
// only its actual rows. Once the API confirms the end, remove the loading space.
export function getRemainingGridHeight(remaining: number, hasNext: boolean, columns: number, rowHeight: number, pageSize: number): number {
  if (!hasNext) return 1
  const count = remaining > 0 ? remaining : pageSize
  return Math.ceil(count / Math.max(1, columns)) * rowHeight
}
