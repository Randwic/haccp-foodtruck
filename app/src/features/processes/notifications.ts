// Alertes locales d'échéance des lots chronométrés (pas de push serveur) : notification système si
// l'utilisateur l'a permise, sinon toast + vibration. Uniquement quand l'app est ouverte.
import type { TimedBatch } from './entries.ts'
import type { TimedRule } from './thresholds.ts'
import { countdown } from './timing.ts'

const STORAGE_KEY = 'haccp.process-deadline-alerts'

/** Lots en cours dont l'échéance est passée et pas encore signalés (fonction pure). */
export function newlyOverdue(batches: readonly TimedBatch[], rule: TimedRule, now: Date, alreadyNotified: ReadonlySet<string>): TimedBatch[] {
  return batches.filter((b) => b.running && !alreadyNotified.has(b.batchId) && countdown(b.startedAt, rule, now).urgency === 'overdue')
}

export function loadNotified(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveNotified(ids: ReadonlySet<string>) {
  try {
    // Garde les 200 derniers : suffisant, la liste ne grossit pas indéfiniment.
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids].slice(-200)))
  } catch {
    /* stockage plein ou interdit : sans conséquence */
  }
}

/** Demande la permission (à appeler sur un geste : démarrage d'un lot). Sans effet si déjà décidé. */
export async function requestDeadlineNotifications(): Promise<void> {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission()
  } catch {
    /* navigateur sans Notification API */
  }
}

/** Notification système si permise. Renvoie true si elle a été affichée. */
export async function showSystemNotification(title: string, body: string, tag: string): Promise<boolean> {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
    // iOS (PWA installée) exige le service worker ; ailleurs le constructeur suffit.
    const reg = await navigator.serviceWorker?.getRegistration?.()
    if (reg) await reg.showNotification(title, { body, tag })
    else new Notification(title, { body, tag })
    return true
  } catch {
    return false
  }
}

export function vibrate() {
  try {
    navigator.vibrate?.([200, 100, 200, 100, 400])
  } catch {
    /* non supporté (iOS) */
  }
}
