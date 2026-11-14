import { useEffect, useRef } from 'react'
import { reportActivity } from '../activity.ts'

const ACTIVITY_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'wheel'] as const

/**
 * Appelle `onIdle` après `minutes` d'inactivité (toucher, clic, clavier).
 * Vérifie aussi au retour au premier plan : iOS suspend les minuteries d'une app en arrière-plan.
 * `minutes` ≤ 0 ou `enabled` = false : désactivé.
 */
export function useAutoLock(minutes: number | null | undefined, onIdle: () => void, enabled = true) {
  const onIdleRef = useRef(onIdle)
  useEffect(() => {
    onIdleRef.current = onIdle
  })

  useEffect(() => {
    if (!enabled || !minutes || minutes <= 0) return
    const delay = minutes * 60_000
    let lastActivity = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    let fired = false

    const fire = () => {
      if (fired) return
      fired = true
      onIdleRef.current()
    }
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(fire, delay)
    }
    const onActivity = () => {
      if (fired) return
      lastActivity = Date.now()
      reportActivity()
      arm()
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || fired) return
      if (Date.now() - lastActivity >= delay) fire()
      else {
        clearTimeout(timer)
        timer = setTimeout(fire, delay - (Date.now() - lastActivity))
      }
    }

    arm()
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimeout(timer)
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [minutes, enabled])
}
