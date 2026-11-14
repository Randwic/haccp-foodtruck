// Correction d'une étape de procédé ou d'une mesure : nouvel enregistrement `correction`
// (motif obligatoire + payload complet) visant la dernière version. L'original n'est jamais modifié.
import { useState, type ReactNode } from 'react'
import type { HaccpRecord, RecordType } from '../../../../shared/types.ts'
import { Button, Notice, TemperatureInput, TextField, useToast } from '../../ui/components/index.ts'
import { IconCheck } from '../../ui/icons.tsx'
import { formatTemperature, type TemperatureThreshold } from '../../ui/temperature.ts'
import { EntryLayout, ErrorNotice, ReasonField, StickyActions, useRecordSaver } from './common.tsx'
import { formatIsoDate } from './timing.ts'

interface BaseProps<P> {
  /** Type de l'enregistrement d'origine (pour valider le remplacement). */
  type: RecordType
  /** Dernière version de la chaîne. */
  latestId: string
  /** Rappel de ce qui est corrigé (produit, étape, heure, auteur). */
  summary: ReactNode
  onSaved: (record: HaccpRecord, replacement: P) => void
  onCancel: () => void
}

function CorrectionShell({ title, summary, left, right }: { title: string; summary: ReactNode; left?: ReactNode; right: ReactNode }) {
  return (
    <EntryLayout
      left={
        <>
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">{title}</h1>
          <div className="mt-4 rounded-2xl border border-line bg-surface p-4 shadow-card">{summary}</div>
          {left}
          <div className="mt-5">
            <Notice tone="info">L’enregistrement d’origine reste visible, barré, dans l’historique. Rien n’est supprimé du registre.</Notice>
          </div>
        </>
      }
      right={right}
    />
  )
}

/** Correction d'une température (étape de lot, maintien au chaud, cuisson). */
export function TemperatureCorrection<P extends object>(
  props: BaseProps<P> & {
    value_c: number
    threshold?: TemperatureThreshold
    /** Payload de remplacement complet pour la nouvelle valeur (conformité recalculée par l'app). */
    replacementFor: (value_c: number) => P
    extra?: (value_c: number | null) => ReactNode
  },
) {
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const [value, setValue] = useState<number | null>(props.value_c)
  const [reason, setReason] = useState('')
  const unchanged = value === props.value_c
  const canSave = value !== null && !unchanged && reason.trim() !== '' && !busy

  const submit = async () => {
    if (value === null) return
    const replacement = props.replacementFor(value)
    const rec = await save('correction', { reason: reason.trim(), replacement }, { supersedes_id: props.latestId, ctx: { supersededType: props.type } })
    if (!rec) return
    toast('Correction enregistrée', 'ok')
    props.onSaved(rec, replacement)
  }

  return (
    <CorrectionShell
      title="Corriger une mesure"
      summary={
        <>
          {props.summary}
          <p className="mt-2 text-[16px] text-fg">
            Valeur enregistrée : <span className="font-semibold tabular-nums">{formatTemperature(props.value_c)}</span>
          </p>
        </>
      }
      left={
        <div className="mt-5">
          <ReasonField value={reason} onChange={setReason} />
        </div>
      }
      right={
        <>
          <TemperatureInput label="Valeur correcte" value={value} onChange={setValue} threshold={props.threshold} />
          {props.extra?.(value)}
          <ErrorNotice error={error} />
          <StickyActions>
            <Button size="lg" block onClick={submit} disabled={!canSave} icon={<IconCheck size={22} strokeWidth={2.25} />}>
              {busy ? 'Enregistrement…' : 'Enregistrer la correction'}
            </Button>
            {unchanged && value !== null && <p className="text-[14px] text-fg-subtle">Saisissez la valeur correcte : elle doit différer de la valeur enregistrée.</p>}
            <Button variant="ghost" block onClick={props.onCancel}>
              Annuler
            </Button>
          </StickyActions>
        </>
      }
    />
  )
}

/** Correction de la DLC d'une décongélation terminée. */
export function DlcCorrection<P extends object>(props: BaseProps<P> & { dlc: string; min: string; replacementFor: (dlc: string) => P }) {
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const [dlc, setDlc] = useState(props.dlc)
  const [reason, setReason] = useState('')
  const canSave = /^\d{4}-\d{2}-\d{2}$/.test(dlc) && dlc !== props.dlc && reason.trim() !== '' && !busy

  const submit = async () => {
    const replacement = props.replacementFor(dlc)
    const rec = await save('correction', { reason: reason.trim(), replacement }, { supersedes_id: props.latestId, ctx: { supersededType: props.type } })
    if (!rec) return
    toast('Correction enregistrée', 'ok')
    props.onSaved(rec, replacement)
  }

  return (
    <CorrectionShell
      title="Corriger une DLC"
      summary={
        <>
          {props.summary}
          <p className="mt-2 text-[16px] text-fg">
            DLC enregistrée : <span className="font-semibold">{formatIsoDate(props.dlc)}</span>
          </p>
        </>
      }
      right={
        <>
          <TextField label="DLC correcte" type="date" value={dlc} min={props.min} onChange={setDlc} />
          <div className="mt-5">
            <ReasonField value={reason} onChange={setReason} quick={['Erreur de date', 'DLC du PMS différente']} />
          </div>
          <ErrorNotice error={error} />
          <StickyActions>
            <Button size="lg" block onClick={submit} disabled={!canSave} icon={<IconCheck size={22} strokeWidth={2.25} />}>
              {busy ? 'Enregistrement…' : 'Enregistrer la correction'}
            </Button>
            <Button variant="ghost" block onClick={props.onCancel}>
              Annuler
            </Button>
          </StickyActions>
        </>
      }
    />
  )
}
