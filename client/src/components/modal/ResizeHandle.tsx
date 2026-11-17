import type { KeyboardEvent, PointerEvent } from 'react'
import { useI18n } from '../../lib/i18n'
import type { ResizeCorner } from './windowGeometry'

export const resizeCorners: ResizeCorner[] = ['se', 'sw', 'ne', 'nw']
const rotation = { se: 0, sw: 90, nw: 180, ne: 270 }
const label = {
  se: 'Resize from bottom right', sw: 'Resize from bottom left',
  ne: 'Resize from top right', nw: 'Resize from top left',
}

type ResizeHandleProps = {
  corner: ResizeCorner
  active: boolean
  onPointerDown: (event: PointerEvent<HTMLButtonElement>, corner: ResizeCorner) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, corner: ResizeCorner) => void
}

export default function ResizeHandle({ corner, active, onPointerDown, onKeyDown }: ResizeHandleProps) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      className={`modal-resizer modal-resizer--${corner}${active ? ' is-active' : ''}`}
      aria-label={t(label[corner])}
      title={`${t(label[corner])}. ${t('Drag or use arrow keys to resize')}`}
      onPointerDown={event => onPointerDown(event, corner)}
      onKeyDown={event => onKeyDown(event, corner)}
    >
      <svg className="modal-resizer__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" style={{ transform: `rotate(${rotation[corner]}deg)` }}>
        <path d="M6 18 18 6M11 18 18 11M16 18 18 16" />
      </svg>
    </button>
  )
}
