import { useEffect, useRef, type RefObject } from 'react'

type InfiniteScrollOptions = {
  onEndReached?: () => void
  onStartReached?: () => void
  rootMarginRatio?: number
}

const useSentinelObserver = (
  sentinelRef: RefObject<HTMLDivElement | null>,
  onReached: (() => void) | undefined,
  rootMarginRatio: number,
) => {
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !onReached || typeof IntersectionObserver === 'undefined') return

    const marginPx = Math.round(window.innerHeight * rootMarginRatio)
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) onReached()
      },
      { rootMargin: `${marginPx}px` },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onReached, rootMarginRatio, sentinelRef])
}

export default function useInfiniteScrollSentinels({
  onEndReached,
  onStartReached,
  rootMarginRatio = 1.5,
}: InfiniteScrollOptions) {
  const topSentinelRef = useRef<HTMLDivElement | null>(null)
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null)

  useSentinelObserver(topSentinelRef, onStartReached, rootMarginRatio)
  useSentinelObserver(bottomSentinelRef, onEndReached, rootMarginRatio)

  return { bottomSentinelRef, topSentinelRef }
}
