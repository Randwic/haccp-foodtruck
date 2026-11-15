// Réglage local (cet appareil) : hauteur des étiquettes. Rangé dans localStorage, pas sur le serveur :
// il dépend du rouleau chargé dans l'imprimante de l'appareil.
import { useSyncExternalStore } from 'react'
import { DEFAULT_LABEL_HEIGHT_MM, MAX_LABEL_HEIGHT_MM, MIN_LABEL_HEIGHT_MM } from './layout.ts'

const KEY = 'haccp.labels.height_mm'
const listeners = new Set<() => void>()

export function clampHeight(mm: number): number {
  if (!Number.isFinite(mm)) return DEFAULT_LABEL_HEIGHT_MM
  return Math.min(MAX_LABEL_HEIGHT_MM, Math.max(MIN_LABEL_HEIGHT_MM, Math.round(mm)))
}

export function getLabelHeightMm(): number {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === null ? DEFAULT_LABEL_HEIGHT_MM : clampHeight(Number(raw))
  } catch {
    return DEFAULT_LABEL_HEIGHT_MM
  }
}

export function setLabelHeightMm(mm: number): number {
  const v = clampHeight(mm)
  try {
    localStorage.setItem(KEY, String(v))
  } catch {
    /* stockage indisponible : réglage par défaut */
  }
  listeners.forEach((l) => l())
  return v
}

export function useLabelHeightMm(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getLabelHeightMm,
    () => DEFAULT_LABEL_HEIGHT_MM,
  )
}

// Étiquettes marquées « épuisées » sur cet appareil (retirées de la liste des échéances, sans perte au registre).
const DONE_KEY = 'haccp.labels.consumed'
export function getConsumed(): Set<string> {
  try {
    const raw = localStorage.getItem(DONE_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}
export function markConsumed(id: string): Set<string> {
  const s = getConsumed()
  s.add(id)
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...s].slice(-500)))
  } catch {
    /* sans importance */
  }
  return s
}
