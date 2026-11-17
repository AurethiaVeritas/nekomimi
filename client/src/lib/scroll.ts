import { useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

type AnchorPayload = {
  id: string | null
  scrollY?: number
  viewportTop?: number
  offsetTop?: number
}

const keyFor = (k: string) => `scroll:${k}`
const anchorKey = 'anchor:last'

const parseAnchorPayload = (raw: string | null): AnchorPayload | null => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      const id = typeof parsed.id === 'string' ? parsed.id : null
      return {
        id,
        scrollY: Number.isFinite(parsed.scrollY) ? parsed.scrollY : Number(parsed.scrollY),
        viewportTop: Number.isFinite(parsed.viewportTop) ? parsed.viewportTop : Number(parsed.viewportTop),
        offsetTop: Number.isFinite(parsed.offsetTop) ? parsed.offsetTop : Number(parsed.offsetTop),
      }
    }
  } catch { }
  return null
}

export function rememberLastAnchor(id: string) {
  if (!id) return
  try {
    const y = window.scrollY || window.pageYOffset || 0
    const payload: AnchorPayload = { id, scrollY: y }
    const el = document.getElementById(id)
    if (el) {
      const rect = el.getBoundingClientRect()
      payload.viewportTop = rect.top
      payload.offsetTop = y + rect.top
    }
    sessionStorage.setItem(anchorKey, JSON.stringify(payload))
  } catch {}
}

export function useScrollRestoration(key: string) {
  const navType = useNavigationType()
  const location = useLocation()

  // Attempt to restore on POP (back/forward). Prefer element anchor if present.
  useLayoutEffect(() => {
    if (navType !== 'POP') return
    let cancelled = false
    let frame = 0
    const tryRestore = (attempt = 0) => {
      if (cancelled) return
      try {
        const anchorPayload = parseAnchorPayload(sessionStorage.getItem(anchorKey))
        const anchorId = anchorPayload?.id
        if (anchorId) {
          const el = document.getElementById(anchorId)
          if (el) {
            let restored = false
            const scrollY = anchorPayload?.scrollY
            const offsetTop = anchorPayload?.offsetTop
            const targetScroll = typeof scrollY === 'number' && Number.isFinite(scrollY)
              ? scrollY
              : typeof offsetTop === 'number' && Number.isFinite(offsetTop)
              ? offsetTop
              : null
            if (typeof targetScroll === 'number') {
              window.scrollTo(0, targetScroll)
              restored = true
            }
            if (!restored) {
              el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            }
            const viewportTop = anchorPayload?.viewportTop
            if (typeof viewportTop === 'number' && Number.isFinite(viewportTop)) {
              frame = requestAnimationFrame(() => {
                if (cancelled || !el.isConnected) return
                const currentTop = el.getBoundingClientRect().top
                const diff = currentTop - viewportTop
                if (Math.abs(diff) > 1) window.scrollBy(0, diff)
              })
            }
            sessionStorage.removeItem(anchorKey)
            return
          }
          // Wait for content to render
          if (attempt < 20) {
            frame = requestAnimationFrame(() => tryRestore(attempt + 1))
            return
          }
          // Fallback to Y after retries
        }
        const y = Number(sessionStorage.getItem(keyFor(key)) || '0')
        if (Number.isFinite(y) && y > 0) window.scrollTo(0, y)
        if (anchorId) sessionStorage.removeItem(anchorKey)
      } catch {}
    }
    tryRestore(0)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [key, navType])

  // Save on unmount or when key changes
  useLayoutEffect(() => {
    return () => {
      try { sessionStorage.setItem(keyFor(key), String(window.scrollY || window.pageYOffset || 0)) } catch {}
    }
  }, [key, location.pathname, location.search])
}

export default useScrollRestoration
