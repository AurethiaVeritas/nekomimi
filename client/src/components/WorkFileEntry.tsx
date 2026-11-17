import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { FileItem } from '../types'
import { isVideo, isPdf } from '../lib/fileTypes'

function formatSize(bytes: number | undefined) {
  if (!Number.isFinite(bytes)) return ''
  const units = ['B','KB','MB','GB']
  let n = bytes as number; let u = 0
  while (n >= 1024 && u < units.length-1) { n /= 1024; u++ }
  return `${n.toFixed(1)} ${units[u]}`
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.max(0, Math.round(seconds))
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const mm = hrs > 0 ? String(mins).padStart(2, '0') : String(mins)
  const ss = String(secs).padStart(2, '0')
  if (hrs > 0) return `${hrs}:${mm}:${ss}`
  return `${mins}:${ss}`
}

function formatAudioLengthLabel(value: number | null | undefined) {
  if (value === undefined) return null
  if (value === null) return 'Unknown'
  if (!Number.isFinite(value) || value <= 0) return 'Unknown'
  return formatDuration(value)
}

interface TypeIconProps {
  type: 'dir' | 'audio' | 'image' | 'video' | 'pdf' | 'file';
}

function TypeIcon({ type }: TypeIconProps) {
  const common = 'file-icon'
  if (type === 'dir') return (
    <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  )
  if (type === 'audio') return (
    <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 17V7l10-2v10" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="15" r="2" />
    </svg>
  )
  if (type === 'image') return (
    <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 13l3-3 5 6" />
      <circle cx="8" cy="9" r="1.5" />
    </svg>
  )
  if (type === 'video') return (
    <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
    </svg>
  )
  if (type === 'pdf') return (
    <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M13 3v6h6" />
      <path d="M8 15h1.5a1 1 0 0 1 0 2H8v-2zM12 15h.75a1 1 0 0 1 0 2H12v-2zM16 17.5h-1v-2.5" />
    </svg>
  )
  return (
    <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M13 3v6h6" />
    </svg>
  )
}

function fileTypeInfo(it: FileItem) {
  const type: TypeIconProps['type'] = it.isDir
    ? 'dir'
    : it.isAudio
    ? 'audio'
    : it.isImage
    ? 'image'
    : isVideo(it)
    ? 'video'
    : isPdf(it)
    ? 'pdf'
    : 'file'
  const accent =
    type === 'dir'
      ? 'file-preview--accent-dir'
      : type === 'audio'
      ? 'file-preview--accent-audio'
      : type === 'image'
      ? 'file-preview--accent-image'
      : type === 'video'
      ? 'file-preview--accent-video'
      : type === 'pdf'
      ? 'file-preview--accent-pdf'
      : 'file-preview--accent-file'
  const ext = (!it.isDir && it.name.includes('.')) ? it.name.split('.').pop()?.toUpperCase() : ''
  return { type, accent, ext }
}

function fileDetailText(item: FileItem, duration: number | null | undefined): string {
  if (item.isDir) return 'Directory'
  const details = [formatSize(item.size)]
  if (item.isAudio) details.push(formatAudioLengthLabel(duration) || '')
  if (item.mime) details.push(item.mime)
  return details.filter(Boolean).join(' · ')
}

interface FileEntryProps {
  item: FileItem;
  view: 'grid' | 'list';
  url: string;
  duration?: number | null;
  isCurrentPlaying: boolean;
  onOpen: (item: FileItem) => void;
}

function PlayingPill() {
  return (
    <span className="file-playing-pill">
      <span className="file-playing-pill__dot" aria-hidden="true" />
      Playing
    </span>
  )
}

export default function WorkFileEntry({ item, view, url, duration, isCurrentPlaying, onOpen }: FileEntryProps) {
  const { type, accent, ext } = fileTypeInfo(item)
  const detailText = fileDetailText(item, duration)
  const isGrid = view === 'grid'
  const preview = (
    <div className={`file-preview ${isGrid ? 'file-preview--grid' : 'file-preview--small'} ${accent}${isCurrentPlaying ? ' file-preview--playing' : ''}`}>
      {item.isImage ? (
        <img alt={item.name} className="file-preview__image" src={url} />
      ) : (
        <TypeIcon type={type} />
      )}
    </div>
  )
  const status = (
    <>
      {isCurrentPlaying && <PlayingPill />}
      {!item.isDir && ext && <span className="file-badge">{ext}</span>}
    </>
  )
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen(item)
  }

  if (isGrid) {
    return (
      <div
        className={`card file-card${isCurrentPlaying ? ' file-card--playing' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => onOpen(item)}
        onKeyDown={handleKeyDown}
      >
        {preview}
        <div className="file-card__title" title={item.name}>{item.name}</div>
        <div className="file-card__meta">
          <span>{detailText}</span>
          <div className="file-card__meta-right">{status}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`card file-row${isCurrentPlaying ? ' file-row--playing' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={handleKeyDown}
    >
      {preview}
      <div className="file-row__info">
        <div className="file-row__title" title={item.name}>{item.name}</div>
        <div className="file-row__meta">{detailText}</div>
      </div>
      <div className="file-row__right">{status}</div>
    </div>
  )
}
