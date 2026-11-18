// Briques d'interface communes aux procédés (refroidissement, remise en température, cuisson, décongélation).
import { useState, type ReactNode } from 'react'
import type { HaccpRecord, RecordType } from '../../../../shared/types.ts'
import { LIMITS, validatePayload, type PayloadContext } from '../../../../shared/validation.ts'
import { Badge, Button, Notice, TextField } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { formatTime } from '../../ui/format.ts'
import { IconCheck, IconChevronLeft, IconEdit, IconError, IconOk, IconSyncPending, IconWarn } from '../../ui/icons.tsx'
import { correctiveActionLabel } from '../corrective-action/actions.ts'
import { asCorrectiveAction } from '../temperatures/readings.ts'
import type { Entry } from './entries.ts'
import type { Urgency } from './timing.ts'

export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" onClick={onClick} icon={<IconChevronLeft size={22} />} className="-ml-3 mb-2 px-3 text-accent">
      {label}
    </Button>
  )
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[16px] text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  )
}

export function SectionLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mb-3 text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
      {children}
    </h2>
  )
}

export function EmptyCard({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-line bg-surface p-5 text-[17px] text-fg-muted shadow-card">{children}</p>
}

/** Résultat d'une mesure ou d'un lot : icône + texte, jamais la couleur seule. */
export function ResultBadge({ ok, okLabel = 'Conforme', koLabel = 'Hors seuil' }: { ok: boolean; okLabel?: string; koLabel?: string }) {
  return ok ? (
    <Badge tone="ok">
      <IconOk size={14} strokeWidth={2.25} />
      {okLabel}
    </Badge>
  ) : (
    <Badge tone="error">
      <IconWarn size={14} strokeWidth={2.25} />
      {koLabel}
    </Badge>
  )
}

export function SyncBadge({ records }: { records: readonly HaccpRecord[] }) {
  return records.every((r) => !!r.server_time) ? (
    <Badge tone="ok">
      <IconCheck size={14} strokeWidth={2.5} />
      Synchronisé
    </Badge>
  ) : (
    <Badge tone="warn">
      <IconSyncPending size={14} strokeWidth={2.25} />
      En attente
    </Badge>
  )
}

/** Tous les enregistrements d'une entrée (origine, corrections, actions). */
export function entryRecords(e: Entry<unknown>): HaccpRecord[] {
  return [...e.versions.map((v) => v.record), ...e.correctiveActions]
}

export const chipClass = (active: boolean) =>
  `min-h-12 rounded-full border px-4 text-[15px] font-semibold transition-colors active:bg-pressed ${
    active ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-elevated text-fg'
  }`

/** Produit : champ texte + suggestions (produits récents) en grosses pastilles. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').trim()

/** Produits du catalogue (Gestion) qui contiennent le texte tapé, accents et majuscules ignorés. */
export function matchCatalog(catalog: readonly string[], query: string, max = 8): string[] {
  const q = fold(query)
  if (!q) return []
  const starts: string[] = []
  const contains: string[] = []
  for (const name of catalog) {
    const n = fold(name)
    if (n === q) return []
    if (n.startsWith(q)) starts.push(name)
    else if (n.includes(q)) contains.push(name)
  }
  return [...starts, ...contains].slice(0, max)
}

/**
 * Champ produit : saisie libre + produits récents ; avec `catalog` (produits de Gestion), propose les
 * produits qui correspondent au texte tapé et permet d'ouvrir la liste complète.
 */
export function ProductField({
  value,
  onChange,
  suggestions,
  catalog = [],
  label = 'Produit',
}: {
  value: string
  onChange: (v: string) => void
  suggestions: readonly string[]
  catalog?: readonly string[]
  label?: string
}) {
  const [showAll, setShowAll] = useState(false)
  const matches = matchCatalog(catalog, value)
  const sorted = showAll ? [...catalog].sort((a, b) => a.localeCompare(b, 'fr')) : []
  const chip = (p: string, onPick?: () => void) => (
    <button
      key={p}
      type="button"
      className={chipClass(value.trim() === p)}
      aria-pressed={value.trim() === p}
      onClick={() => {
        onChange(p)
        onPick?.()
      }}
    >
      {p}
    </button>
  )
  return (
    <TextField
      label={label}
      value={value}
      onChange={onChange}
      maxLength={LIMITS.productMax}
      autoCapitalize="sentences"
      placeholder={catalog.length ? 'Tapez les premières lettres…' : 'Nom du produit'}
      below={
        <>
          {matches.length > 0 && (
            <div role="group" aria-label="Mes produits correspondants" className="mt-2.5 flex flex-wrap gap-2">
              {matches.map((p) => chip(p))}
            </div>
          )}
          {suggestions.length > 0 && (
            <div role="group" aria-label="Produits récents" className="mt-2.5 flex flex-wrap gap-2">
              {suggestions.map((p) => chip(p))}
            </div>
          )}
          {catalog.length > 0 && (
            <div className="mt-2.5">
              <Button variant="ghost" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="-ml-3 px-3 text-accent">
                {showAll ? 'Masquer la liste de mes produits' : `Choisir dans mes produits (${catalog.length})`}
              </Button>
              {showAll && (
                <div role="group" aria-label="Tous mes produits" className="mt-2 flex max-h-80 flex-wrap gap-2 overflow-y-auto rounded-xl border border-line bg-sunken p-3">
                  {sorted.map((p) => chip(p, () => setShowAll(false)))}
                </div>
              )}
            </div>
          )}
        </>
      }
    />
  )
}

/** Barre de progression d'un délai (vert → ambre → rouge), avec libellé accessible. */
export function DeadlineBar({ progress, urgency, label }: { progress: number; urgency: Urgency; label: string }) {
  const color = urgency === 'overdue' ? 'bg-danger' : urgency === 'soon' ? 'bg-warn' : 'bg-ok'
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="h-3 w-full overflow-hidden rounded-full bg-sunken">
      <div className={`h-full rounded-full transition-[width] duration-500 ${color}`} style={{ width: `${Math.max(3, progress * 100)}%` }} />
    </div>
  )
}

