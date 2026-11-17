import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import CoverImage from '../components/CoverImage'
import FileButton from '../components/ui/FileButton'
import Segmented from '../components/ui/Segmented'
import { alignWork, deleteWork, getWork, updateWork, uploadWorkCover, invalidateWorksCache, importWork } from '../lib/api'
import { getErrorMessage } from '../lib/errors'
import { useObjectUrlPreview } from '../lib/useObjectUrlPreview'
import { useI18n } from '../lib/i18n'
import type { AgeRating, Work } from '../types'
import './EditWork.css'

export default function EditWork() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [work, setWork] = useState<Work | null>(null)

  const [title, setTitle] = useState('')
  const [circle, setCircle] = useState('')
  const [release, setRelease] = useState('')
  const [ageRating, setAgeRating] = useState<AgeRating>('sfw')
  const [series, setSeries] = useState('')
  const [tagsCsv, setTagsCsv] = useState('')
  const [vasCsv, setVasCsv] = useState('')
  const [baseDir, setBaseDir] = useState('')
  const [coverPath, setCoverPath] = useState('')
  const [coverUploading, setCoverUploading] = useState(false)
  const [newCoverFile, setNewCoverFile] = useState<File | null>(null)
  const { url: newCoverPreview, setFile: setPreviewFile, clear: clearPreview } = useObjectUrlPreview()
  const [rescanPending, setRescanPending] = useState(false)

  const populateForm = useCallback((nextWork: Work) => {
    setWork(nextWork)
    setTitle(nextWork.title || '')
    setCircle(nextWork.circle?.name || '')
    setRelease(nextWork.release || '')
    setAgeRating(nextWork.ageRating ?? (nextWork.nsfw ? 'r18' : 'sfw'))
    setSeries(nextWork.series?.name || '')
    setTagsCsv((nextWork.tags || []).map(tag => tag.name).join(', '))
    setVasCsv((nextWork.vas || []).map(va => va.name).join(', '))
    setBaseDir(nextWork.base_dir || '')
    setCoverPath(nextWork.cover_path || '')
  }, [])

  useEffect(() => {
    setLoading(true)
    setErr(''); setOk('')
    if (!id) return
    getWork(id)
      .then(populateForm)
      .catch(e => setErr(getErrorMessage(e)))
      .finally(() => setLoading(false))
  }, [id, populateForm])

  const onSave = async (e?: React.FormEvent) => {
    e?.preventDefault?.()
    if (!work || !id) return
    setErr(''); setOk('')
    try {
      const namesFromCsv = (csv: string) => Array.from(new Set(csv.split(',').map(s=>s.trim()).filter(Boolean)))
      const tagNames = namesFromCsv(tagsCsv)
      const vaNames = namesFromCsv(vasCsv)
      const existingTagsByName = new Map((work?.tags||[]).map(t => [t.name, t]))
      const tags = tagNames.map(name => existingTagsByName.get(name) || { name })
      const existingVasByName = new Map((work?.vas||[]).map(v => [v.name, v]))
      const vas = vaNames.map(name => existingVasByName.get(name) || { name })
      const patch = {
        title,
        circle: { name: circle },
        release,
        ageRating,
        series: series ? { name: series } : null,
        tags,
        vas,
        base_dir: baseDir || null,
        cover_path: coverPath || null,
      }
      const saved = await updateWork(id, patch)
      setWork(saved)
      setOk('Saved')
      try { invalidateWorksCache() } catch {}
    } catch (e) { setErr(getErrorMessage(e)) }
  }

  const onDelete = async () => {
    if (!work) return
    const sure = window.confirm(`Delete [RJ${work.rjcode}] ${work.title}? This removes it from the library but does not delete files on disk.`)
    if (!sure) return
    try {
      await deleteWork(work.id)
      try { invalidateWorksCache() } catch {}
      nav('/')
    } catch (e) { setErr(getErrorMessage(e)) }
  }

  const onRescan = async () => {
    if (!work || rescanPending) return
    const idDigits = String(work.rjcode || work.id || '').replace(/\D/g, '')
    if (!idDigits) {
      setErr('Cannot rescan: missing RJ id')
      return
    }
    const mediaPath = (baseDir || '').trim() || ''
    if (!mediaPath) {
      setErr('Set base directory before rescanning')
      return
    }
    const coverArg = (coverPath || '').trim()
    setErr(''); setOk('')
    try {
      setRescanPending(true)
      const payload: { id: string; mediaPath: string; coverPath?: string; forceCoverRefresh: boolean } = { id: idDigits, mediaPath, forceCoverRefresh: true }
      const currentCoverPath = (work.cover_path || '').trim()
      // Only send coverPath when user changed it manually; otherwise let backend refetch cover.
      if (coverArg && coverArg !== currentCoverPath) payload.coverPath = coverArg
      const updated = await importWork(payload)
      populateForm(updated)
      setNewCoverFile(null)
      clearPreview()
      setOk('Rescan complete')
      try { invalidateWorksCache() } catch {}
    } catch (e) {
      setErr(getErrorMessage(e))
    } finally {
      setRescanPending(false)
    }
  }

  const onAlignPath = async () => {
    if (!work || rescanPending) return
    const idDigits = String(work.rjcode || work.id || '').replace(/\D/g, '')
    if (!idDigits) {
      setErr('Cannot align: missing RJ id')
      return
    }
    setErr(''); setOk('')
    try {
      setRescanPending(true)
      const updated = await alignWork(work.id)
      populateForm(updated)
      if (updated.repairRequired) {
        setErr(updated.message || 'The storage directory must be repaired before this path can be aligned.')
      } else if (updated.aligned) {
        setOk(`Path updated: ${updated.base_dir}${updated.coverRestored ? ' (cover restored)' : ''}`)
      } else {
        setOk(`${updated.message || 'Path unchanged'}${updated.coverRestored ? ' Cover restored.' : ''}`)
      }
      try { invalidateWorksCache() } catch {}
    } catch (e) {
      setErr(getErrorMessage(e))
    } finally {
      setRescanPending(false)
    }
  }

  if (loading) return <div className="card">{t('Loading…')}</div>
  if (err && !work) return <div className="card"><div className="text-muted">{err}</div></div>
  if (!work) return <div className="card">{t('Not found')}</div>

  return (
    <div className="edit-page">
      <div className="edit-header card">
        <button
          type="button"
          className="edit-back-btn"
          onClick={() => { if (window.history.length > 1) nav(-1); else nav('/') }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 19l-7-7 7-7" />
          </svg>
          <span>{t('Back')}</span>
        </button>
        <h1 className="edit-title">{t('Edit Work')}</h1>
        <div className="edit-rj-badge">RJ{work.rjcode}</div>
      </div>

      <form className="card edit-form" onSubmit={onSave}>
        <div className="edit-sections">
          {/* Cover Section */}
          <div className="edit-section">
            <div className="edit-section__header">
              <h2 className="edit-section__title">{t('Cover Image')}</h2>
            </div>
            <div className="edit-section__content">
              <div className="edit-cover-preview">
                {newCoverPreview ? (
                  <div className="edit-cover-wrapper">
                    <img src={newCoverPreview} alt="preview" className="edit-cover-image" />
                    <button
                      type="button"
                      className="edit-cover-remove"
                      title={t('Remove image')}
                      onClick={()=>{
                        setNewCoverFile(null)
                        clearPreview()
                      }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                    <div className="edit-cover-note">{t('New cover (not uploaded yet)')}</div>
                  </div>
                ) : (
                  work.cover_path ? (
                    <div className="edit-cover-wrapper">
                      <CoverImage coverPath={work.cover_path} workId={work.id} alt="cover" className="edit-cover-image" />
                    </div>
                  ) : (
                    <div className="edit-cover-placeholder">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <path d="M8 13l3-3 5 6" />
                        <circle cx="8" cy="9" r="1.5" />
                      </svg>
                      <span>{t('No cover image')}</span>
                    </div>
                  )
                )}
              </div>
              
              <div className="edit-cover-actions">
                <div className="form-group">
                  <label className="form-label" htmlFor="edit-cover-path">{t('Cover Path (optional)')}</label>
                  <div className="form-inline">
                    <input id="edit-cover-path" className="input" placeholder={t('Absolute path to cover image')} value={coverPath} onChange={e=>setCoverPath(e.target.value)} />
                    <button
                      type="button"
                      className="btn"
                      onClick={async ()=>{
                        try {
                          setErr(''); setOk('')
                          if (!id) return
                          const saved = await updateWork(id, { cover_path: null })
                          setWork(saved); setCoverPath(''); setOk('Cover removed')
                          try { invalidateWorksCache() } catch {}
                        } catch (er) { setErr(getErrorMessage(er)) }
                      }}
                    >{t('Remove')}</button>
                  </div>
                </div>
                
                <div className="form-group">
                  <div className="form-label">{t('Upload New Cover')}</div>
                  <div className="form-inline">
                    <FileButton
                      accept="image/png,image/jpeg,image/webp"
                      onFile={(f)=>{
                        setNewCoverFile(f || null)
                        setPreviewFile(f)
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!newCoverFile || coverUploading}
                      onClick={async ()=>{
                        if (!newCoverFile || !id) return
                        try {
                          setCoverUploading(true); setErr(''); setOk('')
                          const saved = await uploadWorkCover(id, newCoverFile)
                          setWork(saved); setCoverPath(saved.cover_path || '')
                          setNewCoverFile(null); clearPreview()
                          setOk('Cover updated')
                          try { invalidateWorksCache() } catch {}
                        } catch (er) { setErr(getErrorMessage(er)) }
                        finally { setCoverUploading(false) }
                      }}
                    >
                      {coverUploading ? 'Uploading…' : 'Upload'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Metadata Section */}
          <div className="edit-section">
            <div className="edit-section__header">
              <h2 className="edit-section__title">{t('Metadata')}</h2>
            </div>
            <div className="edit-section__content">
              <div className="form-group">
                <label className="form-label" htmlFor="edit-title">{t('Title')}</label>
                <input id="edit-title" className="input" placeholder={t('Work title')} value={title} onChange={e=>setTitle(e.target.value)} />
              </div>

              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor="edit-circle">{t('Circle')}</label>
                  <input id="edit-circle" className="input" placeholder={t('Circle name')} value={circle} onChange={e=>setCircle(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="edit-release-date">{t('Release Date')}</label>
                  <input id="edit-release-date" className="input" placeholder="YYYY-MM-DD" value={release} onChange={e=>setRelease(e.target.value)} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="edit-series">{t('Series (optional)')}</label>
                <input id="edit-series" className="input" placeholder={t('Series name')} value={series} onChange={e=>setSeries(e.target.value)} />
              </div>

              <div className="form-group">
                <span className="form-label">{t('Age Rating')}</span>
                <Segmented value={ageRating} onChange={setAgeRating} options={[
                  { value: 'sfw', label: t('SFW') },
                  { value: 'r15', label: t('R-15') },
                  { value: 'r18', label: t('R-18') },
                ]} />
              </div>
            </div>
          </div>

          {/* Tags & VAs Section */}
          <div className="edit-section">
            <div className="edit-section__header">
              <h2 className="edit-section__title">{t('Tags & Voice Actors')}</h2>
            </div>
            <div className="edit-section__content">
              <div className="form-group">
                <label className="form-label" htmlFor="edit-tags">{t('Tags')}</label>
                <input id="edit-tags" className="input" placeholder={t('Comma separated tags')} value={tagsCsv} onChange={e=>setTagsCsv(e.target.value)} />
                <span className="form-hint">{t('Example: tag1, tag2, tag3')}</span>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="edit-voice-actors">{t('Voice Actors')}</label>
                <input id="edit-voice-actors" className="input" placeholder={t('Comma separated VA names')} value={vasCsv} onChange={e=>setVasCsv(e.target.value)} />
                <span className="form-hint">{t('Example: VA Name 1, VA Name 2')}</span>
              </div>
            </div>
          </div>

          {/* File Location Section */}
          <div className="edit-section">
            <div className="edit-section__header">
              <h2 className="edit-section__title">{t('File Location')}</h2>
            </div>
            <div className="edit-section__content">
              <div className="form-group">
                <label className="form-label" htmlFor="edit-base-directory">{t('Base Directory (optional)')}</label>
                <input id="edit-base-directory" className="input" placeholder={t('Absolute path to work directory')} value={baseDir} onChange={e=>setBaseDir(e.target.value)} />
                <span className="form-hint">{t('The folder containing audio files and media for this work')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="edit-actions">
          <div className="edit-actions__primary">
            <button className="btn btn-primary btn-lg" type="submit">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            {t('Save Changes')}
            </button>
            <button className="btn btn-lg" type="button" onClick={onRescan} disabled={rescanPending}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
              {rescanPending ? t('Rescanning…') : t('Rescan Metadata')}
            </button>
            <button className="btn btn-lg" type="button" onClick={onAlignPath} disabled={rescanPending} title={t('Find moved files, restore managed covers, and report filenames the mounted storage cannot open')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="7.5 4.21 12 6.81 16.5 4.21"></polyline>
                <polyline points="7.5 19.79 7.5 14.6 3 12"></polyline>
                <polyline points="21 12 16.5 14.6 16.5 19.79"></polyline>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
              {rescanPending ? 'Aligning…' : 'Align File Path'}
            </button>
          </div>
          <button className="btn btn-red btn-lg" type="button" onClick={onDelete}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Delete Work
          </button>
        </div>

        {/* Feedback Messages */}
        {(ok || err) && (
          <div className="edit-feedback">
            {ok && (
              <div className="edit-feedback__message edit-feedback__message--success">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                {ok}
              </div>
            )}
            {err && (
              <div className="edit-feedback__message edit-feedback__message--error">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                {err}
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  )
}
