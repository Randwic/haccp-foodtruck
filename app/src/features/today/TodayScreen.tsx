import { Tile } from '../../ui/components/index.ts'
import {
  IconCleaning,
  IconCooling,
  IconDelivery,
  IconDocuments,
  IconLabel,
  IconOil,
  IconSliders,
  IconSystemTest,
  IconTemperature,
} from '../../ui/icons.tsx'

const ICON = 22

const UPCOMING = [
  { title: 'Températures', Icon: IconTemperature, description: 'Frigos, congélateur, cuisson' },
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

/** Accueil « Aujourd'hui » : outils disponibles puis modules HACCP. */
export function TodayScreen({ onOpenSystemTest, onOpenManagement }: { onOpenSystemTest: () => void; onOpenManagement?: () => void }) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-10 sm:px-6 sm:pt-8">
      <h1 className="mb-6 text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Aujourd’hui</h1>

      <section aria-labelledby="tools-title" className="mb-8">
        <SectionLabel id="tools-title">Outils</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          {onOpenManagement && (
            <Tile layout="row" title="Gestion" icon={<IconSliders size={ICON} />} description="Équipements, équipe, réglages" onClick={onOpenManagement} />
          )}
          <Tile layout="row" title="Test d’enregistrement" icon={<IconSystemTest size={ICON} />} description="Vérifier saisie et synchro" onClick={onOpenSystemTest} />
        </div>
      </section>

      <section aria-labelledby="modules-title">
        <SectionLabel id="modules-title">Registres HACCP</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {UPCOMING.map((m) => (
            <Tile key={m.title} title={m.title} icon={<m.Icon size={ICON} />} description={m.description} disabled />
          ))}
        </div>
      </section>

      <p className="mt-10 max-w-3xl text-[13px] leading-relaxed text-fg-subtle">
        Outil d’aide à l’application du Plan de Maîtrise Sanitaire : il ne vaut pas agrément et ne remplace pas la responsabilité de l’exploitant.
      </p>
    </main>
  )
}
