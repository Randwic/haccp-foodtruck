import type { Equipment } from '../../../../shared/types.ts'
import { Badge, Button } from '../../ui/components/index.ts'
import { formatTime } from '../../ui/format.ts'
import { IconChevronRight, IconDue, IconError, IconFridge, IconHistory, IconOk, IconSnowflake, IconWarn } from '../../ui/icons.tsx'
import { describeThreshold, formatTemperature } from '../../ui/temperature.ts'
import { whenLabel } from './format.ts'
import type { Reading } from './readings.ts'
import { nextSlot, plural, type EnclosureStatus } from './schedule.ts'
import { enclosureThreshold, type TemperatureData } from './useTemperatureData.ts'

export function EnclosureIcon({ kind, size = 22 }: { kind: Equipment['kind']; size?: number }) {
  return kind === 'freezer' ? <IconSnowflake size={size} /> : <IconFridge size={size} />
}

/** Résultat d'un relevé : icône + texte, jamais la couleur seule. */
export function ConformityBadge({ inRange }: { inRange: boolean }) {
  return inRange ? (
    <Badge tone="ok">
      <IconOk size={14} strokeWidth={2.25} />
      Conforme
    </Badge>
  ) : (
    <Badge tone="error">
      <IconWarn size={14} strokeWidth={2.25} />
      Hors seuil
    </Badge>
  )
}

interface Props {
  data: TemperatureData
  statuses: EnclosureStatus[]
  now: Date
  onSelect: (equipmentId: string) => void
  onHistory: () => void
  onCorrectiveAction: (reading: Reading) => void
}

/** Liste des enceintes : dernier relevé, statut du créneau en cours, actions correctives manquantes. */
export function EnclosureList({ data, statuses, now, onSelect, onHistory, onCorrectiveAction }: Props) {
  const tz = data.timeZone
  const slot = statuses[0]?.slot ?? null
  const next = nextSlot(now, data.checkTimes, tz)
  const missing = statuses.flatMap((s) => s.missingActions.map((r) => ({ reading: r, equipment: s.equipment })))
  const due = statuses.filter((s) => s.state === 'due').length

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Températures</h1>
          <p className="mt-1 text-[16px] text-fg-muted">
            {data.checkTimes.length === 0
              ? 'Aucune heure de relevé définie (Gestion › Réglages).'
              : `Relevés à ${data.checkTimes.join(', ')}${slot ? ` · créneau en cours : ${formatTime(slot, tz)}` : ''}${next ? ` · prochain : ${formatTime(next, tz)}` : ''}`}
          </p>
        </div>
        <Button variant="secondary" onClick={onHistory} icon={<IconHistory size={20} />}>
          Historique
        </Button>
      </div>

      {missing.length > 0 && (
        <section aria-labelledby="missing-title" className="mb-6 rounded-2xl border border-danger/35 bg-danger-soft p-4 sm:p-5">
          <h2 id="missing-title" className="flex items-center gap-2.5 text-[17px] font-semibold text-danger">
            <IconError size={22} className="shrink-0" />
            {plural(missing.length, 'action corrective manquante', 'actions correctives manquantes')}
          </h2>
          <ul className="mt-3 space-y-2.5">
            {missing.map(({ reading, equipment }) => (
              <li key={reading.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
                <span className="text-[16px] text-fg">
                  <span className="font-semibold">{equipment.name}</span> · {formatTemperature(reading.value_c)} · {whenLabel(reading.time, now, tz)}
                </span>
                <Button variant="danger" onClick={() => onCorrectiveAction(reading)}>
                  Faire l’action corrective
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {statuses.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-5 text-[17px] text-fg-muted shadow-card">
          Aucun frigo ni congélateur en service. Le gérant peut en ajouter dans Gestion › Équipements.
        </p>
      ) : (
        <>
          <h2 className="mb-3 text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
            Enceintes froides{due > 0 ? ` · ${plural(due, 'relevé à faire', 'relevés à faire')}` : ''}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3" aria-label="Enceintes froides">
            {statuses.map((s) => (
              <li key={s.equipment.id}>
                <EnclosureCard status={s} data={data} now={now} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function EnclosureCard({ status, data, now, onSelect }: { status: EnclosureStatus; data: TemperatureData; now: Date; onSelect: (id: string) => void }) {
  const { equipment, last, state, missingActions } = status
  const threshold = enclosureThreshold(equipment, data.thresholds)
  const label = [
    equipment.name,
    state === 'due' ? 'relevé à faire' : state === 'done' ? 'relevé fait' : '',
    missingActions.length ? 'action corrective manquante' : '',
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <button
      type="button"
      onClick={() => onSelect(equipment.id)}
      aria-label={`${label}. Saisir un relevé`}
      className={`flex h-full min-h-44 w-full flex-col gap-4 rounded-2xl border bg-surface p-4 text-left shadow-card transition-[background-color,transform] duration-100 active:scale-[0.99] active:bg-pressed sm:p-5 ${
        missingActions.length ? 'border-danger/50' : state === 'due' ? 'border-warn/50' : 'border-line'
      }`}
    >
      <div className="flex w-full items-start gap-3">
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <EnclosureIcon kind={equipment.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] leading-snug font-semibold tracking-[-0.01em] text-fg">{equipment.name}</div>
          <div className="text-[14px] text-fg-subtle">
            Seuil {describeThreshold(threshold)}
            {threshold.isDefault ? ' (par défaut)' : ''}
          </div>
        </div>
        {state === 'due' && (
          <Badge tone="warn">
            <IconDue size={14} strokeWidth={2.25} />
            À faire
          </Badge>
        )}
        {state === 'done' && (
          <Badge tone="ok">
            <IconOk size={14} strokeWidth={2.25} />
            Fait
          </Badge>
        )}
      </div>

      <div className="mt-auto flex w-full items-end justify-between gap-3">
        {last ? (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[30px] leading-none font-semibold tracking-[-0.02em] text-fg tabular-nums">{formatTemperature(last.value_c)}</span>
              <ConformityBadge inRange={last.in_range} />
            </div>
            <div className="mt-1.5 text-[14px] text-fg-muted">Dernier relevé {whenLabel(last.time, now, data.timeZone)}</div>
          </div>
        ) : (
          <div className="text-[15px] text-fg-muted">Aucun relevé sur 7 jours</div>
        )}
        <IconChevronRight size={22} className="shrink-0 text-fg-subtle" />
      </div>

      {missingActions.length > 0 && (
        <div className="flex w-full items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[15px] font-semibold text-danger">
          <IconError size={18} className="shrink-0" />
          Action corrective manquante
        </div>
      )}
    </button>
  )
}
