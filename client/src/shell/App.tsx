import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { PlayerProvider } from '../player/PlayerContext'
import PlayerBar from '../player/PlayerBar'
import { me, logout } from '../lib/auth'
import pwa, { subscribePWAStatus } from '../lib/pwa'
import PullToRefresh from './PullToRefresh'
import TopTapHotspot from './TopTapHotspot'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import useMediaQuery from '../lib/useMediaQuery'
import homeIcon from '../assets/folder-open-solid-full.svg'
import circleIcon from '../assets/circle-home-outline.svg'
import searchIcon from '../assets/magnifying-glass-solid-full.svg'
import collectionIcon from '../assets/list-ul-solid-full.svg'
import addIcon from '../assets/plus-solid-full.svg'
import settingsIcon from '../assets/gear-solid-full.svg'
import refreshIcon from '../assets/arrow-rotate-right-solid-full.svg'
import logoutIcon from '../assets/right-from-bracket-solid-full.svg'
import { useI18n } from '../lib/i18n'
import './App.css'

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: homeIcon, end: true },
  { to: '/circles', label: 'Circle', icon: circleIcon },
  { to: '/search', label: 'Advanced Search', mobileLabel: 'Search', icon: searchIcon },
  { to: '/collections', label: 'Collections', icon: collectionIcon },
  { to: '/add', label: 'Add Work', mobileLabel: 'Add', icon: addIcon },
  { to: '/settings', label: 'Settings', icon: settingsIcon },
] as const

const navLinkClassName = ({ isActive }: { isActive: boolean }) => `btn ${isActive ? 'btn-primary' : ''}`

function AppNavLinks({ mobile = false }: { mobile?: boolean }) {
  const { t } = useI18n()
  return NAV_ITEMS.map(item => (
    <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : undefined} className={navLinkClassName}>
      <img className="app-nav__icon" src={item.icon} alt="" aria-hidden="true" />
      {t(mobile && 'mobileLabel' in item ? item.mobileLabel : item.label)}
    </NavLink>
  ))
}

export default function App() {
  const { t } = useI18n()
  const location = useLocation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false)
  const [needPwaRefresh, setNeedPwaRefresh] = useState(false)
  const useCompactMobileNav = !useMediaQuery('(min-width: 640px)')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)
  const [logoutErr, setLogoutErr] = useState('')
  const mobileNavRef = useRef<HTMLDivElement | null>(null)
  const mobileNavToggleRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    let mounted = true
    me().then(r => {
      if (!mounted) return
      if (!r.user) navigate('/login')
    }).finally(() => mounted && setReady(true))
    return () => { mounted = false }
  }, [navigate])
  useEffect(() => {
    const unsub = subscribePWAStatus(state => setNeedPwaRefresh(state.needRefresh))
    return () => { unsub() }
  }, [])
  useEffect(() => {
    if (!useCompactMobileNav) setMobileNavOpen(false)
  }, [useCompactMobileNav])
  useEffect(() => {
    if (!mobileNavOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      const navEl = mobileNavRef.current
      const toggleEl = mobileNavToggleRef.current
      const target = event.target as Node | null
      if (!navEl || !target || navEl.contains(target)) return
      if (toggleEl?.contains(target)) return
      setMobileNavOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [mobileNavOpen])
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  const mobileNavClasses = ['app-mobile-nav']
  if (useCompactMobileNav) mobileNavClasses.push('compact')
  if (mobileNavOpen) mobileNavClasses.push('open')

  const toggleMobileNav = () => setMobileNavOpen((prev) => !prev)
  const handleLogout = async () => {
    if (logoutPending) return
    setLogoutPending(true)
    setLogoutErr('')
    try {
      await logout()
      navigate('/login')
    } catch {
      setLogoutErr(t('Log out failed.'))
    } finally {
      setLogoutPending(false)
    }
  }
  const suspenseFallback = useMemo(() => {
    const path = location.pathname || '/'
    let label = t('Loading…')
    if (path.startsWith('/circles')) {
      label = t('Loading circles…')
    } else if (path.startsWith('/search')) {
      label = t('Loading search…')
    } else if (path.startsWith('/collections')) {
      label = t('Loading collections…')
    }
    return <LoadingSpinner size="lg" centered label={label} />
  }, [location.pathname, t])

  return (
    <PlayerProvider>
      <div className="app-shell">
        <aside className="card app-shell__sidebar">
          <div className="app-sidebar__title">Nekomimi</div>
          <nav className="app-sidebar">
            <AppNavLinks />
          </nav>
          <div className="app-sidebar__footer">
            <button type="button" className="btn" title={t('Refresh content')} onClick={() => pwa.refresh()}>
              <img className="app-nav__icon" src={refreshIcon} alt="" aria-hidden="true" />
              {t('Refresh')}
            </button>
            {needPwaRefresh && (
              <button type="button" className="btn btn-primary" onClick={() => pwa.refresh()}>
                <img className="app-nav__icon" src={refreshIcon} alt="" aria-hidden="true" />
                {t('Update available — Reload')}
              </button>
            )}
            <button type="button" className="btn" onClick={handleLogout} disabled={logoutPending}>
              <img className="app-nav__icon" src={logoutIcon} alt="" aria-hidden="true" />
              {logoutPending ? t('Logging out…') : t('Log out')}
            </button>
            {logoutErr && <span className="app-sidebar__status">{logoutErr}</span>}
          </div>
        </aside>
        <main className="app-shell__main">
          <header className="app-shell__header">
            <h1 className="text-title">{t(titleFor(location.pathname))}</h1>
            {useCompactMobileNav && (
              <button
                type="button"
                ref={mobileNavToggleRef}
                className={`app-mobile-nav-toggle${mobileNavOpen ? ' is-open' : ''}`}
                aria-label={t(mobileNavOpen ? 'Close navigation' : 'Open navigation')}
                aria-controls="app-mobile-nav"
                aria-expanded={mobileNavOpen}
                onClick={toggleMobileNav}
              >
                <span className="sr-only">{t(mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu')}</span>
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path
                    d="M4 6h16M4 12h16M4 18h16"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </header>
          <nav
            ref={mobileNavRef}
            id="app-mobile-nav"
            className={mobileNavClasses.join(' ')}
          >
            <AppNavLinks mobile />
          </nav>
          {ready ? (
            <Suspense fallback={suspenseFallback}>
              <Outlet />
            </Suspense>
          ) : null}
        </main>
      </div>
      {/* Mobile pull-to-refresh to refresh app/content */}
      <PullToRefresh onRefresh={pwa.refresh} />
      {/* Tap the very top area to scroll to top (mobile) */}
      <TopTapHotspot />
      <PlayerBar />
    </PlayerProvider>
  )
}

function titleFor(path: string) {
  if (path.startsWith('/add')) return 'Add Work'
  if (path.startsWith('/edit')) return 'Edit Work'
  if (path.startsWith('/work/')) return 'Work Details'
  if (path.startsWith('/search')) return 'Advanced Search'
  if (path.startsWith('/collections')) return 'Collections'
  if (path.startsWith('/settings')) return 'Settings'
  if (path.startsWith('/circles')) return 'Circle'
  return 'Home'
}
