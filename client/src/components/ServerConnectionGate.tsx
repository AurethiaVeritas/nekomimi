import { useEffect, useState, type ReactNode } from 'react'
import { withBasePath } from '../lib/basePath'
import pwa from '../lib/pwa'
import { useI18n } from '../lib/i18n'
import { applyTheme, getSavedThemePref } from '../theme'
import './ServerConnectionGate.css'

type ConnectionStatus = 'checking' | 'connected' | 'waiting'

const HEALTH_CHECK_INTERVAL_MS = 5000
const HEALTH_CHECK_TIMEOUT_MS = 4000

type ServerConnectionGateProps = {
  children: ReactNode
}

export default function ServerConnectionGate({ children }: ServerConnectionGateProps) {
  const { t } = useI18n()
  const [status, setStatus] = useState<ConnectionStatus>('checking')

  useEffect(() => {
    let active = true
    let checkInProgress = false
    let controller: AbortController | null = null

    applyTheme(getSavedThemePref())

    const checkServer = async () => {
      if (checkInProgress) return

      checkInProgress = true
      controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller?.abort(), HEALTH_CHECK_TIMEOUT_MS)

      try {
        const healthUrl = new URL(withBasePath('/api/health'), window.location.origin)
        healthUrl.searchParams.set('_connectionCheck', String(Date.now()))
        const response = await fetch(healthUrl, {
          cache: 'no-store',
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
        const body: unknown = response.ok ? await response.json() : null
        const isHealthy = typeof body === 'object' && body !== null && 'ok' in body && body.ok === true
        if (!isHealthy) throw new Error('Server health check failed')
        if (active) setStatus('connected')
      } catch {
        if (active) setStatus('waiting')
      } finally {
        window.clearTimeout(timeoutId)
        checkInProgress = false
        controller = null
        try { await pwa.check() } catch { }
      }
    }

    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') void checkServer()
    }
    const checkOnFocus = () => {
      try { applyTheme(getSavedThemePref()) } catch { }
      void checkServer()
    }

    void checkServer()
    const intervalId = window.setInterval(() => { void checkServer() }, HEALTH_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', checkWhenVisible)
    window.addEventListener('focus', checkOnFocus)
    window.addEventListener('online', checkOnFocus)

    return () => {
      active = false
      controller?.abort()
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', checkWhenVisible)
      window.removeEventListener('focus', checkOnFocus)
      window.removeEventListener('online', checkOnFocus)
    }
  }, [])

  if (status === 'connected') return children

  const message = status === 'checking' ? t('Connecting to server…') : t('Waiting for server…')

  return (
    <main className="connection-screen" aria-busy="true">
      <div className="connection-screen__content" role="status" aria-live="polite">
        <div className="connection-screen__mark" aria-hidden="true">
          <img src={withBasePath('/favicon.svg')} alt="" />
        </div>
        <h1 className="connection-screen__title">Nekomimi</h1>
        <p className="connection-screen__status">{message}</p>
      </div>
    </main>
  )
}
