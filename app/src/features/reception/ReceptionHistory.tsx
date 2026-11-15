// Historique (30 jours) : réceptions par fournisseur et par date, pertes ; corrections barrées.
import { useMemo } from 'react'
import { Badge, Button } from '../../ui/components/index.ts'
import { formatTime } from '../../ui/format.ts'
import { IconBan, IconCheck, IconEdit, IconError, IconSynced, IconSyncPending, IconTruck, IconWaste } from '../../ui/icons.tsx'
import { PhotoGallery } from '../../ui/photos/Photos.tsx'
import { correctiveActionLabel } from '../corrective-action/actions.ts'
import { chipClass, EmptyCard, MissingAction, PageTitle, SectionLabel, SyncBadge, entryRecords, useAuthorName } from '../processes/common.tsx'
import { dayLabel } from '../temperatures/format.ts'
import { asCorrectiveAction } from '../temperatures/readings.ts'
import { localDayKey, plural, startOfLocalDay } from '../temperatures/schedule.ts'
import { ItemCard } from './ReceptionForm.tsx'
import { diffReception, RECEPTION_HISTORY_DAYS, supplierNameOf, WASTE_REASON_LABELS, type ReceptionEntry, type WasteEntry } from './model.ts'
import { photoCounts, type ReceptionData } from './useReceptionData.ts'

export type HistoryFilter = { tab: 'receptions'; supplierId: string | null } | { tab: 'wastes' }

interface Props {
  data: ReceptionData
  now: Date
  filter: HistoryFilter
  onFilter: (f: HistoryFilter) => void
  onCorrect: (e: ReceptionEntry) => void
  onCorrectiveAction: (e: ReceptionEntry) => void
}

function groupByDay<T extends { time: string }>(list: readonly T[], tz: string): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const e of list) {
    const k = localDayKey(e.time, tz)
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  return [...groups.entries()]
}

