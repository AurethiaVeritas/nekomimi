export type ResizeCorner = 'se' | 'sw' | 'ne' | 'nw'
export type WindowRect = { x: number; y: number; w: number; h: number }
export type Viewport = { w: number; h: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function constrainWindow(rect: WindowRect, viewport: Viewport, maxWidth: number): WindowRect {
  const w = Math.min(rect.w, maxWidth, viewport.w * 0.95)
  const h = Math.min(rect.h, viewport.h * 0.9)
  return { w, h, x: clamp(rect.x, 0, viewport.w - w), y: clamp(rect.y, 0, viewport.h - h) }
}

export function initialWindow(viewport: Viewport, maxWidth: number): WindowRect {
  const rect = constrainWindow({ x: 0, y: 0, w: Math.max(320, Math.floor(viewport.w * 0.8)), h: Math.max(240, Math.floor(viewport.h * 0.8)) }, viewport, maxWidth)
  return { ...rect, x: Math.floor((viewport.w - rect.w) / 2), y: Math.floor((viewport.h - rect.h) / 2) }
}

export function moveWindow(rect: WindowRect, dx: number, dy: number, viewport: Viewport): WindowRect {
  return { ...rect, x: clamp(rect.x + dx, 0, viewport.w - rect.w), y: clamp(rect.y + dy, 0, viewport.h - rect.h) }
}

export function resizeWindow(rect: WindowRect, corner: ResizeCorner, dx: number, dy: number, viewport: Viewport, maxWidth: number): WindowRect {
  const west = corner.endsWith('w')
  const north = corner.startsWith('n')
  // Keep the opposite corner fixed, including when a viewport or size limit is reached.
  const availableW = west ? rect.x + rect.w : viewport.w - rect.x
  const availableH = north ? rect.y + rect.h : viewport.h - rect.y
  const maxW = Math.min(maxWidth, viewport.w * 0.95, availableW)
  const maxH = Math.min(viewport.h * 0.9, availableH)
  const w = clamp(rect.w + (west ? -dx : dx), Math.min(320, maxW), maxW)
  const h = clamp(rect.h + (north ? -dy : dy), Math.min(240, maxH), maxH)
  return { w, h, x: west ? rect.x + rect.w - w : rect.x, y: north ? rect.y + rect.h - h : rect.y }
}
