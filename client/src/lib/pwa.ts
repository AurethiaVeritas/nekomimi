import { registerSW } from 'virtual:pwa-register'

const isDev = import.meta.env.DEV
const devEnabled = import.meta.env.VITE_ENABLE_PWA_DEV === '1'

type PwaState = {
  offlineReady: boolean
  needRefresh: boolean
}

type StatusListener = (state: PwaState) => void

const listeners = new Set<StatusListener>()
const state: PwaState = {
  offlineReady: false,
  needRefresh: false,
}

function notify() {
  listeners.forEach((fn) => {
    fn({ ...state })
  })
}

// Only register SW in production or when dev explicitly enabled
let updateSW: (reload?: boolean) => Promise<void> = async (_reload) => {
  if (_reload) window.location.reload()
}

if (import.meta.env.PROD || (isDev && devEnabled)) {
  updateSW = registerSW({
    immediate: import.meta.env.PROD,
    onOfflineReady() {
      state.offlineReady = true
      notify()
    },
    onNeedRefresh() {
      state.needRefresh = true
      notify()
    },
  })
}

export function subscribePWAStatus(fn: StatusListener) {
  listeners.add(fn)
  // push current state once
  fn({ ...state })
  return () => listeners.delete(fn)
}

async function checkForUpdates() {
  try { await updateSW() } catch {}
}

async function applyUpdateAndReload() {
  try { await updateSW(true) } catch { /* fall through */ }
  // If no update was applied, do a soft reload
  window.location.reload()
}

export const pwa = {
  check: checkForUpdates,
  refresh: applyUpdateAndReload,
}

export default pwa
