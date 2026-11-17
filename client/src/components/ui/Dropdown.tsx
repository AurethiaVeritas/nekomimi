import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

type DropdownOption = { value: string; label: string }

type DropdownProps = {
  value?: string
  options?: DropdownOption[]
  onChange?: (value: string) => void
  placeholder?: string
  compact?: boolean
}

/**
 * Dropdown – custom select replacement
 */
export default function Dropdown({ value, options = [], onChange, placeholder = 'Select…', compact = false }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('touchstart', onDoc, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('touchstart', onDoc)
    }
  }, [])

  const current = options.find(o => o.value === value)

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape') setOpen(false)
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setOpen((v) => !v)
    }
  }

  return (
    <div className={`dd ${compact ? 'dd--compact' : ''}`} ref={ref}>
      <button
        type="button"
        className="dd__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <span className={`dd__label ${current ? '' : 'dd__label--placeholder'}`}>{current ? current.label : placeholder}</span>
        <svg className="dd__chev" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M5.5 7.5l4.5 5 4.5-5z"/></svg>
      </button>
      {open && (
        <div className="dd__menu" role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`dd__item ${o.value === value ? 'is-active' : ''}`}
              onClick={() => { onChange?.(o.value); setOpen(false) }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
