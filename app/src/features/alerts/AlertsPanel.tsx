// Bloc « Alertes » de l'écran Aujourd'hui : alertes envoyées par le serveur (relevés en retard, procédés non
// clôturés, actions correctives manquantes, capteurs), bouton « Vu », et proposition d'activer les notifications.
import { useEffect, useState } from 'react'
import { Button } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { useNow } from '../../ui/hooks/useNow.ts'
import { IconAlert, IconBell, IconChevronDown, IconChevronUp, IconOk } from '../../ui/icons.tsx'
import { plural, DEFAULT_TIMEZONE } from '../temperatures/schedule.ts'
import { whenLabel } from '../temperatures/format.ts'
import { processViewOf, type AlertView } from './model.ts'
import { enableAlertNotifications, notificationPermission, pushSupport, subscribeDevice } from './pushSetup.ts'
import { useAlerts } from './useAlerts.ts'

const FIRST_VISIBLE = 3

export interface AlertsPanelProps {
  onOpenTemperatures: () => void
  onOpenProcess: (view: 'cooling' | 'reheating' | 'cooking') => void
}

function AlertRow({ view, now, busy, onSeen, onOpen }: { view: AlertView; now: Date; busy: boolean; onSeen?: () => void; onOpen?: () => void }) {
  const { alert, title, seen } = view
  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 ${seen ? 'border-line bg-surface' : 'border-danger/35 bg-elevated'}`}>
      <span className="min-w-0 flex-1 basis-56 text-[16px] text-fg">
        <span className="block font-semibold">{title}</span>
        <span className="block">{alert.message}</span>
        <span className="block text-[14px] text-fg-subtle">
          Depuis {whenLabel(alert.opened_at, now, DEFAULT_TIMEZONE)}
          {seen ? ' · déjà vue, toujours en cours' : ''}
        </span>
      </span>
      <span className="flex flex-wrap gap-2">
        {onOpen && (
          <Button variant="secondary" onClick={onOpen}>
            Ouvrir
          </Button>
        )}
        {onSeen && (
          <Button variant="primary" onClick={onSeen} disabled={busy} aria-label={`Marquer comme vue : ${title} — ${alert.message}`}>
            Vu
          </Button>
        )}
      </span>
    </li>
  )
}

/** Proposition d'activer les notifications (affichée tant que l'appareil ne les a ni acceptées ni refusées). */
function NotificationOffer() {
  const core = useCore()
  const [permission, setPermission] = useState(notificationPermission)
  const [message, setMessage] = useState<string | null>(null)
  const support = pushSupport()

  // Déjà acceptées : on (ré)abonne l'appareil en silence, pour que le serveur puisse le prévenir app fermée.
  useEffect(() => {
    if (permission === 'granted') void subscribeDevice(core)
  }, [core, permission])

  if (support === 'ios-install') {
    return (
      <p className="flex items-center gap-2 text-[14px] text-fg-muted">
        <IconBell size={17} className="shrink-0" />
        Pour être prévenu même app fermée : installez l’app sur l’écran d’accueil de l’iPad (Partager › Sur l’écran d’accueil), puis ouvrez-la depuis l’icône.
      </p>
    )
  }
  if (message) return <p role="status" className="flex items-center gap-2 text-[14px] text-fg-muted"><IconBell size={17} className="shrink-0" />{message}</p>
  if (permission !== 'default') return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="flex min-w-0 flex-1 basis-56 items-center gap-2 text-[15px] text-fg">
        <IconBell size={18} className="shrink-0 text-accent" />
        Être prévenu sur cet appareil dès qu’une alerte arrive.
      </p>
      <Button
        variant="secondary"
        onClick={async () => {
          const r = await enableAlertNotifications(core)
          setPermission(notificationPermission())
          setMessage(
            r === 'push'
              ? 'Notifications activées : cet appareil sera prévenu, même app fermée.'
              : r === 'local'
                ? 'Notifications activées quand l’app est ouverte.'
                : r === 'denied'
                  ? 'Notifications refusées. Pour les autoriser : Réglages de l’iPad › Notifications.'
                  : 'Notifications non disponibles sur cet appareil.',
          )
        }}
      >
        Activer les notifications
      </Button>
    </div>
  )
}

export function AlertsPanel({ onOpenTemperatures, onOpenProcess }: AlertsPanelProps) {
  const { views, acknowledge, acknowledgeAll } = useAlerts()
  const now = useNow(60_000)
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!views) return null

  const unseen = views.filter((v) => !v.seen)
  const seen = views.filter((v) => v.seen)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  const openFor = (v: AlertView) =>
    v.target === 'temperatures' ? onOpenTemperatures : v.target === 'processes' ? () => onOpenProcess(processViewOf(v.alert.message)) : undefined

  if (views.length === 0) {
    return (
      <section aria-label="Alertes" className="mb-4">
        <NotificationOffer />
      </section>
    )
  }

  const visibleUnseen = showAll ? unseen : unseen.slice(0, FIRST_VISIBLE)
  const hidden = showAll ? 0 : unseen.length - visibleUnseen.length + (unseen.length > 0 ? seen.length : 0)
  const tone = unseen.length > 0 ? 'border-danger/35 bg-danger-soft' : 'border-line bg-surface shadow-card'

  return (
    <section aria-labelledby="alerts-title" className={`mb-4 flex flex-col gap-3 rounded-2xl border px-4 py-4 sm:px-5 ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="alerts-title" className="flex min-w-0 flex-1 basis-48 items-center gap-2 text-[18px] font-bold text-fg">
          {unseen.length > 0 ? <IconAlert size={22} className="shrink-0 text-danger" /> : <IconOk size={22} className="shrink-0 text-ok" />}
          {unseen.length > 0 ? plural(unseen.length, 'alerte à voir', 'alertes à voir') : 'Alertes vues, toujours en cours'}
        </h2>
        {unseen.length > 1 && (
          <Button variant="secondary" disabled={busy} onClick={() => run(acknowledgeAll)}>
            Tout marquer comme vu
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {visibleUnseen.map((v) => (
          <AlertRow key={v.alert.id} view={v} now={now} busy={busy} onSeen={() => run(() => acknowledge(v.alert.id))} onOpen={openFor(v)} />
        ))}
        {(showAll || unseen.length === 0) && seen.map((v) => <AlertRow key={v.alert.id} view={v} now={now} busy={busy} onOpen={openFor(v)} />)}
      </ul>
      {(hidden > 0 || showAll) && (
        <div>
          <Button variant="ghost" icon={showAll ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />} onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Réduire' : hidden === 1 ? 'Voir l’autre alerte' : `Voir les ${hidden} autres alertes`}
          </Button>
        </div>
      )}
      <NotificationOffer />
    </section>
  )
}
