import { useCallback, useRef, useState } from 'react'
import { getGridPageSize, getRemainingGridHeight } from './gridPagination'

const getRenderedColumnCount = (grid: HTMLDivElement): number => {
  const columns = window.getComputedStyle(grid).gridTemplateColumns.trim()
  return columns && columns !== 'none' ? columns.split(/\s+/).length : 1
}

export default function useGridPageSize(targetPageSize: number) {
  const [metrics, setMetrics] = useState({ pageSize: null as number | null, columns: 1, rowHeight: 520 })
  const observerRef = useRef<ResizeObserver | null>(null)

  const gridRef = useCallback((grid: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!grid) return

    const updatePageSize = () => {
      const columns = getRenderedColumnCount(grid)
      const style = window.getComputedStyle(grid)
      const width = Number.parseFloat(style.gridTemplateColumns) || grid.clientWidth
      const cardHeight = width + (window.innerWidth < 480 ? 200 : 260)
      // An explicit block size also invalidates skipped cards' cached geometry
      // after a responsive column change; aspect-ratio alone can retain it.
      grid.style.setProperty('--grid-work-card-height', `${cardHeight}px`)
      const rowHeight = cardHeight + (Number.parseFloat(style.rowGap) || 0)
      const pageSize = getGridPageSize(columns, targetPageSize)
      setMetrics(current => current.pageSize === pageSize && current.columns === columns && current.rowHeight === rowHeight
        ? current : { pageSize, columns, rowHeight })
    }

    updatePageSize()
    if (typeof ResizeObserver !== 'undefined') {
      observerRef.current = new ResizeObserver(updatePageSize)
      observerRef.current.observe(grid)
    }
  }, [targetPageSize])

  // Reserve the known remaining rows so a pending request never becomes the
  // document bottom. The sentinel occupies this space and stays observable even
  // when a fast scroll passes the last loaded row.
  const remainingHeight = (remaining: number, hasNext: boolean) => getRemainingGridHeight(
    remaining, hasNext, metrics.columns, metrics.rowHeight, metrics.pageSize || targetPageSize,
  )

  return { gridRef, pageSize: metrics.pageSize, remainingHeight }
}
