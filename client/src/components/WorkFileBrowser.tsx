import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { listFiles, getSettings } from '../lib/api'
import { withBasePath } from '../lib/basePath'
import { getErrorMessage } from '../lib/errors'
import { isTextLike, isVideo, isPdf } from '../lib/fileTypes'
import { useI18n } from '../lib/i18n'
import { usePlayer, type PlayerTrack } from '../player/PlayerContext'
import type { FileItem, FileListing, ViewerState } from '../types'
import WorkFileEntry from './WorkFileEntry'

interface FileBrowserProps {
  workId: number;
  openViewer?: (state: ViewerState) => void;
}

export default function WorkFileBrowser({ workId, openViewer }: FileBrowserProps) {
  const { t } = useI18n()
  const player = usePlayer()
  const currentTrack = player.queue[player.current]
  const [rel, setRel] = useState('')
  const [listing, setListing] = useState<FileListing | null>(null)
  const [err, setErr] = useState('')
  const [filesLoading, setFilesLoading] = useState(true)
  const [autoplayFolder, setAutoplayFolder] = useState(true)
  const [view, setView] = useState<'list' | 'grid'>(() => {
    try {
      const saved = localStorage.getItem('work.view')
      if (saved === 'list' || saved === 'grid') return saved
    } catch { }
    return 'list'
  })
  const durationsRef = useRef<Record<string, number | null>>({})
  const pendingRef = useRef<Map<string, { cleanup: () => void }>>(new Map())
  const [durations, setDurations] = useState<Record<string, number | null>>({})

  const load = useCallback(async (p: string) => {
    setErr('')
    setFilesLoading(true)
    try {
      const data = await listFiles(workId, p || '')
      setListing(data)
      setRel(data.path || '')
    } catch (e) {
      setErr(getErrorMessage(e))
    } finally {
      setFilesLoading(false)
    }
  }, [workId])

  const toUrl = useCallback((item: FileItem) => (
    withBasePath(`/files/${workId}/${encodeURIComponent(item.relPath).replace(/%2F/g, '/')}`)
  ), [workId])

  useEffect(() => {
    setListing(null)
    setRel('')
    void load('')
  }, [load])
  useEffect(() => {
    getSettings().then(s => {
      if (typeof s.autoplayFolder === 'boolean') setAutoplayFolder(s.autoplayFolder)
    }).catch(()=>{})
  }, [workId])
  useEffect(() => {
    try { localStorage.setItem('work.view', view) } catch { }
  }, [view])
  useEffect(() => {
    if (!listing) return
    listing.items.forEach(it => {
      if (!it.isAudio) return
      if (durationsRef.current[it.relPath] !== undefined) return
      if (pendingRef.current.has(it.relPath)) return
      const audio = document.createElement('audio')
      audio.preload = 'metadata'
      audio.crossOrigin = 'use-credentials'
      audio.src = toUrl(it)
      function cleanup() {
        audio.removeEventListener('loadedmetadata', onLoaded)
        audio.removeEventListener('error', onError)
        audio.src = ''
        pendingRef.current.delete(it.relPath)
      }
      function finalize(value: number | null) {
        durationsRef.current[it.relPath] = value
        setDurations(prev => {
          if (prev[it.relPath] === value) return prev
          return { ...prev, [it.relPath]: value }
        })
        cleanup()
      }
      function onLoaded() {
        const value = Number.isFinite(audio.duration) ? audio.duration : null
        finalize(value)
      }
      function onError() {
        finalize(null)
      }
      pendingRef.current.set(it.relPath, { cleanup })
      audio.addEventListener('loadedmetadata', onLoaded)
      audio.addEventListener('error', onError)
      try { audio.load?.() } catch {}
    })
  }, [listing, toUrl])
  useEffect(() => {
    return () => {
      pendingRef.current.forEach(({ cleanup }) => {
        cleanup?.()
      })
      pendingRef.current.clear()
    }
  }, [])

  const currentTrackPath = useMemo(() => normalizeTrackPath(currentTrack?.url), [currentTrack?.url])
  const isCurrentPlayingTrack = (item: FileItem) => {
    if (!player.playing || !item.isAudio) return false
    if (!currentTrackPath) return false
    return normalizeTrackPath(toUrl(item)) === currentTrackPath
  }

  const playItem = (item: FileItem) => {
    if (!listing) return
    const audios = listing.items.filter(x => !x.isDir && x.isAudio)
    const start = audios.findIndex(x => x.relPath === item.relPath)
    const startIndex = Math.max(0, start)
    const tracks: PlayerTrack[] = audios.map((x, idx) => ({
      url: toUrl(x),
      title: x.name,
      // Restore position only for the track the user explicitly clicked.
      restorePosition: idx === startIndex,
    }))
    player.playList(tracks, startIndex)
  }
  const getFolderTracks = (): PlayerTrack[] => (
    listing?.items
      .filter(item => !item.isDir && item.isAudio)
      .map(item => ({ url: toUrl(item), title: item.name }))
    || []
  )
  const playFolder = () => {
    const tracks = getFolderTracks()
    if (tracks.length) player.playList(tracks, 0)
  }
  const queueFolder = () => {
    player.addToQueue(getFolderTracks())
  }
  const aioItem = useMemo(() => {
    if (!listing) return null
    return listing.items.find(item => !item.isDir && item.isAudio && item.name?.toLowerCase().startsWith('aio.')) || null
  }, [listing])
  const playAio = () => {
    if (!aioItem) return
    player.playList([{ url: toUrl(aioItem), title: aioItem.name }], 0)
  }

  const openMedia = (item: FileItem, type: 'image' | 'video' | 'pdf') => {
    openViewer?.({ open: true, type, title: item.name, src: toUrl(item) })
  }
  const openText = async (item: FileItem) => {
    try {
      const r = await fetch(toUrl(item), { credentials: 'include' })
      if (!r.ok) throw new Error(`Unable to open file (${r.status})`)
      const content = await r.text()
      openViewer?.({ open: true, type: 'text', title: item.name, content })
    } catch (e) {
      setErr(getErrorMessage(e))
    }
  }
  const openItem = (item: FileItem) => {
    if (item.isDir) load(item.relPath)
    else if (item.isAudio) {
      if (autoplayFolder) playItem(item)
      else player.playList([{ url: toUrl(item), title: item.name }], 0)
    } else if (item.isImage) openMedia(item, 'image')
    else if (isVideo(item)) openMedia(item, 'video')
    else if (isPdf(item)) openMedia(item, 'pdf')
    else if (isTextLike(item)) void openText(item)
    else window.open(toUrl(item), '_blank', 'noreferrer')
  }

  if (!listing) {
    return (
      <div className="card" aria-busy={filesLoading}>
        <div className="work-files__header">
          <div className="work-files__title">{t('Files')}</div>
        </div>
        {filesLoading ? (
          <div className="work-files__loading">{t('Loading files…')}</div>
        ) : err ? (
          <div className="work-files__unavailable" role="alert">
            <div className="work-files__unavailable-title">{t('Files unavailable')}</div>
            <div className="work-files__unavailable-message">{err}</div>
            <div className="work-files__unavailable-actions">
              <button type="button" className="btn btn-primary" onClick={() => { void load(rel) }}>
                {t('Retry')}
              </button>
              <Link className="btn" to={`/edit/${workId}`}>{t('Edit file path')}</Link>
            </div>
          </div>
        ) : (
          <div className="work-files__unavailable-message">{t('File listing is unavailable.')}</div>
        )}
      </div>
    )
  }
  return (
    <div className="card" aria-busy={filesLoading}>
      <div className="work-files__header">
        <div className="work-files__title">{t('Files')}</div>
        <div className="work-files__actions">
          <div className="work-files__view-toggle">
            <button type="button" className={`btn btn-compact ${view==='grid'?'btn-primary':''}`} onClick={()=>setView('grid')} title={t('Grid view')}>▦</button>
            <button type="button" className={`btn btn-compact ${view==='list'?'btn-primary':''}`} onClick={()=>setView('list')} title={t('List view')}>≡</button>
          </div>
          {aioItem && (
            <button type="button" className="btn" onClick={playAio} title={`${t('Play')} ${aioItem.name}`}>{t('Play AIO')}</button>
          )}
          <button type="button" className="btn" onClick={playFolder}>{t('Play folder')}</button>
          <button type="button" className="btn" onClick={queueFolder}>{t('Queue folder')}</button>
        </div>
      </div>
      <Breadcrumb baseRel={rel} onNavigate={(p)=>load(p)} />
      {err && <div className="work-files__error">{err}</div>}
      <div className={view === 'grid' ? 'work-files__grid' : 'work-files__list'}>
        {listing.items.map(item => (
          <WorkFileEntry
            key={item.relPath}
            item={item}
            view={view}
            url={toUrl(item)}
            duration={durations[item.relPath]}
            isCurrentPlaying={isCurrentPlayingTrack(item)}
            onOpen={openItem}
          />
        ))}
      </div>
      {listing.items.length === 0 && <div className="work-files__empty">{t('Empty folder')}</div>}
    </div>
  )
}

interface BreadcrumbProps {
  baseRel: string;
  onNavigate: (path: string) => void;
}

function Breadcrumb({ baseRel, onNavigate }: BreadcrumbProps) {
  const parts = (baseRel || '').split('/').filter(Boolean)
  const crumbs: { name: string; rel: string }[] = [{ name: 'Root', rel: '' }]
  let acc = ''
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p
    crumbs.push({ name: p, rel: acc })
  }
  return (
    <div className="work-breadcrumbs">
      {crumbs.map((c, i) => (
        <span key={c.rel}>
          {i>0 && <span className="work-breadcrumbs__divider">/</span>}
          <button type="button" onClick={()=>onNavigate(c.rel)}>{c.name}</button>
        </span>
      ))}
    </div>
  )
}

function normalizeTrackPath(url: string | undefined | null) {
  if (!url) return ''
  try {
    const parsed = new URL(url, window.location.origin)
    return decodeURIComponent(parsed.pathname)
  } catch {
    const withoutHash = url.split('#')[0] ?? ''
    const withoutQuery = withoutHash.split('?')[0] ?? ''
    try {
      return decodeURIComponent(withoutQuery)
    } catch {
      return withoutQuery
    }
  }
}