export function ReceptionHistory({ data, now, filter, onFilter, onCorrect, onCorrectiveAction }: Props) {
  const tz = data.timeZone
  const from = startOfLocalDay(now, tz, RECEPTION_HISTORY_DAYS).getTime()
  const author = useAuthorName(data.staff)
  const supplierName = supplierNameOf(data.suppliers)
  const recent = useMemo(() => data.receptions.filter((e) => Date.parse(e.time) >= from), [data.receptions, from])
  const usedSuppliers = useMemo(() => {
    const ids = [...new Set(recent.map((e) => e.payload.supplier_id))]
    return ids.map((id) => ({ id, name: supplierName(id) })).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  }, [recent, supplierName])

  const tabs = (
    <div role="tablist" aria-label="Historique" className="mb-5 grid max-w-md grid-cols-2 gap-1 rounded-xl bg-sunken p-1">
      {(
        [
          ['receptions', 'Approvisionnements', IconTruck],
          ['wastes', 'Pertes', IconWaste],
        ] as const
      ).map(([t, label, Icon]) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={filter.tab === t}
          onClick={() => onFilter(t === 'receptions' ? { tab: 'receptions', supplierId: null } : { tab: 'wastes' })}
          className={`flex min-h-12 items-center justify-center gap-2 rounded-lg text-[15px] font-semibold ${filter.tab === t ? 'bg-elevated text-fg shadow-card' : 'text-fg-muted active:bg-pressed'}`}
        >
          <Icon size={18} className={filter.tab === t ? 'text-accent' : ''} />
          {label}
        </button>
      ))}
    </div>
  )

  let body
  if (filter.tab === 'wastes') {
    const list = data.wastes.filter((w) => Date.parse(w.time) >= from)
    body =
      list.length === 0 ? (
        <EmptyCard>Aucune perte enregistrée sur cette période.</EmptyCard>
      ) : (
        groupByDay(list, tz).map(([key, items]) => (
          <section key={key} aria-label={dayLabel(items[0].time, now, tz)} className="mb-7">
            <SectionLabel>{dayLabel(items[0].time, now, tz)}</SectionLabel>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              {items.map((w) => (
                <WasteRow key={w.id} waste={w} data={data} author={author} supplierName={supplierName} />
              ))}
            </ul>
          </section>
        ))
      )
  } else {
    const list = recent.filter((e) => filter.supplierId === null || e.payload.supplier_id === filter.supplierId)
    body = (
      <>
        {usedSuppliers.length > 1 && (
          <div role="group" aria-label="Filtrer par fournisseur ou magasin" className="mb-6 flex flex-wrap gap-2">
            <button type="button" className={chipClass(filter.supplierId === null)} aria-pressed={filter.supplierId === null} onClick={() => onFilter({ tab: 'receptions', supplierId: null })}>
              Tous
            </button>
            {usedSuppliers.map((s) => (
              <button key={s.id} type="button" className={chipClass(filter.supplierId === s.id)} aria-pressed={filter.supplierId === s.id} onClick={() => onFilter({ tab: 'receptions', supplierId: s.id })}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        {list.length === 0 ? (
          <EmptyCard>Aucun approvisionnement sur cette période.</EmptyCard>
        ) : (
          groupByDay(list, tz).map(([key, items]) => (
            <section key={key} aria-label={dayLabel(items[0].time, now, tz)} className="mb-7">
              <SectionLabel>{dayLabel(items[0].time, now, tz)}</SectionLabel>
              <ul className="space-y-3">
                {items.map((e) => (
                  <ReceptionCard
                    key={e.id}
                    entry={e}
                    data={data}
                    author={author}
                    supplierName={supplierName}
                    onCorrect={() => onCorrect(e)}
                    onCorrectiveAction={() => onCorrectiveAction(e)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </>
    )
  }

  return (
    <>
      <PageTitle title="Historique — achats & réception" subtitle={`Les ${RECEPTION_HISTORY_DAYS} derniers jours. Une erreur se corrige, elle ne s’efface pas.`} />
      {tabs}
      {body}
    </>
  )
}

/** État d'envoi des photos d'un enregistrement. */
export function PhotoSyncLine({ paths, data }: { paths: readonly string[]; data: Pick<ReceptionData, 'photoStatus'> }) {
  if (paths.length === 0) return null
  const { pending, failed } = photoCounts(paths, data.photoStatus)
  if (failed > 0)
    return (
      <p className="flex items-center gap-1.5 text-[15px] font-semibold text-danger">
        <IconError size={16} /> {plural(failed, 'photo refusée par le serveur', 'photos refusées par le serveur')} : prévenez le gérant
      </p>
    )
  if (pending > 0)
    return (
      <p className="flex items-center gap-1.5 text-[15px] font-semibold text-warn">
        <IconSyncPending size={16} /> {plural(pending, 'photo en attente d’envoi', 'photos en attente d’envoi')}
      </p>
    )
  return (
    <p className="flex items-center gap-1.5 text-[15px] text-fg-muted">
      <IconSynced size={16} className="text-ok" /> {plural(paths.length, 'photo envoyée', 'photos envoyées')}
    </p>
  )
}

function ReceptionCard(props: {
  entry: ReceptionEntry
  data: ReceptionData
  author: (id: string) => string
  supplierName: (id: string) => string
  onCorrect: () => void
  onCorrectiveAction: () => void
}) {
  const { entry: e, data, author, supplierName } = props
  const tz = data.timeZone
  const p = e.payload
  const name = supplierName(p.supplier_id)
  const accepted = p.items.length - e.refused.length
  return (
    <li
      aria-label={`Approvisionnement de ${formatTime(e.time, tz)}, ${name}${e.refused.length ? `, ${plural(e.refused.length, 'produit refusé', 'produits refusés')}` : ''}`}
      className={`rounded-2xl border bg-surface p-4 shadow-card sm:p-5 ${e.missingAction ? 'border-danger/50' : e.refused.length ? 'border-danger/30' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="w-14 shrink-0 pt-0.5 text-[18px] font-semibold text-fg tabular-nums">{formatTime(e.time, tz)}</div>
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-[20px] leading-snug font-semibold text-fg">{name}</p>
          <p className="mt-0.5 text-[15px] text-fg-muted">
            {p.delivery_note ? `Ticket / facture ${p.delivery_note} · ` : ''}par {author(e.authorId)} · {plural(p.items.length, 'produit', 'produits')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="ok">
              <IconCheck size={14} strokeWidth={2.5} /> {accepted} accepté{accepted > 1 ? 's' : ''}
            </Badge>
            {e.refused.length > 0 && (
              <Badge tone="error">
                <IconBan size={14} /> {e.refused.length} refusé{e.refused.length > 1 ? 's' : ''}
              </Badge>
            )}
            {!p.vehicle_ok && <Badge tone="warn">Transport non conforme</Badge>}
            {!p.packaging_ok && <Badge tone="warn">Emballages abîmés</Badge>}
            {e.corrected && (
              <Badge tone="neutral">
                <IconEdit size={14} /> Corrigée
              </Badge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2.5 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
          <SyncBadge records={entryRecords(e)} />
          <Button variant="secondary" onClick={props.onCorrect} icon={<IconEdit size={18} />} aria-label={`Corriger l’approvisionnement de ${formatTime(e.time, tz)} (${name})`}>
            Corriger
          </Button>
        </div>
      </div>

      <ul className="mt-4 grid gap-2.5 lg:grid-cols-2">
        {p.items.map((it, k) => (
          <ItemCard key={k} item={it} photoStatus={data.photoStatus} />
        ))}
      </ul>

      {(p.photo_paths?.length ?? 0) > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[14px] font-semibold text-fg-muted">Ticket ou facture</p>
          <PhotoGallery paths={p.photo_paths!} label={`Ticket ou facture — ${name}`} status={data.photoStatus} />
        </div>
      )}
      {p.comment && <p className="mt-3 text-[15px] text-fg">Commentaire : {p.comment}</p>}
      <div className="mt-3">
        <PhotoSyncLine paths={e.photos} data={data} />
      </div>

      {e.versions.slice(1).map((v, k) => {
        const changes = diffReception(e.versions[k].payload, v.payload, supplierName)
        return (
          <div key={v.record.id} className="mt-3 rounded-xl bg-sunken px-3.5 py-3 text-[15px] text-fg">
            <p className="flex items-start gap-2">
              <IconEdit size={16} className="mt-0.5 shrink-0 text-fg-subtle" />
              <span>
                Corrigée {formatTime(v.record.device_time, tz)} par {author(v.record.author_id)}
                {v.reason ? <span className="text-fg-muted"> — motif : {v.reason}</span> : null}
              </span>
            </p>
            {changes.length > 0 && (
              <ul className="mt-1.5 space-y-1 pl-6">
                {changes.map((c) => (
                  <li key={c.label}>
                    <span className="text-fg-muted">{c.label} : </span>
                    <s className="text-fg-subtle" aria-label={`ancienne valeur ${c.before}`}>
                      {c.before}
                    </s>{' '}
                    <span className="font-semibold">{c.after}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
      {e.correctiveActions.map((a) => {
        const ca = asCorrectiveAction(a.payload)
        return (
          <p key={a.id} className="mt-2 flex items-start gap-2 text-[15px] text-fg">
            <IconCheck size={16} strokeWidth={2.25} className="mt-0.5 shrink-0 text-ok" />
            <span>
              Action corrective : <span className="font-semibold">{correctiveActionLabel(ca?.action)}</span>
              {ca?.comment ? <span className="text-fg-muted"> — {ca.comment}</span> : null}
              <span className="text-fg-subtle">
                {' '}
                ({formatTime(a.device_time, tz)}, {author(a.author_id)})
              </span>
            </span>
          </p>
        )
      })}
      {e.missingAction && <MissingAction onClick={props.onCorrectiveAction} />}
    </li>
  )
}

export function WasteRow({ waste: w, data, author, supplierName }: { waste: WasteEntry; data: ReceptionData; author: (id: string) => string; supplierName: (id: string) => string }) {
  const tz = data.timeZone
  const p = w.payload
  const related = p.related_record_id ? data.receptions.find((r) => r.id === p.related_record_id || r.versions.some((v) => v.record.id === p.related_record_id)) : undefined
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4 sm:px-5" aria-label={`Perte de ${formatTime(w.time, tz)}, ${p.product}`}>
      <div className="w-14 shrink-0 pt-0.5 text-[17px] font-semibold text-fg tabular-nums">{formatTime(w.time, tz)}</div>
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[18px] font-semibold text-fg">{p.product}</span>
          <Badge tone="error">{WASTE_REASON_LABELS[p.reason]}</Badge>
        </div>
        <p className="mt-0.5 text-[15px] text-fg-muted">
          {[p.lot ? `Lot ${p.lot}` : null, p.quantity ?? null, `par ${author(w.authorId)}`].filter(Boolean).join(' · ')}
        </p>
        {p.comment && <p className="mt-1 text-[15px] text-fg">{p.comment}</p>}
        {related && (
          <p className="mt-1 text-[15px] text-fg-muted">
            Approvisionnement lié : {supplierName(related.payload.supplier_id)}, {dayLabel(related.time, new Date(), tz).toLowerCase()} à {formatTime(related.time, tz)}
          </p>
        )}
        {(p.photo_paths?.length ?? 0) > 0 && (
          <div className="mt-2 space-y-2">
            <PhotoGallery paths={p.photo_paths!} label={`Perte — ${p.product}`} status={data.photoStatus} />
            <PhotoSyncLine paths={p.photo_paths!} data={data} />
          </div>
        )}
      </div>
      <SyncBadge records={entryRecords(w)} />
    </li>
  )
}
