// Notifications des alertes (lot 6) : abonnement Web Push de l'appareil pour être prévenu même app fermée.
// Le serveur (alerts-evaluate) envoie la notification ; le service worker (public/push-sw.js) l'affiche.
// iPad / iPhone : uniquement si l'app est installée sur l'écran d'accueil (iOS 16.4 ou plus récent).
import type { CoreApi } from '../../core/api.ts'

export type PushSupport = 'ok' | 'ios-install' | 'unsupported'
export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

function isIos(): boolean {
  const ua = navigator.userAgent
  // iPadOS se présente comme un Mac : on reconnaît l'écran tactile.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported'
  const hasApis = typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
  if (isIos() && !isStandalone()) return 'ios-install'
  return hasApis ? 'ok' : 'unsupported'
}

export function notificationPermission(): NotificationPermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

/** Clé VAPID base64url → octets (format attendu par pushManager.subscribe). */
export function vapidKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function readyRegistration(timeoutMs = 10_000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))])
}

/**
 * Abonne l'appareil (ou renouvelle son abonnement) auprès du serveur. Sans effet visible si déjà fait.
 * Renvoie 'push' si le serveur peut prévenir l'appareil app fermée, sinon la raison.
 */
export async function subscribeDevice(core: CoreApi): Promise<'push' | 'no-server' | 'unsupported' | 'error'> {
  if (pushSupport() !== 'ok' || notificationPermission() !== 'granted') return 'unsupported'
  if (!core.getPushPublicKey || !core.subscribePush) return 'no-server'
  try {
    const key = await core.getPushPublicKey()
    if (!key) return 'no-server'
    const reg = await readyRegistration()
    if (!reg) return 'unsupported'
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(key) }))
    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return 'error'
    await core.subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } })
    return 'push'
  } catch {
    return 'error'
  }
}

/** À appeler sur un appui (exigé par Safari) : demande la permission puis abonne l'appareil. */
export async function enableAlertNotifications(core: CoreApi): Promise<'push' | 'local' | 'denied' | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported'
  try {
    if (Notification.permission === 'default') await Notification.requestPermission()
  } catch {
    return 'unsupported'
  }
  if (Notification.permission !== 'granted') return 'denied'
  return (await subscribeDevice(core)) === 'push' ? 'push' : 'local'
}
