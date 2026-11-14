import { useState } from 'react'
import type { TemperatureCheckPayload } from '../../../../shared/payloads.ts'
import type { Equipment, HaccpRecord } from '../../../../shared/types.ts'
import { validatePayload } from '../../../../shared/validation.ts'
import { Button, Notice, TemperatureInput, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { IconCheck } from '../../ui/icons.tsx'
import { describeThreshold, formatTemperature, isInRange } from '../../ui/temperature.ts'
import { ConformityBadge, EnclosureIcon } from './EnclosureList.tsx'
import { whenLabel } from './format.ts'
import type { EnclosureStatus } from './schedule.ts'
import { enclosureThreshold, type TemperatureData } from './useTemperatureData.ts'
import { formatTime } from '../../ui/format.ts'

interface Props {
  equipment: Equipment
  status: EnclosureStatus | undefined
  data: TemperatureData
  now: Date
  /** Relevé enregistré : `in_range` false → l'appelant enchaîne sur l'action corrective. */
  onSaved: (record: HaccpRecord, payload: TemperatureCheckPayload) => void
}

/** Saisie du relevé d'une enceinte. */
export function ReadingEntry({ equipment, status, data, now, onSaved }: Props) {
  const core = useCore()
  const toast = useToast()
  const [value, setValue] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const threshold = enclosureThreshold(equipment, data.thresholds)
  const last = status?.last ?? null

  const save = async () => {
    if (value === null) return
    const payload: TemperatureCheckPayload = { equipment_id: equipment.id, value_c: value, source: 'manual', in_range: isInRange(value, threshold) }
    const check = validatePayload('temperature_check', payload)
    if (!check.ok) {
      setError(`Saisie refusée : ${check.detail}`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const rec = await core.addRecord('temperature_check', { ...payload })
      if (payload.in_range) toast(`Relevé enregistré : ${equipment.name}, ${formatTemperature(value)}`, 'ok')
      onSaved(rec, payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:gap-10 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <EnclosureIcon kind={equipment.kind} size={24} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">{equipment.name}</h1>
            <p className="text-[16px] text-fg-muted">
              Seuil {describeThreshold(threshold)}
              {threshold.isDefault ? ' (par défaut, à définir dans Gestion)' : ''}
            </p>
          </div>
        </div>

        <dl className="mt-5 hidden gap-3 md:grid">
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <dt className="text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">Dernier relevé</dt>
            <dd className="mt-1.5">
              {last ? (
                <>
                  <span className="flex flex-wrap items-center gap-3">
                    <span className="text-[26px] font-semibold text-fg tabular-nums">{formatTemperature(last.value_c)}</span>
                    <ConformityBadge inRange={last.in_range} />
                  </span>
                  <span className="mt-1 block text-[15px] text-fg-muted">{whenLabel(last.time, now, data.timeZone)}</span>
                </>
              ) : (
                <span className="text-[16px] text-fg-muted">Aucun relevé sur 7 jours</span>
              )}
            </dd>
          </div>
          {status?.slot && (
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <dt className="text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">Créneau en cours</dt>
              <dd className="mt-1.5 text-[16px] text-fg">
                {formatTime(status.slot, data.timeZone)} · {status.state === 'due' ? 'relevé à faire' : 'relevé déjà fait, un nouveau relevé reste possible'}
              </dd>
            </div>
          )}
        </dl>
        <p className="mt-5 hidden max-w-md text-[15px] text-fg-subtle md:block">
          Lisez le thermomètre de l’enceinte, porte fermée, puis saisissez la valeur. Hors seuil, une action corrective sera demandée.
        </p>
      </div>

      <div className="min-w-0">
        <TemperatureInput label={`Température relevée — ${equipment.name}`} value={value} onChange={setValue} threshold={threshold} autoFocus />
        {error && (
          <div className="mt-4 max-w-sm">
            <Notice>{error}</Notice>
          </div>
        )}
        <div className="sticky bottom-0 z-10 -mx-4 mt-3 max-w-[calc(24rem+2rem)] bg-canvas/95 px-4 pt-2 pb-3 backdrop-blur-sm">
          <Button size="lg" block onClick={save} disabled={value === null || busy} icon={<IconCheck size={22} strokeWidth={2.25} />}>
            {busy ? 'Enregistrement…' : 'Enregistrer le relevé'}
          </Button>
        </div>
      </div>
    </div>
  )
}
