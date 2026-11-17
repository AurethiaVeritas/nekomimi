import { useCallback, useEffect, useRef, useState } from 'react';

type SliderProps = {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
  className?: string;
};

/**
 * Slider – custom range input
 * Props: value (number), min, max, step, onChange(number)
 */
export default function Slider({ value = 0, min = 0, max = 100, step = 1, onChange, className = '' }: SliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const pct = (() => {
    const v = Math.min(Math.max(value, min), max);
    const p = (v - min) / (max - min);
    return Number.isFinite(p) ? p : 0;
  })();

  const updateFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const p = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const raw = min + p * (max - min);
    const snapped = Math.round(raw / step) * step;
    onChange?.(snapped);
  }, [max, min, onChange, step]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => { if ('touches' in e) updateFromClientX(e.touches[0].clientX); else updateFromClientX(e.clientX) };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragging, updateFromClientX]);

  return (
    <div className={`sld ${dragging ? 'is-drag' : ''} ${className}`} ref={trackRef}
      onMouseDown={(e)=>{ setDragging(true); updateFromClientX(e.clientX) }}
      onTouchStart={(e)=>{ setDragging(true); if (e.touches?.[0]) updateFromClientX(e.touches[0].clientX) }}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={(e)=>{
        if (e.key === 'ArrowLeft') onChange?.(Math.max(min, value - step))
        if (e.key === 'ArrowRight') onChange?.(Math.min(max, value + step))
        if (e.key === 'Home') onChange?.(min)
        if (e.key === 'End') onChange?.(max)
      }}
    >
      <div className="sld__track">
        <div className="sld__fill" style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="sld__thumb" style={{ left: `${pct * 100}%` }} />
    </div>
  )
}
