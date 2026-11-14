import { useState } from 'react'
import type { TemperatureCheckPayload } from '../../../../shared/payloads.ts'
import type { Equipment, HaccpRecord } from '../../../../shared/types.ts'
import { LIMITS, validatePayload } from '../../../../shared/validation.ts'
import { Button, Notice, TemperatureInput, TextField, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { IconCheck } from '../../ui/icons.tsx'
import { describeThreshold, formatTemperature, isInRange } from '../../ui/temperature.ts'
import { whenLabel } from './format.ts'
import type { Reading } from './readings.ts'
import { enclosureThreshold, type TemperatureData } from './useTemperatureData.ts'

const QUICK_REASONS = ['Erreur de frappe', 'Valeur mal lue sur le thermomètre'] as const

interface Props {
  reading: Reading
  equipment: Equipment | undefined
  data: TemperatureData
  now: Date
  onSaved: (record: HaccpRecord, replacement: TemperatureCheckPayload) => void
  onCancel: () => void
}

/**
 * Correction d'une erreur de saisie : nouvel enregistrement `correction` (motif + payload complet),
 * qui vise la dernière version du relevé. L'original n'est jamais modifié.
 */
export function CorrectionView({ reading, equipment, data, now, onSaved, onCancel }: Props) {
  const core = useCore()
  const toast = useToast()
  const [value, setValue] = useState<number | null>(reading.value_c)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = equipment?.name ?? 'Enceinte retirée'
  const threshold = equipment ? enclosureThreshold(equipment, data.thresholds) : { min_c: null, max_c: null, isDefault: true }
  const author = data.staff.find((s) => s.id === reading.authorId)?.display_name ?? 'Ancien membre'

  const unchanged = value === reading.value_c
  const canSave = value !== null && !unchanged && reason.trim() !== '' && !busy

  const save = async () => {
    if (value === null) return
    const replacement: TemperatureCheckPayload = { equipment_id: reading.equipmentId, value_c: value, source: reading.source, in_range: isInRange(value, threshold) }
    const payload = { reason: reason.trim(), replacement }
    const check = validatePayload('correction', payload, { supersededType: 'temperature_check' })
    if (!check.ok) {
      setError(`Saisie refusée : ${check.detail}`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const rec = await core.addRecord('correction', { reason: payload.reason, replacement: { ...replacement } }, { supersedes_id: reading.latest.id })
      toast('Correction enregistrée', 'ok')
      onSaved(rec, replacement)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:gap-10 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Corriger un relevé</h1>
        <div className="mt-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
          <p className="text-[17px] font-semibold text-fg">{name}</p>
          <p className="mt-0.5 text-[15px] text-fg-muted">
            Relevé {whenLabel(reading.time, now, data.timeZone)} par {author} · <span className="whitespace-nowrap">seuil {describeThreshold(threshold)}</span>
          </p>
          <p className="mt-2 text-[16px] text-fg">
            Valeur enregistrée : <span className="font-semibold tabular-nums">{formatTemperature(reading.value_c)}</span>
          </p>
        </div>

        <TextField
          className="mt-5"
          label="Motif de la correction (obligatoire)"
          value={reason}
          onChange={(v) => setReason(v)}
          maxLength={LIMITS.reasonMax}
          autoCapitalize="sentences"
          below={
            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK_REASONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setReason(q)}
                  aria-pressed={reason === q}
                  className={`min-h-11 rounded-full border px-4 text-[15px] font-medium active:bg-pressed ${
                    reason === q ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-elevated text-fg'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          }
        />
        <div className="mt-5">
          <Notice tone="info">Le relevé d’origine reste visible, barré, dans l’historique. Rien n’est supprimé du registre.</Notice>
        </div>
      </div>

      <div className="min-w-0">
        <TemperatureInput label="Valeur correcte" value={value} onChange={setValue} threshold={threshold} />
        {error && (
          <div className="mt-4 max-w-sm">
            <Notice>{error}</Notice>
          </div>
        )}
        <div className="sticky bottom-0 z-10 -mx-4 mt-3 flex max-w-[calc(24rem+2rem)] flex-col gap-2 bg-canvas/95 px-4 pt-2 pb-3 backdrop-blur-sm">
          <Button size="lg" block onClick={save} disabled={!canSave} icon={<IconCheck size={22} strokeWidth={2.25} />}>
            {busy ? 'Enregistrement…' : 'Enregistrer la correction'}
          </Button>
          {unchanged && value !== null && <p className="text-[14px] text-fg-subtle">Saisissez la valeur correcte : elle doit différer de la valeur enregistrée.</p>}
          <Button variant="ghost" block onClick={onCancel}>
            Annuler
          </Button>
        </div>
      </div>
    </div>
  )
}
