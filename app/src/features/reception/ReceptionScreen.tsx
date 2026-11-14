// Module Réception (lot 3) : nouvelle réception guidée, pertes, historique 30 jours, corrections.
import { useState } from 'react'
import type { ReceptionItem } from '../../../../shared/payloads.ts'
import { Badge, Button, Notice, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { formatTime } from '../../ui/format.ts'
import { IconBan, IconChevronRight, IconError, IconHistory, IconSyncPending, IconTruck, IconWaste } from '../../ui/icons.tsx'
import { describeThreshold, formatTemperature } from '../../ui/temperature.ts'
import { CorrectiveActionFlow } from '../corrective-action/CorrectiveActionFlow.tsx'
import { BackButton, EmptyCard, PageTitle, SectionLabel } from '../processes/common.tsx'
import { whenLabel } from '../temperatures/format.ts'
import { plural, startOfLocalDay } from '../temperatures/schedule.ts'
import { isOutOfRange, storageThreshold, supplierNameOf, type ReceptionEntry } from './model.ts'
import { ReceptionForm } from './ReceptionForm.tsx'
import { ReceptionHistory, type HistoryFilter } from './ReceptionHistory.tsx'
import { useReceptionStatus } from './useReceptionData.ts'
import { WasteForm } from './WasteForm.tsx'

type Back = { name: 'home' } | { name: 'history'; filter: HistoryFilter }
type View =
  | Back
  | { name: 'new' }
  | { name: 'waste' }
  | { name: 'correct'; entryId: string; back: Back }
  | { name: 'action'; relatedRecordId: string; supplierName: string; items: ReceptionItem[]; back: Back }

function outOfRangeDetail(items: readonly ReceptionItem[]) {
  return items
    .map((i) => `${i.product} ${formatTemperature(i.temperature_c!)} (seuil ${describeThreshold(storageThreshold(i.storage)!)})`)
    .join(' · ')
}

export function ReceptionScreen({ onBack, canAddSupplier }: { onBack: () => void; canAddSupplier: boolean }) {
  const core = useCore()
  const toast = useToast()
  const { data, error, reload, now, summary } = useReceptionStatus(30_000)
  const [view, setView] = useState<View>({ name: 'home' })

  let body
  if (error && !data) body = <Notice>Lecture impossible : {error}</Notice>
  else if (!data || !summary) body = <p className="text-[17px] text-fg-muted">Chargement…</p>
  else {
    const supplierName = supplierNameOf(data.suppliers)
    const actionFor = (e: ReceptionEntry, back: Back): View => ({
      name: 'action',
      relatedRecordId: e.latest.id,
      supplierName: supplierName(e.payload.supplier_id),
      items: e.outOfRange,
      back,
    })
    if (view.name === 'action') {
      return (
        <CorrectiveActionFlow
          key={view.relatedRecordId}
          relatedRecordId={view.relatedRecordId}
          subject={`Réception — ${view.supplierName}`}
          detail={<span className="font-semibold text-danger">Accepté hors température : {outOfRangeDetail(view.items)}</span>}
          onDone={async () => {
            await reload()
            setView(view.back)
          }}
        />
      )
    }
    if (view.name === 'new' || view.name === 'correct') {
      const correcting = view.name === 'correct' ? data.receptions.find((r) => r.id === view.entryId) : undefined
      const back: Back = view.name === 'correct' ? view.back : { name: 'home' }
      body =
        view.name === 'correct' && !correcting ? (
          <Notice>Réception introuvable.</Notice>
        ) : (
          <ReceptionForm
            key={view.name === 'correct' ? view.entryId : 'new'}
            data={data}
            now={now}
            canAddSupplier={canAddSupplier}
            correcting={correcting}
            onCancel={() => setView(back)}
            onSaved={async (rec, payload) => {
              await reload()
              const out = payload.items.filter((i) => i.accepted && isOutOfRange(i))
              const alreadyHandled = correcting ? correcting.correctiveActions.length > 0 : false
              const refused = payload.items.filter((i) => !i.accepted).length
              toast(
                correcting ? 'Correction enregistrée' : `Réception enregistrée${refused ? ` (${plural(refused, 'produit refusé', 'produits refusés')})` : ''}`,
                'ok',
              )
              if (out.length > 0 && !alreadyHandled) {
                setView({ name: 'action', relatedRecordId: rec.id, supplierName: supplierName(payload.supplier_id), items: out, back })
              } else setView(back)
            }}
          />
        )
    } else if (view.name === 'waste') {
      body = (
        <>
          <BackButton label="Réception" onClick={() => setView({ name: 'home' })} />
          <WasteForm
            data={data}
            onCancel={() => setView({ name: 'home' })}
            onSaved={async () => {
              await reload()
              setView({ name: 'home' })
            }}
          />
        </>
      )
    } else if (view.name === 'history') {
      const back: Back = view
      body = (
        <>
          <BackButton label="Réception" onClick={() => setView({ name: 'home' })} />
          <ReceptionHistory
            data={data}
            now={now}
            filter={view.filter}
            onFilter={(filter) => setView({ name: 'history', filter })}
            onCorrect={(e) => setView({ name: 'correct', entryId: e.id, back })}
            onCorrectiveAction={(e) => setView(actionFor(e, back))}
          />
        </>
      )
    } else {
      const tz = data.timeZone
      const todayStart = startOfLocalDay(now, tz).getTime()
      const today = data.receptions.filter((e) => Date.parse(e.time) >= todayStart)
      const missing = data.receptions.filter((e) => e.missingAction)
      const weekStart = startOfLocalDay(now, tz, 6).getTime()
      const refusals = data.receptions.filter((e) => Date.parse(e.time) >= weekStart && e.refused.length > 0)
      const history = () => setView({ name: 'history', filter: { tab: 'receptions', supplierId: null } })
      body = (
        <>
          <BackButton label="Accueil" onClick={onBack} />
          <PageTitle
            title="Réception"
            subtitle="Contrôle des livraisons, traçabilité des lots et pertes"
            actions={
              <Button variant="secondary" onClick={history} icon={<IconHistory size={20} />}>
                Historique
              </Button>
            }
          />

          {missing.length > 0 && (
            <section aria-labelledby="rc-missing" className="mb-6 rounded-2xl border border-danger/35 bg-danger-soft p-4 sm:p-5">
              <h2 id="rc-missing" className="flex items-center gap-2.5 text-[17px] font-semibold text-danger">
                <IconError size={22} className="shrink-0" />
                {plural(missing.length, 'action corrective manquante', 'actions correctives manquantes')}
              </h2>
              <ul className="mt-3 space-y-2.5">
                {missing.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
                    <span className="text-[16px] text-fg">
                      <span className="font-semibold">{supplierName(e.payload.supplier_id)}</span> · {whenLabel(e.time, now, tz)} · {outOfRangeDetail(e.outOfRange)}
                    </span>
                    <Button variant="danger" onClick={() => setView(actionFor(e, { name: 'home' }))}>
                      Faire l’action corrective
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(summary.photos.pending > 0 || summary.photos.failed > 0) && (
            <div className="mb-6">
              {summary.photos.failed > 0 ? (
                <Notice>
                  {plural(summary.photos.failed, 'photo refusée', 'photos refusées')} par le serveur (conflit) : elles restent sur l’appareil, prévenez le gérant.
                </Notice>
              ) : (
                <Notice tone="warn">
                  <span className="font-semibold">{plural(summary.photos.pending, 'photo en attente d’envoi', 'photos en attente d’envoi')}.</span> Elles restent sur l’appareil et
                  partiront dès que le réseau sera disponible.{' '}
                  <button type="button" className="font-semibold text-accent underline" onClick={() => void core.syncNow()}>
                    Envoyer maintenant
                  </button>
                </Notice>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
            <ActionCard
              title="Nouvelle réception"
              description="Fournisseur, contrôles, produits, lots, DLC, températures, photos"
              icon={<IconTruck size={26} />}
              primary
              onClick={() => setView({ name: 'new' })}
            />
            <ActionCard title="Perte / produit jeté" description="Produit non conforme, date dépassée, rappel" icon={<IconWaste size={26} />} onClick={() => setView({ name: 'waste' })} />
          </div>

          <section className="mt-8" aria-labelledby="rc-today">
            <SectionLabel id="rc-today">Aujourd’hui</SectionLabel>
            {today.length === 0 ? (
              <EmptyCard>Aucune réception aujourd’hui.</EmptyCard>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                {today.map((e) => (
                  <ReceptionLine key={e.id} entry={e} tz={tz} name={supplierName(e.payload.supplier_id)} pendingPhotos={e.photos.filter((p) => ['pending', 'draft'].includes(data.photoStatus[p]?.state ?? '')).length} onOpen={history} />
                ))}
              </ul>
            )}
          </section>

          {refusals.length > 0 && (
            <section className="mt-8" aria-labelledby="rc-refusals">
              <SectionLabel id="rc-refusals">Refus des 7 derniers jours</SectionLabel>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                {refusals.flatMap((e) =>
                  e.refused.map((it, k) => (
                    <li key={`${e.id}-${k}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5 sm:px-5">
                      <IconBan size={20} className="shrink-0 text-danger" />
                      <span className="min-w-0 flex-1 text-[16px] text-fg">
                        <span className="font-semibold">{it.product}</span>
                        <span className="text-fg-muted">
                          {' '}
                          · {supplierName(e.payload.supplier_id)} · {whenLabel(e.time, now, tz)}
                        </span>
                      </span>
                      <span className="text-[15px] text-danger">{it.refusal_reason}</span>
                    </li>
                  )),
                )}
              </ul>
            </section>
          )}
        </>
      )
    }
  }
  return <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">{body}</main>
}

function ActionCard({ title, description, icon, primary, onClick }: { title: string; description: string; icon: React.ReactNode; primary?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-28 items-center gap-4 rounded-2xl border p-5 text-left shadow-card transition-[background-color,transform] active:scale-[0.99] ${
        primary ? 'border-accent bg-accent text-on-accent active:bg-accent-pressed' : 'border-line bg-surface text-fg active:bg-pressed'
      }`}
    >
      <span aria-hidden="true" className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${primary ? 'bg-on-accent/15' : 'bg-accent-soft text-accent'}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[20px] leading-snug font-semibold">{title}</span>
        <span className={`mt-0.5 block text-[15px] ${primary ? 'opacity-85' : 'text-fg-muted'}`}>{description}</span>
      </span>
      <IconChevronRight size={22} className="shrink-0 opacity-70" />
    </button>
  )
}

function ReceptionLine({ entry: e, tz, name, pendingPhotos, onOpen }: { entry: ReceptionEntry; tz: string; name: string; pendingPhotos: number; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 text-left active:bg-pressed sm:px-5">
        <span className="w-14 shrink-0 text-[16px] font-semibold text-fg tabular-nums">{formatTime(e.time, tz)}</span>
        <span className="min-w-0 flex-1 text-[16px] text-fg">
          <span className="font-semibold">{name}</span>
          <span className="text-fg-muted"> · {plural(e.payload.items.length, 'produit', 'produits')}</span>
        </span>
        {e.refused.length > 0 && (
          <Badge tone="error">
            <IconBan size={14} /> {e.refused.length} refusé{e.refused.length > 1 ? 's' : ''}
          </Badge>
        )}
        {pendingPhotos > 0 && (
          <Badge tone="warn">
            <IconSyncPending size={14} /> {plural(pendingPhotos, 'photo', 'photos')} en attente
          </Badge>
        )}
      </button>
    </li>
  )
}
