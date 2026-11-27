// Retour en glissant le doigt depuis le bord gauche de l'écran vers la droite (comme sur iPhone / iPad).
// L'application installée sur l'écran d'accueil n'a pas ce geste : il « touche » le bouton retour
// visible de l'écran (BackButton, marqué data-swipe-back). Rien ne se passe si une fenêtre est ouverte.
import { useEffect } from 'react'

/** Départ du geste : à moins de 40 px du bord gauche. */
const EDGE_PX = 40
/** Distance horizontale minimale. */
const MIN_DX = 70

export function findBackButton(root: ParentNode = document): HTMLButtonElement | null {
  if (root.querySelector('[role="dialog"], [aria-modal="true"]')) return null
  const all = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-swipe-back]')).filter((b) => !b.disabled)
  return all.at(-1) ?? null
}

export function useSwipeBack(enabled = true) {
  useEffect(() => {
    if (!enabled) return
    let start: { x: number; y: number; t: number } | null = null
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      start = e.touches.length === 1 && t && t.clientX <= EDGE_PX ? { x: t.clientX, y: t.clientY, t: Date.now() } : null
    }
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      const s = start
      start = null
      if (!s || !t) return
      const dx = t.clientX - s.x
      const dy = Math.abs(t.clientY - s.y)
      if (dx < MIN_DX || dy > dx / 2 || Date.now() - s.t > 1000) return
      findBackButton()?.click()
    }
    const onCancel = () => {
      start = null
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onCancel)
    }
  }, [enabled])
}
