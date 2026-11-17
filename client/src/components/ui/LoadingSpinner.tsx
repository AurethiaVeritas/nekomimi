import type { CSSProperties } from 'react'
import './LoadingSpinner.css'

export type LoadingSpinnerProps = {
  size?: 'sm' | 'md' | 'lg'
  label?: string
  showLabel?: boolean
  className?: string
  style?: CSSProperties
  centered?: boolean
}

export default function LoadingSpinner({
  size = 'md',
  label,
  showLabel = true,
  className = '',
  style,
  centered = false,
}: LoadingSpinnerProps) {
  const containerClasses = [
    'loading-spinner-wrap',
    `loading-spinner-wrap--${size}`,
    centered ? 'loading-spinner-wrap--centered' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={containerClasses} style={style} role="status" aria-live="polite">
      <svg
        className="loading-spinner-svg"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <circle
          className="loading-spinner-track"
          cx="12"
          cy="12"
          r="9.5"
          strokeWidth="2.5"
        />
        <circle
          className="loading-spinner-head"
          cx="12"
          cy="12"
          r="9.5"
          strokeWidth="2.5"
          strokeDasharray="42 20"
          strokeLinecap="round"
        />
      </svg>
      {label ? (
        showLabel ? (
          <span className="loading-spinner-label">{label}</span>
        ) : (
          <span className="sr-only">{label}</span>
        )
      ) : null}
    </div>
  )
}
