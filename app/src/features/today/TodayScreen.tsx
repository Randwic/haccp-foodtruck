import { Button, Tile } from '../../ui/components/index.ts'
import {
  IconCleaning,
  IconCooling,
  IconDelivery,
  IconDocuments,
  IconDue,
  IconError,
  IconLabel,
  IconOil,
  IconOk,
  IconSliders,
  IconSystemTest,
  IconTemperature,
} from '../../ui/icons.tsx'
import { plural, type TemperatureSummary } from '../temperatures/schedule.ts'
import { useTemperatureStatus } from '../temperatures/useTemperatureData.ts'

const ICON = 22

const UPCOMING = [
  { title: 'Refroidissement', Icon: IconCooling, description: 'De +63 °C à +10 °C en < 2 h' },
  { title: 'Réception', Icon: IconDelivery, description: 'Livraisons, lots, DLC' },
  { title: 'Étiquettes DLC', Icon: IconLabel, description: 'Impression et allergènes' },
  { title: 'Nettoyage', Icon: IconCleaning, description: 'Plan et checklists' },
  { title: 'Huiles de friture', Icon: IconOil, description: 'Composés polaires, vidanges' },
  { title: 'Documents & PMS', Icon: IconDocuments, description: 'Plan de maîtrise, export contrôle' },
] as const

function SectionLabel({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="mb-3 text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
      {children}
    </h2>
  )
}

/** Lignes d'état de la tuile Températures (icône + texte, jamais la couleur seule). */
function TemperatureTileStatus({ summary }: { summary: TemperatureSummary | null }) {
  if (!summary) return <span className="text-[14px] text-fg-subtle">Chargement…</span>
  const line = 'flex items-center gap-1.5 text-[15px] leading-snug font-semibold'
  if (summary.enclosures === 0) return <span className="text-[14px] text-fg-subtle">Aucune enceinte en service</span>
  return (
    <span className="flex flex-col gap-1">
      {summary.missingActions > 0 && (
        <span className={`${line} text-danger`}>
          <IconError size={17} className="shrink-0" />
          {plural(summary.missingActions, 'action corrective manquante', 'actions correctives manquantes')}
        </span>
      )}
      {summary.due > 0 ? (
        <span className={`${line} text-warn`}>
          <IconDue size={17} className="shrink-0" />
          {plural(summary.due, 'relevé à faire', 'relevés à faire')}
        </span>
      ) : (
        summary.missingActions === 0 && (
          <span className={`${line} text-ok`}>
            <IconOk size={17} className="shrink-0" />
            Tout est fait
          </span>
        )
      )}
    </span>
  )
}

function temperatureTileLabel(s: TemperatureSummary | null): string {
  if (!s) return 'Températures'
  const parts = [
    s.missingActions > 0 ? plural(s.missingActions, 'action corrective manquante', 'actions correctives manquantes') : '',
    s.due > 0 ? plural(s.due, 'relevé à faire', 'relevés à faire') : '',
  ].filter(Boolean)
  return `Températures : ${parts.length ? parts.join(', ') : s.enclosures ? 'tout est fait' : 'aucune enceinte'}`
}

export interface TodayScreenProps {
  onOpenSystemTest: () => void
  onOpenManagement?: () => void
  onOpenTemperatures: () => void
}

/** Accueil « Aujourd'hui » : alertes, modules HACCP puis outils. */
export function TodayScreen({ onOpenSystemTest, onOpenManagement, onOpenTemperatures }: TodayScreenProps) {
  const { summary } = useTemperatureStatus()
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-10 sm:px-6 sm:pt-8">
      <h1 className="mb-6 text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Aujourd’hui</h1>

      {summary && summary.missingActions > 0 && (
        <div role="alert" className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-danger/35 bg-danger-soft px-4 py-3.5 sm:px-5">
          <IconError size={22} className="shrink-0 text-danger" />
          <p className="min-w-0 flex-1 text-[16px] text-fg">
            <span className="font-semibold">{plural(summary.missingActions, 'relevé hors seuil', 'relevés hors seuil')} sans action corrective.</span> À traiter dans Températures.
          </p>
          <Button variant="danger" onClick={onOpenTemperatures}>
            Traiter
          </Button>
        </div>
      )}

      <section aria-labelledby="modules-title">
        <SectionLabel id="modules-title">Registres HACCP</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Tile
            title="Températures"
            icon={<IconTemperature size={ICON} />}
            description="Frigos et congélateurs"
            status={<TemperatureTileStatus summary={summary} />}
            tone={summary?.missingActions ? 'danger' : summary?.due ? 'warn' : undefined}
            ariaLabel={temperatureTileLabel(summary)}
            onClick={onOpenTemperatures}
          />
          {UPCOMING.map((m) => (
            <Tile key={m.title} title={m.title} icon={<m.Icon size={ICON} />} description={m.description} disabled />
          ))}
        </div>
      </section>

      <section aria-labelledby="tools-title" className="mt-8">
        <SectionLabel id="tools-title">Outils</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          {onOpenManagement && (
            <Tile layout="row" title="Gestion" icon={<IconSliders size={ICON} />} description="Équipements, équipe, réglages" onClick={onOpenManagement} />
          )}
          <Tile layout="row" title="Test d’enregistrement" icon={<IconSystemTest size={ICON} />} description="Vérifier saisie et synchro" onClick={onOpenSystemTest} />
        </div>
      </section>

      <p className="mt-10 max-w-3xl text-[13px] leading-relaxed text-fg-subtle">
        Outil d’aide à l’application du Plan de Maîtrise Sanitaire : il ne vaut pas agrément et ne remplace pas la responsabilité de l’exploitant.
      </p>
    </main>
  )
}
