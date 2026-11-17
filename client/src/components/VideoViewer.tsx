import './Viewer.css'

type VideoViewerProps = {
  src?: string | null;
  title?: string;
};

export default function VideoViewer({ src, title }: VideoViewerProps) {
  if (!src) return null
  return (
    <div className="media-frame">
      <video
        key={src}
        className="video-frame"
        src={src}
        title={title ? `${title} (video)` : 'Video playback'}
        controls
        preload="metadata"
      >
        Your browser does not support the video tag.
      </video>
    </div>
  )
}
