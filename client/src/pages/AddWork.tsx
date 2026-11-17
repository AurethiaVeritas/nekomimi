import { useState, type FormEvent } from 'react'
import Dropdown from '../components/ui/Dropdown'
import FileButton from '../components/ui/FileButton'
import { importWork, invalidateWorksCache, uploadTempCover } from '../lib/api'
import { getErrorMessage } from '../lib/errors'
import { useObjectUrlPreview } from '../lib/useObjectUrlPreview'
import { useI18n } from '../lib/i18n'
import './AddWork.css'

export default function AddWork() {
  const { t } = useI18n()
  const [id, setId] = useState('')
  const [language, setLanguage] = useState('ja-jp')
  const [mediaPath, setMediaPath] = useState('')
  const [coverPath, setCoverPath] = useState('')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const { url: coverPreview, setFile: setPreviewFile, clear: clearPreview } = useObjectUrlPreview()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true); setError(''); setSuccess('')
    try {
      if (!id) throw new Error('RJ id is required')
      const normalizedId = (`${id}`).replace(/\D/g, '')
      if (!normalizedId) throw new Error('Invalid RJ id')
      let useCoverPath: string | undefined = coverPath || undefined
      if (!useCoverPath && coverFile) {
        const up = await uploadTempCover(coverFile)
        useCoverPath = up.path
      }
      const created = await importWork({ id: normalizedId, language, mediaPath: mediaPath || undefined, coverPath: useCoverPath })
      setId(''); setMediaPath(''); setCoverPath('')
      setCoverFile(null); clearPreview()
      setSuccess(`Imported [RJ${created.rjcode}] ${created.title || ''}`)
      try { invalidateWorksCache() } catch {}
    } catch (err) {
      setError(getErrorMessage(err))
    } finally { setBusy(false) }
  }

  return (
    <form className="card form-card" onSubmit={submit}>
      {coverPreview && (
        <div className="media-preview">
          <img src={coverPreview} alt={t('Preview')} className="media-preview__image" />
          <button
            type="button"
            className="media-preview__remove"
            title={t('Remove image')}
            onClick={()=>{
              setCoverFile(null)
              clearPreview()
            }}
          >
            ×
          </button>
          <div className="media-preview__note">{t('New cover (will be used on import)')}</div>
        </div>
      )}
      <div className="form-row form-row--split">
        <input className="input" placeholder={t('RJ id (RJ123456 or 123456)')} value={id} onChange={e=>setId(e.target.value)} />
        <Dropdown
          value={language}
          onChange={setLanguage}
          options={[
            { value: 'ja-jp', label: '日本語' },
            { value: 'zh-cn', label: '简体中文' },
            { value: 'zh-tw', label: '繁體中文' },
          ]}
        />
      </div>
      <div className="form-row form-row--split">
        <input className="input" placeholder={t('Media path on server (folder or file, optional)')} value={mediaPath} onChange={e=>setMediaPath(e.target.value)} />
        <button className="btn btn-primary" disabled={busy} type="submit">{busy ? t('Importing…') : t('Import DLsite')}</button>
      </div>
      <div className="form-row">
        <input className="input" placeholder={t('Cover image path on server (optional)')} value={coverPath} onChange={e=>setCoverPath(e.target.value)} />
        <div className="form-inline">
          <FileButton
            accept="image/png,image/jpeg,image/webp"
            onFile={(f: File | null)=>{
              setCoverFile(f)
              setPreviewFile(f)
            }}
          />
        </div>
      </div>
      {error && <div className="form-feedback form-feedback--error">{error}</div>}
      {success && <div className="form-feedback form-feedback--success">{success}</div>}
    </form>
  )
}
