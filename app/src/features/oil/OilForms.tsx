// Saisies du module Huiles : contrôle des composés polaires, changement d'huile, et leurs corrections.
import { useState } from 'react'
import type { OilChangePayload, OilCheckPayload } from '../../../../shared/payloads.ts'
import type { Equipment, HaccpRecord } from '../../../../shared/types.ts'
import { LIMITS } from '../../../../shared/validation.ts'
import { Button, Notice, NumberPad, useToast } from '../../ui/components/index.ts'
import { formatDateTime } from '../../ui/format.ts'
import { IconCheck, IconFryer, IconGauge, IconOilChange, IconStrip } from '../../ui/icons.tsx'
import { EntryLayout, ErrorNotice, ReasonField, StickyActions, useRecordSaver } from '../processes/common.tsx'
import { TextArea } from '../cleaning/parts.tsx'
import { formatPercent, isOilInRange, METHOD_LABELS, METHOD_ORDER, oilLevel, POLAR_RULES, type OilChangeEntry, type OilCheckEntry, type OilLimits, type OilMethod } from './model.ts'
import { LevelLabel, OilGauge } from './OilGauge.tsx'

const METHOD_ICONS = { tester: IconGauge, strip: IconStrip } as const
const LAST_METHOD_KEY = 'haccp.oil.method'

function lastMethod(): OilMethod {
  try {
    return localStorage.getItem(LAST_METHOD_KEY) === 'strip' ? 'strip' : 'tester'
  } catch {
    return 'tester'
  }
}

function Heading({ title, subtitle, icon }: { title: string; subtitle: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        {icon}
      </span>
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">{title}</h1>
        <p className="mt-0.5 text-[16px] text-fg-muted">{subtitle}</p>
      </div>
    </div>
  )
}

