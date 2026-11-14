import { Tile } from '../../ui/components/index.ts'

const UPCOMING = [
  { title: 'Températures', icon: '🌡️', description: 'Frigos, congélateur, cuisson' },
  { title: 'Refroidissement', icon: '❄️', description: '+63 °C → +10 °C en moins de 2 h' },
  { title: 'Réception', icon: '📦', description: 'Livraisons, lots, DLC' },
  { title: 'Étiquettes DLC', icon: '🏷️', description: 'Impression et allergènes' },
  { title: 'Nettoyage', icon: '🧽', description: 'Plan et checklists' },
  { title: 'Huiles de friture', icon: '🍟', description: 'Composés polaires, vidanges' },
  { title: 'Documents & PMS', icon: '📁', description: 'Plan de maîtrise, export contrôle' },
] as const

/** Accueil « Aujourd'hui » : tuiles des modules. */
export function TodayScreen({ onOpenSystemTest }: { onOpenSystemTest: () => void }) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-6">
      <h1 className="mb-5 text-3xl font-bold text-white">Aujourd’hui</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile title="Test d’enregistrement" icon="✅" description="Vérifier saisie et synchro" onClick={onOpenSystemTest} />
        {UPCOMING.map((m) => (
          <Tile key={m.title} title={m.title} icon={m.icon} description={m.description} disabled />
        ))}
      </div>
      <p className="mt-8 text-base text-slate-400">
        Outil d’aide à l’application du Plan de Maîtrise Sanitaire : il ne vaut pas agrément et ne remplace pas la responsabilité de l’exploitant.
      </p>
    </main>
  )
}
