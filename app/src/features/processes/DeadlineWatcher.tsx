import { useEffect, useRef } from 'react'
import { useToast } from '../../ui/components/index.ts'
import { loadNotified, newlyOverdue, saveNotified, showSystemNotification, vibrate } from './notifications.ts'
import { TIMED_LABELS } from './labels.ts'
import type { TimedKind } from './thresholds.ts'
import { formatMinutes } from './timing.ts'
import { useProcessStatus } from './useProcessData.ts'

/**
 * Surveille les lots chronométrés tant que l'app est ouverte et déverrouillée : à l'échéance,
 * notification système (si permise) ou toast + vibration. Chaque lot n'est signalé qu'une fois.
 */
export function DeadlineWatcher() {
  const { data, now } = useProcessStatus(15_000)
  const toast = useToast()
  const notified = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!data) return
    notified.current ??= loadNotified()
    const seen = notified.current
    for (const kind of ['cooling', 'reheating'] as TimedKind[]) {
      const rule = data.rules[kind]
      for (const b of newlyOverdue(kind === 'cooling' ? data.cooling : data.reheating, rule, now, seen)) {
        seen.add(b.batchId)
        const title = `${TIMED_LABELS[kind].title} : délai dépassé`
        const body = `${b.product} : ${formatMinutes(rule.maxMinutes * 60_000)} écoulées. Mesurez et clôturez le lot.`
        void showSystemNotification(title, body, b.batchId).then((shown) => {
          if (!shown || document.visibilityState === 'visible') {
            toast(`${title} — ${b.product}`, 'error', 10_000)
            vibrate()
          }
        })
      }
    }
    saveNotified(seen)
  }, [data, now, toast])

  return null
}