/** Contrôle (ou correction d'un contrôle) : % de composés polaires + méthode, jauge en direct. */
export function OilCheckForm(props: {
  vat: Equipment
  limits: OilLimits
  timeZone: string
  correcting?: OilCheckEntry
  onSaved: (rec: HaccpRecord, payload: OilCheckPayload) => void
  onCancel: () => void
}) {
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const c = props.correcting
  const [value, setValue] = useState<number | null>(c ? c.payload.polar_percent : null)
  const [method, setMethod] = useState<OilMethod>(c ? c.payload.method : lastMethod)
  const [reason, setReason] = useState('')
  const level = value === null ? null : oilLevel(value, props.limits)
  const unchanged = c ? value === c.payload.polar_percent && method === c.payload.method : false
  const canSave = value !== null && !busy && (!c || (reason.trim() !== '' && !unchanged))

  const submit = async () => {
    if (value === null) return
    const payload: OilCheckPayload = { equipment_id: props.vat.id, polar_percent: value, method, in_range: isOilInRange(value, props.limits) }
    const rec = c
      ? await save('correction', { reason: reason.trim(), replacement: { ...payload } }, { supersedes_id: c.latest.id, ctx: { supersededType: 'oil_check' } })
      : await save('oil_check', { ...payload })
    if (!rec) return
    try {
      localStorage.setItem(LAST_METHOD_KEY, method)
    } catch {
      /* sans importance */
    }
    toast(c ? 'Correction enregistrée' : `Contrôle enregistré : ${props.vat.name}, ${formatPercent(value)}`, payload.in_range ? 'ok' : 'error')
    props.onSaved(rec, payload)
  }

  return (
    <EntryLayout
      left={
        <>
          <Heading title={c ? 'Corriger un contrôle' : `Contrôle — ${props.vat.name}`} subtitle="Composés polaires de l’huile de friture" icon={<IconGauge size={24} />} />
          {c && (
            <div className="mt-5 rounded-2xl border border-line bg-surface p-4 shadow-card">
              <p className="text-[16px] text-fg">
                {props.vat.name} · contrôle du {formatDateTime(c.time, props.timeZone)} : <span className="font-semibold tabular-nums">{formatPercent(c.payload.polar_percent)}</span> ({METHOD_LABELS[c.payload.method].toLowerCase()})
              </p>
            </div>
          )}
          <div role="radiogroup" aria-label="Méthode de mesure" className="mt-6">
            <p className="mb-2 text-[15px] font-semibold text-fg">Méthode de mesure</p>
            <div className="grid gap-3 sm:grid-cols-2">
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
          </div>
          <div className="mt-7 rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[15px] font-semibold text-fg">Résultat</p>
              <p className="text-[14px] text-fg-muted">
                Alerte {formatPercent(props.limits.warn)} · limite {formatPercent(props.limits.max)}
              </p>
            </div>
            <OilGauge value={value} limits={props.limits} label={`Composés polaires — ${props.vat.name}`} />
            <p className="mt-3 min-h-7 text-[16px]">
              {level === null ? (
                <span className="text-fg-subtle">Saisissez la valeur lue sur le testeur ou la bandelette.</span>
              ) : level === 'out' ? (
                <span className="text-fg">
                  <LevelLabel level="out" /> — au-delà de {formatPercent(props.limits.max)} : l’huile doit être changée (action corrective obligatoire).
                </span>
              ) : level === 'warn' ? (
                <span className="text-fg">
                  <LevelLabel level="warn" /> — prévoir le changement d’huile prochainement.
                </span>
              ) : (
                <LevelLabel level="ok" />
              )}
            </p>
          </div>
          {c && (
            <div className="mt-6 space-y-5">
              <ReasonField value={reason} onChange={setReason} quick={['Erreur de frappe', 'Valeur mal lue sur le testeur']} />
              <Notice tone="info">L’enregistrement d’origine reste visible, barré, dans l’historique. Rien n’est supprimé du registre.</Notice>
            </div>
          )}
        </>
      }
      right={
        <div>
          <NumberPad
            value={value}
            onChange={setValue}
            label="Composés polaires"
            unit="%"
            unitSpoken="pour cent"
            min={POLAR_RULES.min}
            max={POLAR_RULES.max}
            decimals={POLAR_RULES.decimals}
            tone={level === 'out' ? 'danger' : level === 'warn' ? 'warn' : level === 'ok' ? 'ok' : undefined}
            status={
              level === null ? (
                <p className="px-1 py-2.5 text-[15px] text-fg-muted">
                  Limite : {formatPercent(props.limits.max)} · alerte : {formatPercent(props.limits.warn)}
                </p>
              ) : (
                <p className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[16px] ${level === 'out' ? 'bg-danger-soft' : level === 'warn' ? 'bg-warn-soft' : 'bg-ok-soft'}`}>
                  <LevelLabel level={level} />
                  <span className="text-fg-muted">· limite {formatPercent(props.limits.max)}</span>
                </p>
              )
            }
            autoFocus
          />
          <ErrorNotice error={error} />
          <StickyActions>
            <Button size="lg" block onClick={submit} disabled={!canSave} icon={<IconCheck size={22} strokeWidth={2.25} />}>
              {busy ? 'Enregistrement…' : c ? 'Enregistrer la correction' : 'Enregistrer le contrôle'}
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

/** Changement d'huile (ou correction de son commentaire). */
export function OilChangeForm(props: {
  vat: Equipment
  timeZone: string
  correcting?: OilChangeEntry
  onSaved: (rec: HaccpRecord, payload: OilChangePayload) => void
  onCancel: () => void
}) {
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const c = props.correcting
  const [comment, setComment] = useState(c?.payload.comment ?? '')
  const [reason, setReason] = useState('')
  const unchanged = c ? comment.trim() === (c.payload.comment ?? '') : false
  const canSave = !busy && (!c || (reason.trim() !== '' && !unchanged))

  const submit = async () => {
    const payload: OilChangePayload = { equipment_id: props.vat.id }
    if (comment.trim()) payload.comment = comment.trim()
    const rec = c
      ? await save('correction', { reason: reason.trim(), replacement: { ...payload } }, { supersedes_id: c.latest.id, ctx: { supersededType: 'oil_change' } })
      : await save('oil_change', { ...payload })
    if (!rec) return
    toast(c ? 'Correction enregistrée' : `Changement d’huile enregistré : ${props.vat.name}`, 'ok')
    props.onSaved(rec, payload)
  }

  return (
    <EntryLayout
      left={
        <>
          <Heading title={c ? 'Corriger un changement d’huile' : `Changement d’huile — ${props.vat.name}`} subtitle="Vidange et remplissage en huile neuve" icon={<IconOilChange size={24} />} />
          <div className="mt-6 rounded-2xl border border-line bg-surface p-4 text-[16px] leading-relaxed text-fg shadow-card sm:p-5">
            {c ? (
              <p>
                Changement enregistré le {formatDateTime(c.time, props.timeZone)} pour <span className="font-semibold">{props.vat.name}</span>.
              </p>
            ) : (
              <p className="flex items-start gap-3">
                <IconFryer size={22} className="mt-0.5 shrink-0 text-accent" />
                <span>
                  Enregistrez le changement une fois le bac vidangé, nettoyé et rempli d’huile neuve. Les prochains contrôles de <span className="font-semibold">{props.vat.name}</span> repartiront de ce
                  changement.
                </span>
              </p>
            )}
          </div>
          {c && (
            <div className="mt-6 space-y-5">
              <ReasonField value={reason} onChange={setReason} quick={['Commentaire à compléter', 'Erreur de saisie']} />
              <Notice tone="info">L’enregistrement d’origine reste visible, barré, dans l’historique. Rien n’est supprimé du registre.</Notice>
            </div>
          )}
        </>
      }
      right={
        <div className="space-y-6">
          <TextArea label="Commentaire (facultatif)" hint="Type d’huile, quantité, nettoyage du bac…" value={comment} onChange={setComment} maxLength={LIMITS.oilCommentMax} />
          <ErrorNotice error={error} />
          <StickyActions>
            <Button size="lg" block onClick={submit} disabled={!canSave} icon={<IconCheck size={22} strokeWidth={2.25} />}>
              {busy ? 'Enregistrement…' : c ? 'Enregistrer la correction' : 'Enregistrer le changement'}
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
