export type AppleDevice = 'iphone' | 'ipad' | 'other'

/** L'app tourne-t-elle depuis l'écran d'accueil (PWA installée) ? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  } catch {
    return false
  }
}

/** iPad sous iPadOS 13+ se présente comme un Mac : on le reconnaît à l'écran tactile. */
export function detectAppleDevice(): AppleDevice {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  if (/iPhone|iPod/.test(ua)) return 'iphone'
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ipad'
  return 'other'
}

const DISMISS_KEY = 'haccp.install-banner.dismissed-at'
const DISMISS_MS = 24 * 60 * 60 * 1000

export function isInstallBannerDismissed(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
    return now - at < DISMISS_MS
  } catch {
    return false
  }
}

export function dismissInstallBanner(now = Date.now()) {
  try {
    localStorage.setItem(DISMISS_KEY, String(now))
  } catch {
    /* stockage indisponible : la bannière réapparaîtra */
  }
}
