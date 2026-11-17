import { useEffect, useState } from 'react'
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom'
import { bootstrap, login, me, verifySetupToken } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import './Login.css'

export default function Login() {
  const { t } = useI18n()
  const [mode, setMode] = useState<'login' | 'token' | 'bootstrap'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [checking, setChecking] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    ;(async () => {
      try {
        const r = await me()
        if (r.user) return navigate('/')
      } catch {}
      setChecking(false)
    })()
  }, [navigate])

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submitting) return
    setError('')
    setSubmitting(true)
    try {
      if (mode === 'token') {
        await verifySetupToken(setupToken.trim())
        setMode('bootstrap')
        return
      }
      if (mode === 'bootstrap') await bootstrap(username, password, setupToken.trim())
      else await login(username, password)
      // verify session before leaving the page
      const r = await me()
      if (r.user) navigate('/')
      else setError(t('Login succeeded but session not established (check cookies)'))
    } catch (err) {
      if (err instanceof Error) setError(err.message)
      else setError(t('Authentication failed'))
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) return null

  return (
    <div className="auth-page">
      <form key={mode} onSubmit={onSubmit} className="card auth-card form-card" autoComplete={mode === 'token' ? 'off' : 'on'}>
        <h1 className="auth-heading">{mode === 'login' ? t('Sign in') : mode === 'token' ? t('Verify setup token') : t('Initialize Admin')}</h1>
        {mode === 'token' ? (
          <div className="form-row">
            <label className="text-small text-muted" htmlFor="setup-token">{t('Account setup token')}</label>
            <input id="setup-token" name="setup-token" className="input" type="text" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} value={setupToken} onChange={e => setSetupToken(e.target.value)} required aria-describedby="setup-token-help" />
            <p id="setup-token-help" className="text-small text-muted">{t('Copy the account setup token from the server terminal. It changes whenever the server restarts before setup is complete.')}</p>
          </div>
        ) : (
          <>
            <div className="form-row">
              <label className="text-small text-muted" htmlFor="username">{t('Username')}</label>
              <input id="username" name="username" className="input" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required minLength={3} />
            </div>
            <div className="form-row">
              <label className="text-small text-muted" htmlFor="password">{t('Password')}</label>
              <input id="password" name="password" className="input" type="password" autoComplete={mode === 'bootstrap' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === 'bootstrap' ? 12 : 6} />
            </div>
          </>
        )}
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="btn btn-primary btn-full" type="submit" disabled={submitting}>{mode === 'token' ? t('Continue') : mode === 'bootstrap' ? t('Create Admin & Sign in') : t('Sign in')}</button>
        {mode === 'bootstrap' && (
          <button type="button" className="btn btn-full" disabled={submitting} onClick={() => { setMode('token'); setSetupToken(''); setError('') }}>
            {t('Back to setup token')}
          </button>
        )}
        <button type="button" className="btn btn-full" disabled={submitting} onClick={() => { setMode(mode === 'login' ? 'token' : 'login'); setSetupToken(''); setUsername(''); setPassword(''); setError('') }}>
          {mode === 'login' ? t('Initialize admin') : t('Have an account? Sign in')}
        </button>
      </form>
    </div>
  )
}