/** Enregistre un payload après validation (contrat partagé) ; erreurs lisibles. */
export function useRecordSaver() {
  const core = useCore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (type: RecordType, payload: Record<string, unknown>, opts?: { supersedes_id?: string; ctx?: PayloadContext }): Promise<HaccpRecord | null> => {
    const check = validatePayload(type, payload, opts?.ctx)
    if (!check.ok) {
      setError(`Saisie refusée : ${check.detail}`)
      return null
    }
    setBusy(true)
    setError(null)
    try {
      const rec = await core.addRecord(type, structuredClone(payload), opts?.supersedes_id ? { supersedes_id: opts.supersedes_id } : undefined)
      setBusy(false)
      return rec
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
      return null
    }
  }
  return { save, busy, error, setError }
}

export function ErrorNotice({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className="mt-4 max-w-sm">
      <Notice>{error}</Notice>
    </div>
  )
}

/** Disposition « texte à gauche, saisie à droite » (iPad paysage), empilée sur iPhone. */
export function EntryLayout({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:gap-10 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0">{left}</div>
      <div className="min-w-0">{right}</div>
    </div>
  )
}

/** Barre d'action collante sous la saisie. */
export function StickyActions({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 z-10 -mx-4 mt-3 flex max-w-[calc(24rem+2rem)] flex-col gap-2 bg-canvas/95 px-4 pt-2 pb-3 backdrop-blur-sm">{children}</div>
}

const QUICK_REASONS = ['Erreur de frappe', 'Valeur mal lue sur le thermomètre'] as const

/** Motif obligatoire d'une correction, avec motifs fréquents. */
export function ReasonField({ value, onChange, quick = QUICK_REASONS }: { value: string; onChange: (v: string) => void; quick?: readonly string[] }) {
  return (
    <TextField
      label="Motif de la correction (obligatoire)"
      value={value}
      onChange={onChange}
      maxLength={LIMITS.reasonMax}
      autoCapitalize="sentences"
      below={
        <div className="mt-2 flex flex-wrap gap-2">
          {quick.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onChange(q)}
              aria-pressed={value === q}
              className={`min-h-11 rounded-full border px-4 text-[15px] font-medium active:bg-pressed ${value === q ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-elevated text-fg'}`}
            >
              {q}
            </button>
          ))}
        </div>
      }
    />
  )
}

/** Corrections et actions correctives d'une entrée (historique). */
export function EntryTrail({ entry, tz, author, describe }: { entry: Entry<unknown>; tz: string; author: (id: string) => string; describe: (payload: unknown) => string }) {
  return (
    <>
      {entry.versions.slice(1).map((c) => (
        <p key={c.record.id} className="mt-1.5 flex items-start gap-2 text-[15px] text-fg">
          <IconEdit size={16} className="mt-0.5 shrink-0 text-fg-subtle" />
          <span>
            Corrigé {formatTime(c.record.device_time, tz)} par {author(c.record.author_id)} : {describe(c.payload)}
            {c.reason ? <span className="text-fg-muted"> — motif : {c.reason}</span> : null}
          </span>
        </p>
      ))}
      {entry.correctiveActions.map((a) => {
        const p = asCorrectiveAction(a.payload)
        return (
          <p key={a.id} className="mt-1.5 flex items-start gap-2 text-[15px] text-fg">
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
    </>
  )
}

/** Mention rouge + bouton pour une action corrective manquante. */
export function MissingAction({ onClick, label = 'Faire l’action corrective' }: { onClick: () => void; label?: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <span className="inline-flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[15px] font-semibold text-danger">
        <IconError size={18} className="shrink-0" />
        Action corrective manquante
      </span>
      <Button variant="danger" onClick={onClick}>
        {label}
      </Button>
    </div>
  )
}

export function useAuthorName(staff: readonly { id: string; display_name: string }[]) {
  return (id: string) => staff.find((s) => s.id === id)?.display_name ?? 'Ancien membre'
}

