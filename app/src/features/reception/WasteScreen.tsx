// Produits jetés (tuile dédiée de l'accueil) : saisie rapide d'une perte (`waste`), total de la semaine,
// historique 30 jours. Même formulaire que depuis Achats & réception ; suggestions élargies aux produits
// du catalogue et aux étiquettes en cours.
import { useMemo, useState } from 'react'
import { Notice } from '../../ui/components/index.ts'
import { IconChevronRight, IconWaste } from '../../ui/icons.tsx'
import { useLabelData } from '../labels/useLabelData.ts'
import { BackButton, EmptyCard, PageTitle, SectionLabel, useAuthorName } from '../processes/common.tsx'
import { dayLabel } from '../temperatures/format.ts'
import { localDayKey, plural, startOfLocalDay } from '../temperatures/schedule.ts'
import { RECEPTION_HISTORY_DAYS, supplierNameOf, WASTE_REASON_LABELS, WASTE_REASON_ORDER } from './model.ts'
import { WasteRow } from './ReceptionHistory.tsx'
import { useReceptionStatus } from './useReceptionData.ts'
import { WasteForm } from './WasteForm.tsx'
import { wasteSuggestions, wastesThisWeek } from './wasteModel.ts'

export function WasteScreen({ onBack }: { onBack: () => void }) {
  const { data, error, reload, now } = useReceptionStatus(60_000)
  const { data: labelData } = useLabelData()
  const [view, setView] = useState<'home' | 'new'>('home')
  const author = useAuthorName(data?.staff ?? [])
  const suggestions = useMemo(
    () => (data ? wasteSuggestions({ labels: labelData?.labels ?? [], receptions: data.receptions, products: labelData?.products ?? [], now }) : []),
    [data, labelData, now],
  )

  let body
  if (error && !data) body = <Notice>Lecture impossible : {error}</Notice>
  else if (!data) body = <p className="text-[17px] text-fg-muted">Chargement…</p>
  else if (view === 'new') {
    body = (
      <>
        <BackButton label="Produits jetés" onClick={() => setView('home')} />
        <WasteForm
          data={data}
          suggestions={suggestions}
          onCancel={() => setView('home')}
          onSaved={async () => {
            await reload()
            setView('home')
          }}
        />
      </>
    )
  } else {
    const tz = data.timeZone
    const week = wastesThisWeek(data.wastes, now, tz)
    const byReason = WASTE_REASON_ORDER.map((r) => ({ r, n: week.filter((w) => w.payload.reason === r).length })).filter((x) => x.n > 0)
    const from = startOfLocalDay(now, tz, RECEPTION_HISTORY_DAYS).getTime()
    const list = data.wastes.filter((w) => Date.parse(w.time) >= from)
    const groups = new Map<string, typeof list>()
    for (const w of list) groups.set(localDayKey(w.time, tz), [...(groups.get(localDayKey(w.time, tz)) ?? []), w])
    body = (
      <>
        <BackButton label="Accueil" onClick={onBack} />
        <PageTitle title="Produits jetés" subtitle="Date dépassée, produit non conforme, abîmé, rappel : chaque produit jeté est tracé" />
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <button
            type="button"
            onClick={() => setView('new')}
            className="flex min-h-28 items-center gap-4 rounded-2xl border border-accent bg-accent p-5 text-left text-on-accent shadow-card transition-[background-color,transform] active:scale-[0.99] active:bg-accent-pressed"
          >
            <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-on-accent/15">
              <IconWaste size={26} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[20px] leading-snug font-semibold">Déclarer un produit jeté</span>
              <span className="mt-0.5 block text-[15px] opacity-85">Produit, lot, quantité, motif, photo</span>
            </span>
            <IconChevronRight size={22} className="shrink-0 opacity-70" />
          </button>
          <section aria-labelledby="w-week" className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h2 id="w-week" className="text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
              7 derniers jours
            </h2>
            <p className="mt-1 text-[28px] leading-tight font-semibold text-fg tabular-nums">{week.length === 0 ? 'Aucun produit jeté' : plural(week.length, 'produit jeté', 'produits jetés')}</p>
            {byReason.length > 0 && <p className="mt-1 text-[15px] text-fg-muted">{byReason.map((x) => `${WASTE_REASON_LABELS[x.r]} : ${x.n}`).join(' · ')}</p>}
          </section>
        </div>

        <section aria-labelledby="w-history" className="mt-8">
          <h2 id="w-history" className="sr-only">
            Historique des {RECEPTION_HISTORY_DAYS} derniers jours
          </h2>
          {list.length === 0 ? (
            <EmptyCard>Aucun produit jeté sur les {RECEPTION_HISTORY_DAYS} derniers jours.</EmptyCard>
          ) : (
            [...groups.entries()].map(([key, items]) => (
              <section key={key} aria-label={dayLabel(items[0].time, now, tz)} className="mb-7">
                <SectionLabel>{dayLabel(items[0].time, now, tz)}</SectionLabel>
                <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                  {items.map((w) => (
                    <WasteRow key={w.id} waste={w} data={data} author={author} supplierName={supplierNameOf(data.suppliers)} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </section>
      </>
    )
  }
  return <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">{body}</main>
}
