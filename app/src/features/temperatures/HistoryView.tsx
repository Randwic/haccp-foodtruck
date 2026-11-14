import { useMemo } from 'react'
import { Badge, Button } from '../../ui/components/index.ts'
import { formatTime } from '../../ui/format.ts'
import { IconCheck, IconEdit, IconError, IconSyncPending } from '../../ui/icons.tsx'
import { formatTemperature } from '../../ui/temperature.ts'
import { asCorrectiveAction, type Reading } from './readings.ts'
import { correctiveActionLabel } from '../corrective-action/actions.ts'
import { ConformityBadge } from './EnclosureList.tsx'
import { dayLabel } from './format.ts'
import { localDayKey, startOfLocalDay } from './schedule.ts'
import { HISTORY_DAYS, type TemperatureData } from './useTemperatureData.ts'

interface Props {
  data: TemperatureData
  now: Date
  equipmentId: string | null
  onFilter: (equipmentId: string | null) => void
  onCorrect: (reading: Reading) => void
  onCorrectiveAction: (reading: Reading) => void
}

/** Historique : relevés d'aujourd'hui et des 7 derniers jours, par jour ; corrections barrées, jamais supprimées. */
export function HistoryView({ data, now, equipmentId, onFilter, onCorrect, onCorrectiveAction }: Props) {
  const tz = data.timeZone
  const from = startOfLocalDay(now, tz, HISTORY_DAYS).getTime()
  const author = (id: string) => data.staff.find((s) => s.id === id)?.display_name ?? 'Ancien membre'
  const equipmentName = (id: string) => data.enclosures.find((e) => e.id === id)?.name ?? 'Enceinte retirée'

  const days = useMemo(() => {
    const list = data.readings.filter((r) => Date.parse(r.time) >= from && (equipmentId === null || r.equipmentId === equipmentId))
    const groups = new Map<string, Reading[]>()
    for (const r of list) {
      const k = localDayKey(r.time, tz)
      groups.set(k, [...(groups.get(k) ?? []), r])
    }
    return [...groups.entries()]
  }, [data.readings, from, equipmentId, tz])

  const chip = (active: boolean) =>
    `min-h-12 rounded-full border px-4 text-[15px] font-semibold transition-colors active:bg-pressed ${
      active ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-elevated text-fg'
    }`

  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Historique des relevés</h1>
      <p className="mt-1 mb-5 text-[16px] text-fg-muted">Aujourd’hui et les {HISTORY_DAYS} derniers jours. Une erreur se corrige, elle ne s’efface pas.</p>

      <div role="group" aria-label="Filtrer par enceinte" className="mb-6 flex flex-wrap gap-2">
        <button type="button" className={chip(equipmentId === null)} aria-pressed={equipmentId === null} onClick={() => onFilter(null)}>
          Toutes
        </button>
        {data.enclosures.map((e) => (
          <button key={e.id} type="button" className={chip(equipmentId === e.id)} aria-pressed={equipmentId === e.id} onClick={() => onFilter(e.id)}>
            {e.name}
          </button>
        ))}
      </div>

      {days.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-5 text-[17px] text-fg-muted shadow-card">Aucun relevé sur cette période.</p>
      ) : (
        days.map(([key, readings]) => (
          <section key={key} aria-label={dayLabel(readings[0].time, now, tz)} className="mb-7">
            <h2 className="mb-3 text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">{dayLabel(readings[0].time, now, tz)}</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              {readings.map((r) => (
                <ReadingRow
                  key={r.id}
                  reading={r}
                  tz={tz}
                  showEquipment={equipmentId === null}
                  equipmentName={equipmentName(r.equipmentId)}
                  author={author}
                  onCorrect={() => onCorrect(r)}
                  onCorrectiveAction={() => onCorrectiveAction(r)}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  )
}

function ReadingRow(props: {
  reading: Reading
  tz: string
  showEquipment: boolean
  equipmentName: string
  author: (id: string) => string
  onCorrect: () => void
  onCorrectiveAction: () => void
}) {
  const { reading: r, tz, author } = props
  const previous = r.versions.slice(0, -1)
  const corrections = r.versions.slice(1)
  const synced = [...r.versions.map((v) => v.record), ...r.correctiveActions].every((x) => !!x.server_time)

  return (
    <li className="px-4 py-4 sm:px-5" aria-label={`Relevé de ${formatTime(r.time, tz)}${props.showEquipment ? `, ${props.equipmentName}` : ''}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="w-16 shrink-0 pt-1 text-[17px] font-semibold text-fg tabular-nums">{formatTime(r.time, tz)}</div>
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {previous.map((v) => (
              <s key={v.record.id} className="text-[19px] text-fg-subtle tabular-nums" aria-label={`Valeur d’origine ${formatTemperature(v.value_c)}, corrigée`}>
                {formatTemperature(v.value_c)}
              </s>
            ))}
            <span className="text-[24px] leading-tight font-semibold text-fg tabular-nums">{formatTemperature(r.value_c)}</span>
            <ConformityBadge inRange={r.in_range} />
          </div>
          <div className="mt-1 text-[15px] text-fg-muted">
            {props.showEquipment && <span className="font-medium text-fg">{props.equipmentName} · </span>}
            par {author(r.authorId)}
          </div>

          {corrections.map((c) => (
            <p key={c.record.id} className="mt-2 flex items-start gap-2 text-[15px] text-fg">
              <IconEdit size={16} className="mt-0.5 shrink-0 text-fg-subtle" />
              <span>
                Corrigé {formatTime(c.record.device_time, tz)} par {author(c.record.author_id)} : {formatTemperature(c.value_c)}
                {c.reason ? <span className="text-fg-muted"> — motif : {c.reason}</span> : null}
              </span>
            </p>
          ))}

          {r.correctiveActions.map((a) => {
            const p = asCorrectiveAction(a.payload)
            return (
              <p key={a.id} className="mt-2 flex items-start gap-2 text-[15px] text-fg">
                <IconCheck size={16} strokeWidth={2.25} className="mt-0.5 shrink-0 text-ok" />
                <span>
                  Action corrective : <span className="font-semibold">{correctiveActionLabel(p?.action)}</span>
                  {p?.comment ? <span className="text-fg-muted"> — {p.comment}</span> : null}
                  <span className="text-fg-subtle">
                    {' '}
                    ({formatTime(a.device_time, tz)}, {author(a.author_id)})
                  </span>
                </span>
              </p>
            )
          })}

          {r.missingAction && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[15px] font-semibold text-danger">
                <IconError size={18} className="shrink-0" />
                Action corrective manquante
              </span>
              <Button variant="danger" onClick={props.onCorrectiveAction}>
                Faire l’action corrective
              </Button>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2.5 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
          {synced ? (
            <Badge tone="ok">
              <IconCheck size={14} strokeWidth={2.5} />
              Synchronisé
            </Badge>
          ) : (
            <Badge tone="warn">
              <IconSyncPending size={14} strokeWidth={2.25} />
              En attente
            </Badge>
          )}
          <Button variant="secondary" onClick={props.onCorrect} icon={<IconEdit size={18} />} aria-label={`Corriger le relevé de ${formatTime(r.time, tz)}`}>
            Corriger
          </Button>
        </div>
      </div>
    </li>
  )
}
