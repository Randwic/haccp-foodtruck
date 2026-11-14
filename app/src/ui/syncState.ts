import type { SyncStatus } from '../core/api.ts'

export type SyncLevel = 'ok' | 'pending' | 'error'

export interface SyncView {
  level: SyncLevel
  label: string
  /** Raisons détaillées (affichées au toucher). */
  reasons: string[]
}

export const STALE_PENDING_MS = 24 * 60 * 60 * 1000

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

/** Traduit l'état de synchro du core en état visuel (vert / orange / rouge). */
export function describeSync(s: SyncStatus, now: number = Date.now()): SyncView {
  const reasons: string[] = []
  const stale = s.pending_count > 0 && s.oldest_pending_at !== null && now - Date.parse(s.oldest_pending_at) > STALE_PENDING_MS

  const photosPending = s.photos_pending ?? 0
  const photosFailed = s.photos_failed ?? 0
  if (s.rejected_count > 0) reasons.push(`${plural(s.rejected_count, 'saisie refusée', 'saisies refusées')} par le serveur : prévenez le gérant.`)
  if (photosFailed > 0) reasons.push(`${plural(photosFailed, 'photo refusée', 'photos refusées')} par le serveur (conflit ou fichier invalide) : prévenez le gérant. Elles restent sur l’appareil.`)
  if (stale) reasons.push('Des saisies attendent depuis plus de 24 h : connectez l’appareil à Internet dès que possible.')
  if (s.last_error) reasons.push(`Dernière erreur : ${s.last_error}`)

  if (s.rejected_count > 0 || photosFailed > 0 || stale || s.last_error) {
    let label = 'Erreur de synchronisation'
    if (s.rejected_count > 0) label = plural(s.rejected_count, 'saisie refusée', 'saisies refusées')
    else if (photosFailed > 0) label = plural(photosFailed, 'photo refusée', 'photos refusées')
    else if (stale) label = `${plural(s.pending_count, 'saisie', 'saisies')} en attente > 24 h`
    else if (s.pending_count > 0) label = `${plural(s.pending_count, 'saisie', 'saisies')} en attente – erreur`
    return { level: 'error', label, reasons }
  }
  if (s.pending_count > 0 || photosPending > 0) {
    if (!s.online) reasons.push('Hors-ligne : les saisies partiront au retour du réseau.')
    if (photosPending > 0 && s.pending_count > 0) reasons.push(`${plural(photosPending, 'photo', 'photos')} en attente d’envoi.`)
    const label =
      s.pending_count > 0 ? `${plural(s.pending_count, 'saisie', 'saisies')} en attente` : `${plural(photosPending, 'photo', 'photos')} en attente`
    return { level: 'pending', label, reasons }
  }
  return { level: 'ok', label: 'Tout est synchronisé', reasons }
}
