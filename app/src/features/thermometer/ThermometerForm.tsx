// Saisie d'une vérification de thermomètre (ou correction d'une vérification).
import { useState } from 'react'
import type { ThermometerCheckPayload } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { LIMITS } from '../../../../shared/validation.ts'
import { Button, Notice, TemperatureInput, TextField, useToast } from '../../ui/components/index.ts'
import { formatDateTime } from '../../ui/format.ts'
import { IconCheck, IconFlame, IconSnowflake, IconTemperature, IconThermometerCheck } from '../../ui/icons.tsx'
import { formatTemperature } from '../../ui/temperature.ts'
import { TextArea } from '../cleaning/parts.tsx'
import { EntryLayout, ErrorNotice, ReasonField, StickyActions, chipClass, useRecordSaver } from '../processes/common.tsx'
import {
  DEFAULT_THERMOMETER_NAME,
  FIXED_REFERENCE,
  METHOD_HINTS,
  METHOD_LABELS,
  METHOD_ORDER,
  deviation,
  formatDeviation,
  formatTolerance,
  makeCheckPayload,
  type ThermometerCheckEntry,
  type ThermometerMethod,
  type ThermometerRules,
} from './model.ts'

const METHOD_ICONS = { ice_water: IconSnowflake, boiling_water: IconFlame, reference: IconTemperature } as const
const round1 = (v: number) => Math.round(v * 10) / 10

/** « 21,5 » / « 21.5 » / « -0,3 » → nombre à une décimale, ou null. */
export function parseReference(text: string): number | null {
  const t = text.trim().replace(',', '.').replace('−', '-')
  if (!/^-?\d{1,3}(\.\d)?$/.test(t)) return null
  const v = Number(t)
  return v >= LIMITS.thermometerReferenceMinC && v <= LIMITS.thermometerReferenceMaxC ? v : null
}

