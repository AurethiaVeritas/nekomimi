import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import useMediaQuery from '../../lib/useMediaQuery'
import { constrainWindow, initialWindow, moveWindow, resizeWindow } from './windowGeometry'
import type { ResizeCorner, WindowRect } from './windowGeometry'

type Gesture = { pointerId: number; x: number; y: number; rect: WindowRect; corner: ResizeCorner | null }
const viewport = () => ({ w: window.innerWidth, h: window.innerHeight })

export default function useModalWindow(open: boolean, maxWidth: number, fitContent: boolean) {
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [rect, setRect] = useState<WindowRect>({ x: 0, y: 0, w: 0, h: 0 })
  const gesture = useRef<Gesture | null>(null)
  const [active, setActive] = useState<'move' | ResizeCorner | null>(null)

  useEffect(() => {
    if (!open) return
    setRect(initialWindow(viewport(), maxWidth))
    const onResize = () => {
      gesture.current = null
      setActive(null)
      setRect(previous => constrainWindow(previous, viewport(), maxWidth))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, maxWidth])

  useEffect(() => {
    if (!open || isMobile || fitContent) {
      gesture.current = null
      setActive(null)
      return
    }
    const stop = () => { gesture.current = null; setActive(null) }
    const onMove = (event: PointerEvent) => {
      const start = gesture.current
      if (!start || event.pointerId !== start.pointerId) return
      event.preventDefault()
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      setRect(start.corner
        ? resizeWindow(start.rect, start.corner, dx, dy, viewport(), maxWidth)
        : moveWindow(start.rect, dx, dy, viewport()))
    }
    const onEnd = (event: PointerEvent) => {
      if (event.pointerId === gesture.current?.pointerId) stop()
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    window.addEventListener('blur', stop)
    return () => {
      stop()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      window.removeEventListener('blur', stop)
    }
  }, [open, isMobile, fitContent, maxWidth])

  const beginGesture = (event: ReactPointerEvent<HTMLElement>, corner: ResizeCorner | null = null) => {
    if (!open || isMobile || fitContent || event.button !== 0 || gesture.current) return
    if (!corner && (event.target as Element).closest('button, a, input, select, textarea')) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect, corner }
    setActive(corner ?? 'move')
  }

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, corner: ResizeCorner) => {
    if (!open || isMobile || fitContent) return
    const step = event.shiftKey ? 40 : 10
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    }
    const change = delta[event.key]
    if (!change) return
    event.preventDefault()
    event.stopPropagation()
    setRect(previous => resizeWindow(previous, corner, ...change, viewport(), maxWidth))
  }

  return { rect, isMobile, active, beginGesture, resizeWithKeyboard }
}
