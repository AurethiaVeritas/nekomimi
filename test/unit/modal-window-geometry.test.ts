import { beforeAll, describe, expect, it } from 'vitest'
import type * as Geometry from '../../client/src/components/modal/windowGeometry.js' with { 'resolution-mode': 'import' }

let constrainWindow: typeof Geometry.constrainWindow
let initialWindow: typeof Geometry.initialWindow
let moveWindow: typeof Geometry.moveWindow
let resizeWindow: typeof Geometry.resizeWindow
beforeAll(async () => {
  ({ constrainWindow, initialWindow, moveWindow, resizeWindow } = await import('../../client/src/components/modal/windowGeometry.js'))
})

const viewport = { w: 1200, h: 800 }
const rect = { x: 200, y: 100, w: 600, h: 400 }

describe('media viewer window geometry', () => {
  it.each<Geometry.ResizeCorner>(['se', 'sw', 'ne', 'nw'])('keeps the opposite corner fixed when resizing %s', corner => {
    const west = corner.endsWith('w')
    const north = corner.startsWith('n')
    const resized = resizeWindow(rect, corner, west ? -80 : 80, north ? -60 : 60, viewport, 1024)
    expect(resized.w).toBe(680)
    expect(resized.h).toBe(460)
    expect(west ? resized.x + resized.w : resized.x).toBe(west ? rect.x + rect.w : rect.x)
    expect(north ? resized.y + resized.h : resized.y).toBe(north ? rect.y + rect.h : rect.y)
  })

  it.each<Geometry.ResizeCorner>(['se', 'sw', 'ne', 'nw'])('stays in the viewport at maximum growth from %s', corner => {
    const resized = resizeWindow(rect, corner, corner.endsWith('w') ? -10000 : 10000, corner.startsWith('n') ? -10000 : 10000, viewport, 1024)
    expect(resized.x).toBeGreaterThanOrEqual(0)
    expect(resized.y).toBeGreaterThanOrEqual(0)
    expect(resized.x + resized.w).toBeLessThanOrEqual(viewport.w)
    expect(resized.y + resized.h).toBeLessThanOrEqual(viewport.h)
    expect(resized.w).toBeLessThanOrEqual(1024)
    expect(resized.h).toBeLessThanOrEqual(viewport.h * 0.9)
  })

  it('stops shrinking at the minimum size without shifting the opposite corner', () => {
    expect(resizeWindow(rect, 'nw', 10000, 10000, viewport, 1024)).toEqual({ x: 480, y: 260, w: 320, h: 240 })
  })

  it('clamps dragging to the viewport', () => {
    expect(moveWindow(rect, -10000, -10000, viewport)).toEqual({ ...rect, x: 0, y: 0 })
    expect(moveWindow(rect, 10000, 10000, viewport)).toEqual({ ...rect, x: 600, y: 400 })
  })

  it('keeps a window visible after the viewport becomes smaller', () => {
    const smaller = { w: 500, h: 300 }
    const constrained = constrainWindow({ x: 900, y: 600, w: 1000, h: 700 }, smaller, 896)
    expect(constrained).toEqual({ x: 25, y: 30, w: 475, h: 270 })
    expect(resizeWindow(constrained, 'se', -10000, -10000, smaller, 896)).toEqual({ x: 25, y: 30, w: 320, h: 240 })
  })

  it('fits even when a short viewport cannot accommodate the minimum dimensions', () => {
    const small = { w: 280, h: 180 }
    const initial = initialWindow(small, 896)
    const resized = resizeWindow(initial, 'nw', 1000, 1000, small, 896)
    expect(resized.w).toBeLessThanOrEqual(280)
    expect(resized.h).toBeLessThanOrEqual(180)
    expect(resized.x).toBeGreaterThanOrEqual(0)
    expect(resized.y).toBeGreaterThanOrEqual(0)
  })
})