export function ThermometerCheckForm(props: {
  rules: ThermometerRules
  timeZone: string
  /** Noms déjà utilisés (suggestions). */
  names: readonly string[]
  /** Thermomètre choisi depuis l'écran d'accueil du module. */
  initialName?: string
  correcting?: ThermometerCheckEntry
  onSaved: (rec: HaccpRecord, payload: ThermometerCheckPayload) => void
  onCancel: () => void
}) {
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const c = props.correcting
  const [name, setName] = useState(c?.payload.thermometer ?? props.initialName ?? (props.names.length === 1 ? props.names[0] : props.names.length ? '' : DEFAULT_THERMOMETER_NAME))
  const [method, setMethod] = useState<ThermometerMethod>(c?.payload.method ?? 'ice_water')
  const [refText, setRefText] = useState(c && c.payload.method === 'reference' ? String(c.payload.reference_c).replace('.', ',') : '')
  const [measured, setMeasured] = useState<number | null>(c ? c.payload.measured_c : null)
  const [comment, setComment] = useState(c?.payload.comment ?? '')
  const [reason, setReason] = useState('')
  // Une correction garde l'écart admis enregistré à l'origine (la règle du jour du contrôle).
  const tolerance = c ? c.payload.tolerance_c : props.rules.tolerance

  const reference = FIXED_REFERENCE[method] ?? parseReference(refText)
  const measuredOk = measured !== null && measured >= LIMITS.thermometerMeasuredMinC && measured <= LIMITS.thermometerMeasuredMaxC
  const payload =
    reference !== null && measured !== null && measuredOk && name.trim()
      ? makeCheckPayload({ thermometer: name, method, reference, measured, tolerance, comment })
      : null
  const unchanged =
    c && payload
      ? payload.thermometer === c.payload.thermometer &&
        payload.method === c.payload.method &&
        payload.reference_c === c.payload.reference_c &&
        payload.measured_c === c.payload.measured_c &&
        (payload.comment ?? '') === (c.payload.comment ?? '')
      : false
  const canSave = payload !== null && !busy && (!c || (reason.trim() !== '' && !unchanged))
  const threshold = reference === null ? undefined : { min_c: round1(reference - tolerance), max_c: round1(reference + tolerance) }

  const submit = async () => {
    if (!payload) return
    const rec = c
      ? await save('correction', { reason: reason.trim(), replacement: { ...payload } }, { supersedes_id: c.latest.id, ctx: { supersededType: 'thermometer_check' } })
      : await save('thermometer_check', { ...payload })
    if (!rec) return
    toast(c ? 'Correction enregistrée' : `Vérification enregistrée : ${payload.thermometer}, ${payload.in_range ? 'conforme' : 'hors tolérance'}`, payload.in_range ? 'ok' : 'error')
    props.onSaved(rec, payload)
  }

  const nameSuggestions = props.names.filter((n) => n !== name.trim())

  return (
    <EntryLayout
      left={
        <>
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <IconThermometerCheck size={24} />
            </span>
            <div className="min-w-0">
              <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">{c ? 'Corriger une vérification' : 'Vérifier un thermomètre'}</h1>
              <p className="mt-0.5 text-[16px] text-fg-muted">Écart admis {formatTolerance(tolerance)}</p>
            </div>
          </div>
          {c && (
            <div className="mt-5 rounded-2xl border border-line bg-surface p-4 shadow-card">
              <p className="text-[16px] text-fg">
                {c.payload.thermometer} · vérification du {formatDateTime(c.time, props.timeZone)} : lu <span className="font-semibold tabular-nums">{formatTemperature(c.payload.measured_c)}</span> pour{' '}
                {formatTemperature(c.payload.reference_c)} attendu
              </p>
            </div>
          )}
          <div className="mt-6">
            <TextField
              label="Thermomètre vérifié"
              hint="Nom de la sonde, toujours le même (ex. « Sonde cuisine »)."
              value={name}
              onChange={setName}
              maxLength={LIMITS.thermometerNameMax}
              autoCapitalize="sentences"
              below={
                nameSuggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {nameSuggestions.map((n) => (
                      <button key={n} type="button" onClick={() => setName(n)} className={chipClass(false)}>
                        {n}
                      </button>
                    ))}
                  </div>
                )
              }
            />
          </div>
          <div role="radiogroup" aria-label="Méthode de vérification" className="mt-6">
            <p className="mb-2 text-[15px] font-semibold text-fg">Méthode</p>
            <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
              {METHOD_ORDER.map((m) => {
                const Icon = METHOD_ICONS[m]
                const on = method === m
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setMethod(m)}
                    className={`flex min-h-16 items-center gap-3 rounded-2xl border-2 px-4 text-left text-[17px] font-semibold transition-colors active:bg-pressed ${on ? 'border-accent bg-accent-soft text-fg' : 'border-line bg-surface text-fg'}`}
                  >
                    <Icon size={22} className={on ? 'text-accent' : 'text-fg-muted'} />
                    {METHOD_LABELS[m]}
                    {on && <IconCheck size={20} strokeWidth={2.5} className="ml-auto text-accent" />}
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-[15px] text-fg-muted">{METHOD_HINTS[method]}</p>
          </div>
          {method === 'reference' && (
            <div className="mt-5 max-w-xs">
              <TextField
                label="Valeur du thermomètre de référence (°C)"
                value={refText}
                onChange={setRefText}
                inputMode="decimal"
                placeholder="ex. 21,5"
                error={refText.trim() && parseReference(refText) === null ? `Nombre entre ${LIMITS.thermometerReferenceMinC} et ${LIMITS.thermometerReferenceMaxC} °C, une décimale au plus.` : undefined}
              />
            </div>
          )}
          <div className="mt-6 rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
            <p className="text-[15px] font-semibold text-fg">Résultat</p>
            <p className="mt-2 min-h-7 text-[16px]">
              {payload === null ? (
                <span className="text-fg-subtle">
                  {reference === null ? 'Indiquez la valeur du thermomètre de référence.' : `Saisissez la valeur lue sur le thermomètre (attendu : ${formatTemperature(reference)}).`}
                </span>
              ) : payload.in_range ? (
                <span className="font-semibold text-ok">
                  Conforme — écart {formatDeviation(deviation(payload.measured_c, payload.reference_c))} (admis {formatTolerance(tolerance)})
                </span>
              ) : (
                <span className="text-fg">
                  <span className="font-semibold text-danger">Hors tolérance</span> — écart {formatDeviation(deviation(payload.measured_c, payload.reference_c))}, admis {formatTolerance(tolerance)}. Ne plus utiliser ce
                  thermomètre avant de l’avoir réglé ou remplacé (action corrective obligatoire).
                </span>
              )}
            </p>
          </div>
          {c && (
            <div className="mt-6 space-y-5">
              <ReasonField value={reason} onChange={setReason} quick={['Erreur de frappe', 'Mauvais thermomètre choisi']} />
              <Notice tone="info">L’enregistrement d’origine reste visible, barré, dans l’historique. Rien n’est supprimé du registre.</Notice>
            </div>
          )}
        </>
      }
      right={
        <div className="space-y-5">
          <TemperatureInput label="Valeur lue sur le thermomètre vérifié" value={measured} onChange={setMeasured} threshold={threshold} autoFocus />
          {measured !== null && !measuredOk && (
            <Notice>
              Valeur hors des bornes possibles ({LIMITS.thermometerMeasuredMinC} à {LIMITS.thermometerMeasuredMaxC} °C).
            </Notice>
          )}
          <TextArea label="Commentaire (facultatif)" hint="Réglage fait, pile changée…" value={comment} onChange={setComment} maxLength={LIMITS.thermometerCommentMax} rows={2} />
          <ErrorNotice error={error} />
          <StickyActions>
            <Button size="lg" block onClick={submit} disabled={!canSave} icon={<IconCheck size={22} strokeWidth={2.25} />}>
              {busy ? 'Enregistrement…' : c ? 'Enregistrer la correction' : 'Enregistrer la vérification'}
            </Button>
            <Button variant="ghost" block onClick={props.onCancel}>
              Annuler
            </Button>
          </StickyActions>
        </div>
      }
    />
  )
}
