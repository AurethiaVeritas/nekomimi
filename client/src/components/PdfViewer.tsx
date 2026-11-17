import { useEffect, useState } from 'react'
import './Viewer.css'

type PdfViewerProps = {
  src?: string | null;
  title?: string;
};

export default function PdfViewer({ src, title }: PdfViewerProps) {
  const [cacheBuster, setCacheBuster] = useState(Date.now())

  // Force reload whenever src changes or component mounts
  useEffect(() => {
    setCacheBuster(Date.now())
  }, [src])

  if (!src) return null

  // Add cache buster to URL to force fresh load
  const srcWithCache = src.includes('?') 
    ? `${src}&_t=${cacheBuster}` 
    : `${src}?_t=${cacheBuster}`

  return (
    <div className="doc-viewer">
      <object
        key={cacheBuster}
        data={srcWithCache}
        type="application/pdf"
        className="pdf-frame"
        aria-label={title ? `${title} (PDF)` : 'PDF document'}
      >
        <embed
          key={`embed-${cacheBuster}`}
          src={srcWithCache}
          type="application/pdf"
          className="pdf-frame"
        />
        <p style={{ padding: '1rem', textAlign: 'center' }}>
          Unable to display PDF. 
          <a href={src} target="_blank" rel="noopener noreferrer" style={{ marginLeft: '0.5rem', color: 'var(--primary)' }}>
            Download instead
          </a>
        </p>
      </object>
    </div>
  )
}
