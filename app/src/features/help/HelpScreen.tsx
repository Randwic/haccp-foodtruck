// Écran « Aide » : ouvert depuis le bouton Aide de l'en-tête ou la tuile des Outils. Timeline de ce qu'il faut
// faire dans l'application (avant l'ouverture, chaque jour, chaque semaine, chaque mois) + lien vers le guide PDF.
import { useState } from 'react'
import { Button } from '../../ui/components/index.ts'
import { IconChevronDown, IconChevronUp, IconGuide, IconOk } from '../../ui/icons.tsx'
import { BackButton, PageTitle, SectionLabel } from '../processes/common.tsx'
import { AUTOMATIC, helpTimeline, type HelpOptions, type HelpPeriod } from './timeline.ts'

/** Guide complet, servi par l'app (app/public/guide/). Gardé en cache après la première ouverture. */
export const GUIDE_PDF_URL = '/guide/Guide-utilisation-HACCP-Space-Diner.pdf'

export function HelpScreen({ onBack, backLabel = 'Accueil', options }: { onBack: () => void; backLabel?: string; options?: HelpOptions }) {
  const periods = helpTimeline(options)
  // Chaque période se replie d'un toucher (tout est ouvert au départ).
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(periods.map((p) => [p.id, true])))
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-4 pb-10 sm:px-6">
      <BackButton label={backLabel} onClick={onBack} />
      <PageTitle
        title="Aide"
        subtitle="Quoi faire, et quand, dans l’application."
        actions={
          <a
            href={GUIDE_PDF_URL}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[16px] font-semibold text-accent shadow-card"
          >
            <IconGuide size={20} />
            Guide complet (PDF)
          </a>
        }
      />

      <section aria-labelledby="help-auto" className="mb-8 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <SectionLabel id="help-auto">Ce que l’application fait toute seule</SectionLabel>
        <ul className="grid gap-2">
          {AUTOMATIC.map((t) => (
            <li key={t} className="flex items-start gap-2.5 text-[16px] text-fg">
              <IconOk size={19} className="mt-0.5 shrink-0 text-ok" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-6">
        {periods.map((p) => (
          <Period key={p.id} period={p} open={open[p.id] ?? true} onToggle={() => setOpen((o) => ({ ...o, [p.id]: !(o[p.id] ?? true) }))} />
        ))}
      </div>

      <p className="mt-8 text-[15px] text-fg-muted">
        Le guide complet explique chaque écran pas à pas, avec des images. Il s’ouvre avec Internet la première fois, puis reste disponible sur l’iPad.
      </p>
    </main>
  )
}

function Period({ period, open, onToggle }: { period: HelpPeriod; open: boolean; onToggle: () => void }) {
  const headId = `help-${period.id}`
  return (
    <section aria-labelledby={headId} className="rounded-2xl border border-line bg-surface shadow-card">
      <h2 id={headId} className="m-0">
        <Button
          variant="ghost"
          onClick={onToggle}
          aria-expanded={open}
          className="w-full justify-between rounded-2xl px-5 py-4 text-left text-[19px] font-bold tracking-[-0.01em] text-fg"
          icon={open ? <IconChevronUp size={22} /> : <IconChevronDown size={22} />}
        >
          {period.title}
        </Button>
      </h2>
      <div hidden={!open} className="px-5 pb-5">
        {period.intro && <p className="mb-4 text-[16px] text-fg-muted">{period.intro}</p>}
        <ol className="relative grid gap-0 border-l-2 border-accent/40 pl-5">
          {period.steps.map((s, i) => (
            <li key={i} className="relative pb-4 last:pb-0">
              <span aria-hidden="true" className="absolute top-1.5 -left-[27px] h-3 w-3 rounded-full border-2 border-surface bg-accent" />
              <div className="text-[14px] font-semibold tracking-[0.02em] text-accent">{s.when}</div>
              <div className="text-[17px] leading-snug text-fg">{s.what}</div>
              <div className="mt-0.5 text-[14px] text-fg-subtle">Où : {s.where}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
