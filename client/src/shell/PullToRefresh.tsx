import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import './PullToRefresh.css'

type PullToRefreshProps = {
  onRefresh?: () => Promise<void> | void;
  threshold?: number;
};

export default function PullToRefresh({ onRefresh, threshold = 140 }: PullToRefreshProps) {
  const enabled = typeof window !== 'undefined' && 'ontouchstart' in window
  const startY = useRef(0)
  const pulling = useRef(false)
  const distanceRef = useRef(0)
  const refreshingRef = useRef(false)
  const onRefreshRef = useRef(onRefresh)
  const [dist, setDist] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    if (!enabled) return

    const onStart = (e: TouchEvent) => {
      // Ignore touches that start inside elements marked to disable PTR
      const el = e.target as Element | null
      if (el?.closest?.('[data-no-ptr]')) return
      if (window.scrollY > 0 || refreshingRef.current) return
      pulling.current = true
      startY.current = (e.touches?.[0]?.clientY) ?? 0
      distanceRef.current = 0
      setDist(0)
    }
    const onMove = (e: TouchEvent) => {
      if (!pulling.current) return
      const y = (e.touches?.[0]?.clientY) ?? 0
      const d = Math.max(0, y - startY.current)
      if (d > 0) e.preventDefault()
      const nextDistance = Math.min(d, threshold * 2)
      distanceRef.current = nextDistance
      setDist(nextDistance)
    }
    const onEnd = async () => {
      if (!pulling.current) return
      const should = distanceRef.current > threshold
      pulling.current = false
      distanceRef.current = 0
      setDist(0)
      if (should && !refreshingRef.current) {
        try {
          refreshingRef.current = true
          setRefreshing(true)
          await onRefreshRef.current?.()
        } finally {
          refreshingRef.current = false
          setRefreshing(false)
        }
      }
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
  }, [enabled, threshold])

  if (!enabled) return null
  const progress = Math.min(1, dist / threshold)
  const ready = dist > threshold

  const cls = ['ptr-indicator']
  if (refreshing) cls.push('refreshing')
  else if (ready) cls.push('ready')
  else if (progress > 0) cls.push('progress')

  // Inline styles to avoid janky CSS transitions during slow pulls
  const wrapperStyle: CSSProperties & { "--ptr-progress": number } = {
    transform: `translateY(${dist * 0.4}px)`,
    opacity: refreshing ? 1 : Math.max(0.03, progress),
    "--ptr-progress": progress,
  }

  const arrowStyle = refreshing
    ? { display: 'none' }
    : { transform: `rotate(${progress * 180}deg)`, opacity: progress, transition: 'none' }

  const spinnerStyle = refreshing
    ? { display: 'inline-block', opacity: 1 }
    : { display: 'none', opacity: 0 }

  return (
    <div aria-hidden className={cls.join(' ')} style={wrapperStyle}>
      <div className="ptr-inner">
        <svg className="ptr-arrow" viewBox="0 0 24 24" width="20" height="20" aria-hidden style={arrowStyle}>
          <path d="M12 5v14M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        <svg className="ptr-spinner" viewBox="0 0 24 24" width="20" height="20" aria-hidden style={spinnerStyle}>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="56.5" strokeDashoffset="42" />
        </svg>

        <div className="ptr-text">
          {refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      </div>
    </div>
  )
}
