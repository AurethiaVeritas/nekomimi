import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import './Viewer.css'
import { useI18n } from '../lib/i18n'

type Point = { x: number; y: number };

type ImageViewerProps = {
  src: string;
  alt?: string;
};

export default function ImageViewer({ src, alt }: ImageViewerProps) {
  const { t } = useI18n()
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const lastPos = useRef<Point>({ x: 0, y: 0 });
  const initedRef = useRef(false);
  const scaleRef = useRef(1);
  // Track active pointers for touch pinch-zoom
  const pointersRef = useRef<Map<number, Point>>(new Map());
  const pinchRef = useRef<{ active: boolean; lastDist: number }>({ active: false, lastDist: 0 });

  const clampOffset = useCallback((sc: number, off: Point): Point => {
    const wrap = wrapRef.current;
    if (!wrap) return off;
    const rect = wrap.getBoundingClientRect();
    const sw = natural.w * sc;
    const sh = natural.h * sc;
    let x = off.x;
    let y = off.y;
    // If smaller than viewport, center
    if (sw <= rect.width) x = (rect.width - sw) / 2;
    else {
      const minX = rect.width - sw;
      const maxX = 0;
      if (x < minX) x = minX;
      if (x > maxX) x = maxX;
    }
    if (sh <= rect.height) y = (rect.height - sh) / 2;
    else {
      const minY = rect.height - sh;
      const maxY = 0;
      if (y < minY) y = minY;
      if (y > maxY) y = maxY;
    }
    return { x, y };
  }, [natural]);

  const computeFit = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !natural.w || !natural.h) return;
    const rect = wrap.getBoundingClientRect();
    const s = Math.min(rect.width / natural.w, rect.height / natural.h);
    const nextFit = Number.isFinite(s) && s > 0 ? s : 1;
    setFitScale(nextFit);
    if (!initedRef.current) {
      initedRef.current = true;
      // First-time fit and center
      setScale(nextFit);
      const x = (rect.width - natural.w * nextFit) / 2;
      const y = (rect.height - natural.h * nextFit) / 2;
      setOffset({ x, y });
    } else {
      // Subsequent layout changes: keep current zoom, clamp offset to bounds
      setOffset(prev => clampOffset(scaleRef.current, prev));
    }
  }, [natural, clampOffset]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    const onLoad = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.addEventListener('load', onLoad);
    return () => img.removeEventListener('load', onLoad);
  }, [src]);

  // Keep an up-to-date scale ref for computeFit
  useEffect(() => { scaleRef.current = scale }, [scale]);
  // Re-run fit when image source or its natural size changes
  useEffect(() => { initedRef.current = false; computeFit() }, [src, natural.w, natural.h, computeFit]);
  useEffect(() => {
    const onResize = () => computeFit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [computeFit]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => computeFit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [computeFit]);

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setScale(prev => {
      const newScale = Math.min(8, Math.max((fitScale || 0.05) * 0.5, prev * factor));
      setOffset(prevOff => {
        const pX = (cx - prevOff.x) / prev;
        const pY = (cy - prevOff.y) / prev;
        const next = { x: cx - pX * newScale, y: cy - pY * newScale };
        return clampOffset(newScale, next);
      });
      return newScale;
    });
  }, [clampOffset, fitScale]);

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1/1.1;
    zoomAt(cx, cy, factor);
  };

  const updatePointer = (e: PointerEvent | ReactPointerEvent<HTMLDivElement>, type: 'down' | 'move' | 'up' | 'cancel' | 'leave') => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (type === 'down') {
      try { wrap.setPointerCapture?.(e.pointerId) } catch {}
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size === 1) {
        setDragging(true);
        lastPos.current = { x: e.clientX, y: e.clientY };
      } else if (pointersRef.current.size === 2) {
        const pts = Array.from(pointersRef.current.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        pinchRef.current = { active: true, lastDist: Math.hypot(dx, dy) };
        setDragging(false);
      }
    } else if (type === 'move') {
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (pinchRef.current.active && pointersRef.current.size >= 2) {
        const rect = wrap.getBoundingClientRect();
        const pts = Array.from(pointersRef.current.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const dist = Math.hypot(dx, dy);
        const cx = (pts[0].x + pts[1].x) / 2 - rect.left;
        const cy = (pts[0].y + pts[1].y) / 2 - rect.top;
        const last = pinchRef.current.lastDist || dist;
        if (last > 0) {
          const factor = Math.max(0.5, Math.min(2, dist / last));
          zoomAt(cx, cy, factor);
        }
        pinchRef.current.lastDist = dist;
        return;
      }
      if (dragging) {
        const dx = e.clientX - lastPos.current.x;
        const dy = e.clientY - lastPos.current.y;
        lastPos.current = { x: e.clientX, y: e.clientY };
        setOffset(prev => clampOffset(scale, { x: prev.x + dx, y: prev.y + dy }));
      }
    } else {
      // up / cancel / leave
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current.active = false;
      if (pointersRef.current.size === 0) setDragging(false);
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => updatePointer(e, 'down');
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => updatePointer(e, 'move');
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => updatePointer(e, 'up');
  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => updatePointer(e, 'cancel');
  const onPointerLeave = (e: ReactPointerEvent<HTMLDivElement>) => updatePointer(e, 'leave');

  const zoomIn = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(rect.width/2, rect.height/2, 1.1);
  }, [zoomAt]);
  const zoomOut = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(rect.width/2, rect.height/2, 1/1.1);
  }, [zoomAt]);
  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !natural.w || !natural.h) return;
    const rect = wrap.getBoundingClientRect();
    const s = Math.min(rect.width / natural.w, rect.height / natural.h);
    const nextFit = Number.isFinite(s) && s > 0 ? s : 1;
    setFitScale(nextFit);
    setScale(nextFit);
    const x = (rect.width - natural.w * nextFit) / 2;
    const y = (rect.height - natural.h * nextFit) / 2;
    setOffset({ x, y });
  }, [natural]);
  const actual = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setScale(1);
    setOffset(clampOffset(1, { x: (rect.width - natural.w)/2, y: (rect.height - natural.h)/2 }));
  }, [clampOffset, natural]);

  const onDblClick = () => {
    if (Math.abs(scale - 1) < 0.01) fit()
    else actual()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '+') { e.preventDefault(); zoomIn(); }
      if (e.key === '-') { e.preventDefault(); zoomOut(); }
      if (e.key.toLowerCase() === 'f') { e.preventDefault(); fit(); }
      if (e.key === '0') { e.preventDefault(); actual(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actual, fit, zoomIn, zoomOut]);

  const percent = Math.round(scale * 100)

  return (
    <div
      ref={wrapRef}
      className="viewer-frame"
      role="application"
      aria-label={alt ? `Interactive image viewer: ${alt}` : 'Interactive image viewer'}
      style={{ touchAction: 'none' }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      onDoubleClick={onDblClick}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        className="no-select"
        style={{
          maxWidth: 'none',
          maxHeight: 'none',
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: '0 0',
          willChange: 'transform'
        }}
      />

      <div
        className="viewer-toolbar"
        role="toolbar"
        aria-label={t('Image zoom controls')}
        onDoubleClickCapture={(e)=> e.stopPropagation()}
        onPointerDown={(e)=> e.stopPropagation()}
      >
        <button type="button" className="btn btn-sm" onClick={zoomOut} title={t('Zoom out (-)')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        <button type="button" className="btn btn-sm" onClick={zoomIn} title={t('Zoom in (+)')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        <button type="button" className="btn btn-sm" onClick={fit} title={t('Fit to screen (F)')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9"></polyline>
            <polyline points="9 21 3 21 3 15"></polyline>
            <line x1="21" y1="3" x2="14" y2="10"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>
        </button>
        <button type="button" className="btn btn-sm" onClick={actual} title={t('Actual size (0)')}>{percent}%</button>
      </div>
    </div>
  )
}
