type ThemePref = 'light' | 'dark' | 'system'
type RootWithHandler = HTMLElement & { __themeHandler?: (e: MediaQueryListEvent) => void }

export function applyTheme(theme?: ThemePref | null) {
  const root = document.documentElement as RootWithHandler
  const mq = window.matchMedia('(prefers-color-scheme: dark)')

  const set = (mode: ThemePref) => {
    if (mode === 'light') {
      root.classList.add('light')
    } else {
      root.classList.remove('light')
    }
  }

  if (theme === 'system' || !theme) {
    try { localStorage.setItem('themePref', 'system') } catch {}
    // Clean up any existing listener to avoid duplicates
    if (root.__themeHandler) {
      const existing = root.__themeHandler
      mq.removeEventListener('change', existing)
      delete root.__themeHandler
    }
    set(mq.matches ? 'dark' : 'light')
    const handler = (e: MediaQueryListEvent) => set(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', handler)
    // Store handler so we could remove later if needed
    root.__themeHandler = handler
  } else {
    if (root.__themeHandler) {
      const handler = root.__themeHandler
      const mqInner = window.matchMedia('(prefers-color-scheme: dark)')
      mqInner.removeEventListener('change', handler)
      delete root.__themeHandler
    }
    try { localStorage.setItem('themePref', theme) } catch {}
    set(theme)
  }
}

export function getSavedThemePref(): ThemePref {
  try {
    const v = localStorage.getItem('themePref')
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {}
  return 'system'
}
