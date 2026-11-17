import type { ViewerState } from '../types'
import ImageViewer from './ImageViewer'
import Modal from './Modal'
import PdfViewer from './PdfViewer'
import TextViewer from './TextViewer'
import VideoViewer from './VideoViewer'

type MediaViewerProps = { viewer: ViewerState; onClose: () => void }

function ViewerContent({ viewer }: { viewer: ViewerState }) {
  switch (viewer.type) {
    case 'image': return <ImageViewer src={viewer.src || ''} alt={viewer.title || ''} />
    case 'text': return <TextViewer content={viewer.content || ''} />
    case 'pdf': return <PdfViewer src={viewer.src} title={viewer.title} />
    case 'video': return <VideoViewer src={viewer.src} title={viewer.title} />
    default: return null
  }
}

export default function MediaViewer({ viewer, onClose }: MediaViewerProps) {
  const maxWidth = viewer.type === 'image' ? 1152 : viewer.type === 'video' || viewer.type === 'pdf' ? 1024 : 896
  return (
    <Modal open={viewer.open} onClose={onClose} title={viewer.title || ''} maxWidth={maxWidth}>
      <div className="media-viewer-content">
        <ViewerContent key={`${viewer.type}:${viewer.src || viewer.title}`} viewer={viewer} />
      </div>
    </Modal>
  )
}
