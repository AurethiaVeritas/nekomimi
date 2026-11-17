import { useEffect, useState } from 'react'
import './Viewer.css'
import { useI18n } from '../lib/i18n'

type TextViewerProps = { content: string };

export default function TextViewer({ content }: TextViewerProps) {
  const { t } = useI18n()
  const [size, setSize] = useState(14)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '+') { e.preventDefault(); setSize(s => Math.min(48, s + 1)) }
      if (e.key === '-') { e.preventDefault(); setSize(s => Math.max(10, s - 1)) }
      if (e.key === '0') { e.preventDefault(); setSize(14) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="text-viewer">
      <div className="text-viewer__toolbar">
        <button type="button" className="btn btn-sm" onClick={()=>setSize(s=>Math.max(10, s-1))} title={t('Decrease font size (-)')}>
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        <button type="button" className="btn btn-sm" onClick={()=>setSize(s=>Math.min(48, s+1))} title={t('Increase font size (+)')}>
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        <button type="button" className="btn btn-sm" onClick={()=>setSize(14)} title={t('Reset font size (0)')}>{size}px</button>
      </div>
      <pre
        className="text-viewer-pre"
        style={{ fontSize: `${size}px`, lineHeight: 1.5 }}
      >
        {content}
      </pre>
    </div>
  )
}
