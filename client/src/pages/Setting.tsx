import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSettings, getActiveScan, getLogs, setSettings, checkProxyConnection, invalidateWorksCache } from '../lib/api'
import { changePassword, logout } from '../lib/auth'
import { withBasePath } from '../lib/basePath'
import { getErrorMessage } from '../lib/errors'
import Toggle from '../components/ui/Toggle'
import Segmented from '../components/ui/Segmented'
import { LogDetails } from '../components/LogDetails'
import { applyTheme, getSavedThemePref } from '../theme'
import { useI18n } from '../lib/i18n'
import type { LogEntry, LogLevel, ProxyCheckResult, Settings as SettingsType } from '../types'
import './Setting.css'

interface ScopeBadgeProps {
  children: React.ReactNode;
}

const ScopeBadge = ({ children }: ScopeBadgeProps) => (
  <span className="settings-scope-badge">{children}</span>
)

type AutoScanMode = 'interval' | 'daily';
type ThemePref = 'system' | 'light' | 'dark';
type ScanStatusMode = 'new-only' | 'full' | 'metadata-only' | 'alignment';

const LOG_SCOPE_PREFIX = /^\[([^\]]+)]\s*(.*)$/

const splitLogMessage = (message: string) => {
  const match = LOG_SCOPE_PREFIX.exec(message)
  return match ? { scope: match[1], message: match[2] } : { scope: null, message }
}

const isValidTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

const detectBrowserTimeZone = () => {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (detected && isValidTimeZone(detected)) return detected
  } catch { }
  return 'UTC'
}

const defaultTimeZone = detectBrowserTimeZone()
const timeZoneOptions = (() => {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
  const supported = intl.supportedValuesOf?.('timeZone') || []
  return supported.includes(defaultTimeZone) ? supported : [defaultTimeZone, ...supported]
})()

const resolveScanMode = (value: unknown, fallback: ScanStatusMode): ScanStatusMode => {
  if (value === 'new-only' || value === 'full' || value === 'metadata-only' || value === 'alignment') {
    return value;
  }
  return fallback;
}

const getScanStartMessage = (mode: ScanStatusMode, total: number | undefined, locale: 'en' | 'ja') => {
  if (locale === 'ja') {
    if (typeof total === 'number') {
      if (mode === 'alignment') return `${total}件を処理中…`
      if (mode === 'metadata-only') return `${total}件のメタデータを再取得中…`
      return `${total}件をスキャン中…`
    }
    if (mode === 'alignment') return 'パス整合スキャンを開始しました'
    if (mode === 'metadata-only') return 'メタデータの再取得を開始しました'
    return 'スキャンを開始しました'
  }
  if (typeof total === 'number') {
    if (mode === 'alignment') return `Processing ${total} item${total === 1 ? '' : 's'}…`
    if (mode === 'metadata-only') return `Rescraping metadata for ${total} item${total === 1 ? '' : 's'}…`
    return `Scanning ${total} item${total === 1 ? '' : 's'}…`
  }
  if (mode === 'alignment') return 'Alignment scan started'
  if (mode === 'metadata-only') return 'Metadata rescrape started'
  return 'Scan started'
}

const getScanProgressMessage = (mode: ScanStatusMode, data: Record<string, unknown>, imported: number, locale: 'en' | 'ja') => {
  if (locale === 'ja') {
    if (typeof data.retryTotal === 'number' && typeof data.retryIndex === 'number') {
      return `再試行 ${data.retried || ''}：${data.retryIndex}/${data.retryTotal}`
    }
    if (typeof data.index === 'number' && typeof data.total === 'number') {
      if (mode === 'alignment') return `処理中 ${data.index}/${data.total}`
      if (mode === 'metadata-only') return `メタデータを更新中 ${data.index}/${data.total}`
      return `インポート済み ${data.index}/${data.total}`
    }
    if (mode === 'alignment') return '処理中…'
    if (mode === 'metadata-only') return `メタデータを更新済み ${imported}`
    return `インポート済み ${imported}`
  }
  if (typeof data.retryTotal === 'number' && typeof data.retryIndex === 'number') {
    return `Retry ${data.retried || ''}: ${data.retryIndex}/${data.retryTotal}`
  }
  if (typeof data.index === 'number' && typeof data.total === 'number') {
    if (mode === 'alignment') return `Processing ${data.index}/${data.total}`
    if (mode === 'metadata-only') return `Updated metadata ${data.index}/${data.total}`
    return `Imported ${data.index}/${data.total}`
  }
  if (mode === 'alignment') return 'Processing...'
  if (mode === 'metadata-only') return `Updated metadata ${imported}`
  return `Imported ${imported}`
}

