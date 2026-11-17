import { useMemo, useRef } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import './TopTapHotspot.css'

export default function TopTapHotspot() {
  const enabled = useMemo(() => typeof window !== 'undefined' && 'ontouchstart' in window, [])
  const start = useRef({ x: 0, y: 0, t: 0 })
  const moved = useRef(false)

  if (!enabled) return null

  const onTouchStart = (e: ReactTouchEvent<HTMLButtonElement>) => {
    const t = e.touches?.[0]
    if (!t) return
    start.current = { x: t.clientX, y: t.clientY, t: Date.now() }
    moved.current = false
  }
  const onTouchMove = (e: ReactTouchEvent<HTMLButtonElement>) => {
    const t = e.touches?.[0]
    if (!t) return
    const dx = Math.abs(t.clientX - start.current.x)
    const dy = Math.abs(t.clientY - start.current.y)
    if (dx > 8 || dy > 8) moved.current = true
  }
  const onTouchEnd = () => {
    // Quick, minimal-move tap triggers smooth scroll to top
    if (moved.current) return
    const dt = Date.now() - start.current.t
    if (dt > 400) return
    try {
      const el = document.scrollingElement || document.documentElement
      if (!el) return
      if ((window.scrollY || el.scrollTop) <= 0) return
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {}
  }

  return (
    <button
      type="button"
      className="top-tap-hotspot"
      aria-label="Scroll to top"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    />
  )
}
