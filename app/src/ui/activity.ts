// Point unique où l'interface signale une activité de l'utilisateur (toucher, clavier).
// Le vrai core expose `notifyActivity()` (app/src/core/index.ts) : le brancher dans main.tsx via
//   setActivityNotifier(notifyActivity)
type Notifier = () => void

let notifier: Notifier | null = null

export function setActivityNotifier(fn: Notifier | null) {
  notifier = fn
}

/** Appelé par useAutoLock à chaque activité détectée. */
export function reportActivity() {
  try {
    notifier?.()
  } catch {
    /* une erreur du core ne doit jamais bloquer l'interface */
  }
}