const getScanDoneMessage = (mode: ScanStatusMode, locale: 'en' | 'ja') => {
  if (locale === 'ja') {
    if (mode === 'alignment') return 'パス整合スキャンが完了しました — 詳細はサーバーログを確認してください'
    if (mode === 'metadata-only') return 'メタデータの再取得が完了しました — 詳細はサーバーログを確認してください'
    return 'スキャンが完了しました — 詳細はサーバーログを確認してください'
  }
  if (mode === 'alignment') return 'Alignment scan finished — check server logs for summary'
  if (mode === 'metadata-only') return 'Metadata rescrape finished — check server logs for summary'
  return 'Scan finished — check server logs for summary'
}

export default function Settings() {
  const { t, locale, setLocale } = useI18n()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('') // generic errors (e.g., scan stream)
  const [scanMsg, setScanMsg] = useState('') // scan progress/status text
  const [saveOk, setSaveOk] = useState('')
  const [saveErr, setSaveErr] = useState('')
  const [autoplayFolder, setAutoplayFolder] = useState(true)
  const [scanPathsText, setScanPathsText] = useState('')
  const [theme, setTheme] = useState<ThemePref>(() => getSavedThemePref() as ThemePref)
  const [httpProxyEnabled, setHttpProxyEnabled] = useState(true)
  const [httpProxyHost, setHttpProxyHost] = useState('')
  const [httpProxyPort, setHttpProxyPort] = useState('')
  const [httpProxyUsername, setHttpProxyUsername] = useState('')
  const [httpProxyPassword, setHttpProxyPassword] = useState('')
  const [proxyCheck, setProxyCheck] = useState<ProxyCheckResult | null>(null)
  const [proxyCheckPending, setProxyCheckPending] = useState(false)
  const [proxyCheckErr, setProxyCheckErr] = useState('')
  const [autoScanEnabled, setAutoScanEnabled] = useState(false)
  const [autoScanMode, setAutoScanMode] = useState<AutoScanMode>('interval')
  const [autoScanIntervalMinutes, setAutoScanIntervalMinutes] = useState('60')
  const [autoScanDailyTime, setAutoScanDailyTime] = useState('02:00')
  const [timeZone, setTimeZone] = useState(defaultTimeZone)
  const logTimeFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, {
    timeZone: isValidTimeZone(timeZone) ? timeZone : defaultTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }), [timeZone])
  const [scanning, setScanning] = useState(false)
  const [lastScanAt, setLastScanAt] = useState('')
  const esRef = useRef<EventSource | null>(null)
  const attachToScanRef = useRef<(jobId: string) => void>(() => undefined)
  const [pwErr, setPwErr] = useState('')
  const [pwOk, setPwOk] = useState('')
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwNew2, setPwNew2] = useState('')
  const [logoutPending, setLogoutPending] = useState(false)
  const [logoutErr, setLogoutErr] = useState('')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [enabledLogLevels, setEnabledLogLevels] = useState<Record<LogLevel, boolean>>({ info: true, warn: true, error: true })
  const logsEndRef = useRef<HTMLDivElement | null>(null)
  const terminalBodyRef = useRef<HTMLDivElement | null>(null)
  const logStreamRef = useRef<EventSource | null>(null)

  useEffect(() => {
    let mounted = true
    getSettings().then(s => {
      if (typeof s.autoplayFolder === 'boolean') setAutoplayFolder(s.autoplayFolder)
      if (Array.isArray(s.defaultScanPaths)) setScanPathsText(s.defaultScanPaths.join('\n'))
      if (typeof s.lastScanAt === 'string') setLastScanAt(s.lastScanAt)
      if (typeof s.httpProxyEnabled === 'boolean') setHttpProxyEnabled(s.httpProxyEnabled)
      if (typeof s.httpProxyHost === 'string') setHttpProxyHost(s.httpProxyHost)
      if (typeof s.httpProxyPort === 'number') setHttpProxyPort(String(s.httpProxyPort || ''))
      if (typeof s.httpProxyUsername === 'string') setHttpProxyUsername(s.httpProxyUsername)
      if (typeof s.httpProxyPassword === 'string') setHttpProxyPassword(s.httpProxyPassword)
      if (typeof s.autoScanEnabled === 'boolean') setAutoScanEnabled(s.autoScanEnabled)
      if (s.autoScanMode === 'interval' || s.autoScanMode === 'daily') setAutoScanMode(s.autoScanMode)
      if (s.autoScanIntervalMinutes !== undefined) setAutoScanIntervalMinutes(String(s.autoScanIntervalMinutes || ''))
      if (typeof s.autoScanDailyTime === 'string') setAutoScanDailyTime(s.autoScanDailyTime)
      if (typeof s.timeZone === 'string' && isValidTimeZone(s.timeZone)) setTimeZone(s.timeZone)
      if (Array.isArray(s.serverLogLevels)) {
        setEnabledLogLevels({
          info: s.serverLogLevels.includes('info'),
          warn: s.serverLogLevels.includes('warn'),
          error: s.serverLogLevels.includes('error'),
        })
      }
    }).catch(e => setErr(getErrorMessage(e))).finally(async () => {
      if (!mounted) return
      setLoading(false)
      // Auto-attach to an active scan if present
      try {
        const { jobId } = await getActiveScan()
        if (jobId) attachToScanRef.current(jobId)
      } catch (_) { }
    })
    return () => {
      mounted = false
      try { esRef.current?.close?.() } catch { }
      esRef.current = null
      try { logStreamRef.current?.close?.() } catch { }
      logStreamRef.current = null
    }
  }, [])

  const handleScanConnectionError = async () => {
    try { esRef.current?.close() } catch { }
    esRef.current = null

    // Attempt to reconnect if scan is still running
    try {
      const { jobId, status } = await getActiveScan() as { jobId: string; status: string }
      if (jobId && status === 'running') {
        // Re-attach
        attachToScan(jobId)
        return
      }
    } catch { }

    setErr('Connection lost; scan continues on server')
    setScanning(true)
  }

  const bindScanStream = (es: EventSource, fallbackMode: ScanStatusMode) => {
    let currentMode = fallbackMode
    const accum = { imported: 0, errors: 0, updated: 0, markedMissing: 0 }
    es.addEventListener('start', (ev) => {
      try {
        const d = JSON.parse(ev.data)
        currentMode = resolveScanMode(d.mode, currentMode)
        setScanMsg(getScanStartMessage(currentMode, typeof d.total === 'number' ? d.total : undefined, locale))
        return
      } catch { }
      setScanMsg(getScanStartMessage(currentMode, undefined, locale))
    })
    es.addEventListener('progress', (ev) => {
      try {
        const d = JSON.parse(ev.data)
        currentMode = resolveScanMode(d.mode, currentMode)
        if (typeof d.imported === 'number') accum.imported = d.imported
        if (typeof d.errors === 'number') accum.errors = d.errors
        if (typeof d.updated === 'number') accum.updated = d.updated
        if (typeof d.markedMissing === 'number') accum.markedMissing = d.markedMissing
        setScanMsg(getScanProgressMessage(currentMode, d, accum.imported, locale))
      } catch { }
    })
    es.addEventListener('retry', (ev) => {
      try {
        const d = JSON.parse(ev.data)
        currentMode = resolveScanMode(d.mode, currentMode)
        setScanMsg(locale === 'ja' ? `再試行 ${d.attempt}：保留 ${d.pending}` : `Retry ${d.attempt}: pending ${d.pending}`)
      } catch { }
    })
    es.addEventListener('scan_error', (ev) => {
      try {
        const d = JSON.parse(ev.data)
        currentMode = resolveScanMode(d.mode, currentMode)
        if (typeof d.errors === 'number') accum.errors = d.errors
      } catch { /* ignore */ }
    })
    es.addEventListener('invalid_cover', (_ev) => {
      // optional: could surface invalid cover info
    })
    es.addEventListener('done', (ev) => {
      try {
        const d = JSON.parse(ev.data)
        currentMode = resolveScanMode(d.mode, currentMode)
        if (typeof d.imported === 'number') accum.imported = d.imported
        if (typeof d.errors === 'number') accum.errors = d.errors
        if (typeof d.updated === 'number') accum.updated = d.updated
        if (typeof d.markedMissing === 'number') accum.markedMissing = d.markedMissing
      } catch { }
      invalidateWorksCache()
      setScanMsg(getScanDoneMessage(currentMode, locale))
      setScanning(false)
      try { setLastScanAt(new Date().toISOString()) } catch { }
      try { es.close() } catch { }
      esRef.current = null
    })
    es.onerror = handleScanConnectionError
  }

  const attachToScan = (jobId: string) => {
    try { esRef.current?.close?.() } catch { }
    esRef.current = null
    setErr('')
    setScanMsg('')
    setScanning(true)
    const es = new EventSource(withBasePath(`/api/scan/jobs/${encodeURIComponent(jobId)}/stream`))
    esRef.current = es
    bindScanStream(es, 'full')
  }
  attachToScanRef.current = attachToScan

  const startScanStream = async (url: string, fallbackMode: ScanStatusMode) => {
    setErr('')
    setScanMsg('')
    try {
      const { jobId } = await getActiveScan()
      if (jobId) { attachToScan(jobId); return }
    } catch { }
    try {
      if (esRef.current) return
      const es = new EventSource(withBasePath(url))
      esRef.current = es
      setScanning(true)
      bindScanStream(es, fallbackMode)
    } catch (e) {
      setErr(getErrorMessage(e))
      setScanning(false)
    }
  }

  const buildServerSettingsPatch = () => {
    const paths = scanPathsText.split('\n').map(s => s.trim()).filter(Boolean)
    const portNum = parseInt(httpProxyPort, 10)
    const patch: Partial<SettingsType> = { defaultScanPaths: paths, httpProxyEnabled, httpProxyHost, httpProxyUsername }
    if (Number.isFinite(portNum)) patch.httpProxyPort = portNum
    patch.httpProxyPassword = httpProxyPassword
    patch.autoScanEnabled = !!autoScanEnabled
    patch.autoScanMode = autoScanMode
    const iv = parseInt(autoScanIntervalMinutes, 10)
    if (Number.isFinite(iv)) patch.autoScanIntervalMinutes = iv
    if (typeof autoScanDailyTime === 'string') patch.autoScanDailyTime = autoScanDailyTime
    patch.timeZone = timeZone
    return patch
  }

  // Save scan paths, proxy and auto-scan; other settings apply immediately
  const save = async (e?: React.FormEvent) => {
    e?.preventDefault?.()
    setSaveErr(''); setSaveOk('')
    try {
      await setSettings(buildServerSettingsPatch())
      setSaveOk('Saved')
    } catch (e) { setSaveErr(getErrorMessage(e)) }
  }

  const doProxyCheck = async () => {
    setProxyCheckPending(true)
    setProxyCheckErr('')
    setProxyCheck(null)
    setSaveErr('')
    try {
      await setSettings(buildServerSettingsPatch())
      setSaveOk('Saved')
      const result = await checkProxyConnection()
      setProxyCheck(result)
    } catch (e) {
      setProxyCheckErr(getErrorMessage(e))
    } finally {
      setProxyCheckPending(false)
    }
  }

  const doScan = async () => {
    await startScanStream('/api/scan/stream?newOnly=false', 'full')
  }

  const doScanNew = async () => {
    await startScanStream('/api/scan/stream?newOnly=true', 'new-only')
  }

  const doMetadataRescrape = async () => {
    await startScanStream('/api/scan/stream?metadataOnly=true&newOnly=false', 'metadata-only')
  }

  const doAlignmentScan = async () => {
    await startScanStream('/api/scan/alignment', 'alignment')
  }

  // Apply-and-save helpers for immediate settings
  const savePartial = async (patch: Partial<SettingsType>) => {
    try { await setSettings(patch) } catch { /* silently ignore */ }
  }

  const changeTheme = (v: ThemePref) => {
    // Device-only: save to localStorage and apply; do not send to server
    setTheme(v)
    applyTheme(v)
  }

  const changeAutoplay = (on: boolean) => {
    setAutoplayFolder(!!on); savePartial({ autoplayFolder: !!on })
  }

  useEffect(() => {
    ;(async () => {
      try {
        const data = await getLogs(200) as { logs: LogEntry[] }
        setLogs(data.logs || [])
        setTimeout(() => {
          if (terminalBodyRef.current) {
            terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight
          }
        }, 100)
      } catch (e) {
        console.error('Failed to load logs:', e)
      }

      try {
        if (logStreamRef.current) return
        const es = new EventSource(withBasePath('/api/logs/stream?history=false'))
        logStreamRef.current = es

        es.onmessage = (ev: MessageEvent) => {
          try {
            const log = JSON.parse(ev.data) as LogEntry
            setLogs(prev => {
              const updated = [...prev, log]
              // Keep only last 500 logs in memory
              return updated.slice(-500)
            })
            setTimeout(() => {
              if (terminalBodyRef.current) {
                terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight
              }
            }, 10)
          } catch { }
        }

        es.onerror = () => {
          try { es.close() } catch { }
          logStreamRef.current = null
        }
      } catch (e) {
        console.error('Failed to start log stream:', e)
      }
    })()

    return () => {
      try { logStreamRef.current?.close?.() } catch { }
      logStreamRef.current = null
    }
  }, [])

  const clearLogs = () => {
    setLogs([])
  }

  const toggleLogLevel = (level: LogLevel) => {
    setEnabledLogLevels(prev => {
      const next = { ...prev, [level]: !prev[level] }
      const serverLogLevels = (Object.keys(next) as LogLevel[]).filter(candidate => next[candidate])
      void savePartial({ serverLogLevels })
      return next
    })
  }

  if (loading) return <div className="card">{t('Loading…')}</div>

  return (
    <div className="settings-page">
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="card">
            <div className="text-small text-muted" style={{ marginBottom: '0.5rem' }}>{t('Sections')}</div>
            <nav className="settings-nav">
              <a href="#client">{t('Client')}</a>
              <a href="#server">{t('Server')}</a>
              <a href="#scans">{t('Manual scans')}</a>
              <a href="#account">{t('Account')}</a>
              <a href="#logs">{t('Server logs')}</a>
            </nav>
          </div>
        </aside>
        <div className="settings-content">
          <section id="client" className="card settings-section">
            <div className="settings-section__top">
              <div>
                <h2 className="settings-section__title">{t('Client')}</h2>
                <p className="settings-section__description">{t('Applies only to this device')}</p>
              </div>
              <ScopeBadge>{t('This device only')}</ScopeBadge>
            </div>
            <div className="settings-grid-two">
              <fieldset className="settings-fieldset">
                <legend className="settings-legend">{t('Theme')}</legend>
                <p className="settings-note">{t('Switch the interface theme without affecting other browsers.')}</p>
                <div className="settings-choice-row">
                  <Segmented
                    value={theme}
                    onChange={changeTheme}
                    options={[
                      { value: 'system', label: t('System') },
                      { value: 'light', label: t('Light') },
                      { value: 'dark', label: t('Dark') },
                    ]}
                  />
                </div>
              </fieldset>
              <fieldset className="settings-fieldset">
                <legend className="settings-legend">{t('Continue Play')}</legend>
                <p className="settings-note">{t('Keep listening across files in the same folder on this device.')}</p>
                <div className="settings-choice-row">
                  <Segmented
                    value={autoplayFolder ? 'on' : 'off'}
                    onChange={(v) => changeAutoplay(v === 'on')}
                    options={[
                      { value: 'off', label: t('Off') },
                      { value: 'on', label: t('On') },
                    ]}
                  />
                </div>
              </fieldset>
              <fieldset className="settings-fieldset">
                <legend className="settings-legend">{t('Language')}</legend>
                <p className="settings-note">{t('Interface language for this device.')}</p>
                <div className="settings-choice-row">
                  <Segmented
                    value={locale}
                    onChange={setLocale}
                    options={[
                      { value: 'en', label: t('English') },
                      { value: 'ja', label: t('Japanese') },
                    ]}
                  />
                </div>
              </fieldset>
            </div>
          </section>

          <form id="server" className="card settings-section" onSubmit={save}>
            <div className="settings-section__top">
              <div>
                <h2 className="settings-section__title">{t('Server')}</h2>
                <p className="settings-section__description">{t('Controls how content is discovered and fetched for everyone.')}</p>
              </div>
              <div className="settings-inline">
                <ScopeBadge>{t('Server-wide')}</ScopeBadge>
                <button className="btn btn-primary" type="submit">{t('Save')}</button>
                {saveOk && <span className="settings-status settings-status--success">{saveOk}</span>}
                {saveErr && <span className="settings-status settings-status--error">{saveErr}</span>}
              </div>
            </div>
            <fieldset className="settings-fieldset">
              <legend className="settings-legend">{t('Scan paths')}</legend>
              <span className="settings-note">{t('Provide absolute paths, one per line. The server scans these locations for every client.')}</span>
              <textarea className="textarea" rows={4} placeholder="/abs/path/one\n/abs/path/two" value={scanPathsText} onChange={e => setScanPathsText(e.target.value)} />
            </fieldset>
            <fieldset className="settings-fieldset">
              <legend className="settings-legend">{t('Scraper proxy')}</legend>
              <span className="settings-note">{t('Optional proxy for outbound scraper requests.')}</span>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: Toggle renders the labelable button control. */}
              <label className="settings-inline">
                <Toggle checked={httpProxyEnabled} onChange={setHttpProxyEnabled} />
                <span className="text-small">{t('Enable proxy')}</span>
              </label>
              <div className={`settings-form-grid ${httpProxyEnabled ? '' : 'settings-disabled'}`}>
                <div className="settings-form-grid--split">
                  <input
                    className="input"
                    placeholder={t('Proxy host (e.g., 127.0.0.1)')}
                    value={httpProxyHost}
                    onChange={e => setHttpProxyHost(e.target.value)}
                  />
                  <div className="settings-small-input">
                    <input
                      className="input"
                      placeholder={t('Port')}
                      inputMode="numeric"
                      value={httpProxyPort}
                      onChange={e => setHttpProxyPort(e.target.value)}
                    />
                  </div>
                </div>
                <div className="settings-form-grid settings-form-grid--two">
                  <input
                    className="input"
                    placeholder={t('Username (optional)')}
                    value={httpProxyUsername}
                    onChange={e => setHttpProxyUsername(e.target.value)}
                    autoComplete="off"
                    name="proxy-username"
                    data-lpignore="true"
                  />
                  <input
                    className="input"
                    type="password"
                    placeholder={t('Password (optional)')}
                    value={httpProxyPassword}
                    onChange={e => setHttpProxyPassword(e.target.value)}
                    autoComplete="new-password"
                    name="proxy-password"
                    data-lpignore="true"
                  />
                </div>
              </div>
              <div className="settings-inline">
                <button className="btn" type="button" onClick={doProxyCheck} disabled={proxyCheckPending}>
                  {proxyCheckPending ? t('Checking...') : t('Check connection')}
                </button>
                {proxyCheckErr && <span className="settings-status settings-status--error">{proxyCheckErr}</span>}
              </div>
              {proxyCheck && (
                <div className="settings-box settings-proxy-check" aria-live="polite">
                  <div className="settings-proxy-check__row">
                    <span className="settings-proxy-check__label">{t('Outbound IP')}</span>
                    <span className={proxyCheck.ip.ok ? 'settings-status settings-status--success' : 'settings-status settings-status--error'}>
                      {proxyCheck.ip.ok ? proxyCheck.ip.address : (proxyCheck.ip.error || t('Unable to resolve IP'))}
                    </span>
                  </div>
                  <div className="settings-proxy-check__row">
                    <span className="settings-proxy-check__label">DLsite</span>
                    <span className={proxyCheck.dlsite.ok ? 'settings-status settings-status--success' : 'settings-status settings-status--error'}>
                      {proxyCheck.dlsite.ok
                        ? `${t('Reachable')}${proxyCheck.dlsite.status ? ` (HTTP ${proxyCheck.dlsite.status})` : ''}`
                        : (proxyCheck.dlsite.error || t('Not reachable'))}
                    </span>
                  </div>
                  <span className="settings-note">{t('Checked')} {new Date(proxyCheck.checkedAt).toLocaleString(locale === 'ja' ? 'ja-JP' : undefined)}</span>
                </div>
              )}
            </fieldset>
            <fieldset className="settings-fieldset">
              <legend className="settings-legend">{t('Automatic scans')}</legend>
              <span className="settings-note">{t('Background scans use the paths above. The server skips new jobs if a scan is already running.')}</span>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: Toggle renders the labelable button control. */}
              <label className="settings-inline">
                <Toggle checked={autoScanEnabled} onChange={setAutoScanEnabled} />
                <span className="text-small">{t('Enable background scan')}</span>
              </label>
              <div className={`settings-form-grid ${autoScanEnabled ? '' : 'settings-disabled'}`}>
                <div className="settings-choice-row">
                  <Segmented
                    value={autoScanMode}
                    onChange={setAutoScanMode}
                    options={[
                      { value: 'interval', label: t('Every') },
                      { value: 'daily', label: t('Daily at') },
                    ]}
                  />
                </div>
                {autoScanMode === 'interval' && (
                  <div className="settings-choice-row">
                    <input
                      className="input settings-small-input"
                      placeholder={t('Minutes')}
                      inputMode="numeric"
                      value={autoScanIntervalMinutes}
                      onChange={e => setAutoScanIntervalMinutes(e.target.value)}
                    />
                    <span className="text-small">{t('minutes')}</span>
                  </div>
                )}
                {autoScanMode === 'daily' && (
                  <div className="settings-choice-row">
                    <input
                      className="input settings-small-input"
                      type="time"
                      value={autoScanDailyTime}
                      onChange={e => setAutoScanDailyTime(e.target.value)}
                    />
                    <span className="text-small">{t('in')} {timeZone}</span>
                  </div>
                )}
              </div>
            </fieldset>
            <fieldset className="settings-fieldset">
              <legend className="settings-legend">{t('Timezone')}</legend>
              <span className="settings-note">{t('Used for daily scan schedules and timestamps in server logs.')}</span>
              <label className="form-row settings-timezone-field">
                <span className="text-small text-muted">{t('IANA timezone')}</span>
                <input
                  className="input"
                  list="timezone-options"
                  value={timeZone}
                  onChange={e => setTimeZone(e.target.value)}
                  placeholder="America/New_York"
                  required
                />
                <datalist id="timezone-options">
                  {timeZoneOptions.map(option => <option key={option} value={option} />)}
                </datalist>
              </label>
            </fieldset>
          </form>

          <section id="scans" className="card settings-section">
            <div className="settings-section__top">
              <div>
                <h2 className="settings-section__title">{t('Manual scans')}</h2>
                <p className="settings-section__description">{t('Trigger a one-time scan and monitor progress.')}</p>
              </div>
              <ScopeBadge>{t('Server-wide')}</ScopeBadge>
            </div>
            <div className="settings-inline">
              <button className="btn" type="button" onClick={doScanNew} disabled={scanning} title={t('Scan only newly discovered items')}>{t('Scan new files')}</button>
              <button className="btn" type="button" onClick={doScan} disabled={scanning} title={t('Re-scrape existing items as well')}>{t('Rescan all')}</button>
              <button className="btn" type="button" onClick={doMetadataRescrape} disabled={scanning} title={t('Re-fetch metadata for existing items without updating files or covers')}>{t('Rescrape metadata')}</button>
              <button className="btn" type="button" onClick={doAlignmentScan} disabled={scanning} title={t('Update file paths without re-scraping metadata')}>{t('Align file paths')}</button>
            </div>
            <div className="settings-warning">{t('Rescan all refreshes metadata and file attachments. Rescrape metadata only updates existing metadata records. Align file paths updates locations without fetching metadata.')}</div>
            <div className="settings-inline">
              {scanning && <span className="settings-status">{t('A scan is currently running. Please wait…')}</span>}
              {scanMsg && !scanning && <span className="settings-status">{scanMsg}</span>}
              <span className="settings-status">{lastScanAt ? `${t('Last scan')}: ${new Date(lastScanAt).toLocaleString(locale === 'ja' ? 'ja-JP' : undefined)}` : t('No scans yet')}</span>
              {err && <span className="settings-status settings-status--error">{err}</span>}
            </div>
          </section>

          <section id="account" className="card settings-section">
            <div className="settings-section__top">
              <div>
                <h2 className="settings-section__title">{t('Account')}</h2>
                <p className="settings-section__description">{t('Password changes and sign-out only apply to the current user.')}</p>
              </div>
              <ScopeBadge>{t('Account')}</ScopeBadge>
            </div>
            <div className="settings-form-grid settings-form-grid--two">
              <label className="form-row">
                <span className="text-small text-muted">{t('Current password')}</span>
                <input className="input" type="password" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} autoComplete="current-password" />
              </label>
              <div className="form-row" />
              <label className="form-row">
                <span className="text-small text-muted">{t('New password')}</span>
                <input className="input" type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} autoComplete="new-password" />
              </label>
              <label className="form-row">
                <span className="text-small text-muted">{t('Confirm new password')}</span>
                <input className="input" type="password" value={pwNew2} onChange={e => setPwNew2(e.target.value)} autoComplete="new-password" />
              </label>
            </div>
            <div className="settings-inline">
              <button className="btn" type="button" onClick={async () => {
                setPwErr(''); setPwOk('')
                if (!pwCurrent || !pwNew) { setPwErr('Fill all fields'); return }
                if (pwNew !== pwNew2) { setPwErr('New passwords do not match'); return }
                if (pwNew.length < 6) { setPwErr('New password too short'); return }
                try {
                  await changePassword(pwCurrent, pwNew)
                  setPwOk('Password updated')
                  setPwCurrent(''); setPwNew(''); setPwNew2('')
                } catch (e) {
                  setPwErr(getErrorMessage(e))
                }
              }}>{t('Change password')}</button>
              {pwOk && <span className="settings-status settings-status--success">{pwOk}</span>}
              {pwErr && <span className="settings-status settings-status--error">{pwErr}</span>}
            </div>
            <div className="settings-inline">
              <button
                className="btn"
                type="button"
                disabled={logoutPending}
                onClick={async () => {
                  setLogoutErr('')
                  try {
                    setLogoutPending(true)
                    await logout()
                    navigate('/login')
                  } catch (e) {
                    setLogoutErr(getErrorMessage(e))
                  } finally {
                    setLogoutPending(false)
                  }
                }}
              >
                {logoutPending ? t('Logging out…') : t('Log out')}
              </button>
              {logoutErr && <span className="settings-status settings-status--error">{logoutErr}</span>}
            </div>
          </section>

          <section id="logs" className="card settings-section">
            <div className="settings-section__top">
              <div>
                <h2 className="settings-section__title">{t('Server logs')}</h2>
                <p className="settings-section__description">View real-time server logs and debug information. Times use {timeZone}.</p>
              </div>
                  <ScopeBadge>{t('Server-wide')}</ScopeBadge>
            </div>
            <div className="terminal-container">
              <div className="terminal-header">
                <div className="terminal-header-left">
                  <span className="terminal-title">$ server.log</span>
                  {logs.length > 0 && (
                    <span className="settings-status">
                      {logs.length} entries
                    </span>
                  )}
                </div>
                <div className="terminal-actions">
                  <div className="terminal-filters">
                  <label className="terminal-filter"><input type="checkbox" checked={enabledLogLevels.info} onChange={() => toggleLogLevel('info')} /> {t('Info')}</label>
                  <label className="terminal-filter"><input type="checkbox" checked={enabledLogLevels.warn} onChange={() => toggleLogLevel('warn')} /> {t('Warn')}</label>
                  <label className="terminal-filter"><input type="checkbox" checked={enabledLogLevels.error} onChange={() => toggleLogLevel('error')} /> {t('Error')}</label>
                  </div>
                  <button className="btn btn-sm" onClick={clearLogs} type="button">{t('Clear')}</button>
                </div>
              </div>
              <div className="terminal-body" ref={terminalBodyRef}>
                {logs.length === 0 ? (
                  <div className="terminal-empty">{t('No logs yet')}</div>
                ) : (
                  logs.map((log, idx) => {
                    const display = splitLogMessage(log.message)
                    return (
                      <div key={`${log.timestamp}-${idx}`} className={`terminal-log-entry terminal-log-entry--${log.level}`}>
                        <div className="terminal-log-line">
                          <span className="terminal-log-timestamp">
                            {logTimeFormatter.format(new Date(log.timestamp))}
                          </span>
                          <span className={`terminal-log-level terminal-log-level--${log.level}`}>
                            {log.level.toUpperCase()}
                          </span>
                          {display.scope && <span className="terminal-log-scope">{display.scope}</span>}
                          <span className="terminal-log-message">{display.message || log.message}</span>
                        </div>
                        {log.data !== undefined && log.data !== null ? <LogDetails data={log.data} /> : null}
                      </div>
                    )
                  })
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )

}
