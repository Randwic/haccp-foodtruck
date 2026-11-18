import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ManagerProvider, useManager } from '../../manager/ManagerContext.tsx'
import { Badge, Button, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { useOnline } from '../../ui/hooks/useOnline.ts'
import { IconChecklist, IconChevronLeft, IconCleaning, IconFridge, IconOffline, IconProduct, IconRecipe, IconSettings, IconSupplier, IconUsers, type IconProps } from '../../ui/icons.tsx'
import { ManagerReauth, useManagerSession } from './useManagerSession.tsx'
import { ManagementContext, type ManagementTools, type RunWrite } from './common.tsx'
import { EquipmentSection } from './EquipmentSection.tsx'
import { SettingsSection } from './SettingsSection.tsx'
import { StaffSection } from './StaffSection.tsx'
import { SupplierSection } from './SupplierSection.tsx'
import { ProductSection } from './ProductSection.tsx'
import { RecipeSection } from './RecipeSection.tsx'
import { LabelSettingsCard } from './LabelSettingsCard.tsx'
import { CleaningSection } from './CleaningSection.tsx'
import { ChecklistSection } from './ChecklistSection.tsx'

type Tab = 'equipment' | 'staff' | 'suppliers' | 'products' | 'recipes' | 'cleaning' | 'checklists' | 'settings'
const TABS: { id: Tab; label: string; Icon: (p: IconProps) => ReactNode }[] = [
  { id: 'equipment', label: 'Équipements', Icon: IconFridge },
  { id: 'staff', label: 'Équipe', Icon: IconUsers },
  { id: 'suppliers', label: 'Fournisseurs', Icon: IconSupplier },
  { id: 'products', label: 'Produits', Icon: IconProduct },
  { id: 'recipes', label: 'Recettes', Icon: IconRecipe },
  { id: 'cleaning', label: 'Nettoyage', Icon: IconCleaning },
  { id: 'checklists', label: 'Checklists', Icon: IconChecklist },
  { id: 'settings', label: 'Réglages', Icon: IconSettings },
]

/** Espace Gestion (gérant uniquement) : exige Internet et une session gérant valide. */
export function ManagementScreen({ onBack, meId, onOpenAllergens }: { onBack: () => void; meId: string | null; onOpenAllergens?: () => void }) {
  const manager = useManager()
  const core = useCore()
  const toast = useToast()
  const online = useOnline()
  const { auth, setAuth, guarded } = useManagerSession()
  const [tab, setTab] = useState<Tab>('equipment')

  const run = useCallback<RunWrite>(
    async (fn, success) => {
      const r = await fn()
      if (success) toast(success, 'ok')
      // La base locale de l'appareil se met à jour par sync-pull.
      core.syncNow().catch(() => {})
      return r
    },
    [core, toast],
  )
  const tools = useMemo<ManagementTools>(() => ({ run, meId }), [run, meId])

  let body
  if (!online) {
    body = (
      <div role="alert" className="flex items-start gap-4 rounded-2xl border border-warn/35 bg-warn-soft p-5 sm:p-6">
        <IconOffline size={24} className="mt-0.5 shrink-0 text-warn" />
        <div>
        <p className="text-xl font-semibold text-fg">La gestion nécessite une connexion Internet.</p>
        <p className="mt-1.5 text-[17px] text-fg-muted">Les modifications sont faites directement sur le serveur. Les relevés, eux, continuent de fonctionner hors-ligne.</p>
        </div>
      </div>
    )
  } else if (auth.kind === 'checking') {
    body = <p className="text-[17px] text-fg-muted">Vérification de la session…</p>
  } else if (auth.kind === 'needed') {
    body = <ManagerReauth notice={auth.notice} onDone={() => setAuth({ kind: 'ok' })} />
  } else {
    body = (
      <>
        <div role="tablist" aria-label="Rubriques de gestion" className="mb-8 grid grid-cols-4 gap-1 rounded-xl bg-sunken p-1 lg:grid-cols-8">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-lg px-0.5 text-[13px] font-semibold sm:text-[15px] transition-colors sm:px-2 ${
                tab === t.id ? 'bg-elevated text-fg shadow-card' : 'text-fg-muted active:bg-pressed'
              }`}
            >
              <t.Icon className={`hidden sm:inline ${tab === t.id ? 'text-accent' : ''}`} size={18} />
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'equipment' && <EquipmentSection />}
          {tab === 'staff' && <StaffSection />}
          {tab === 'suppliers' && <SupplierSection />}
          {tab === 'products' && <ProductSection />}
          {tab === 'recipes' && <RecipeSection onOpenAllergens={onOpenAllergens} />}
          {tab === 'cleaning' && <CleaningSection />}
          {tab === 'checklists' && <ChecklistSection />}
          {tab === 'settings' && (
            <>
              <SettingsSection onSignedOut={() => setAuth({ kind: 'needed' })} />
              <LabelSettingsCard />
            </>
          )}
        </div>
      </>
    )
  }

  return (
    <ManagerProvider manager={guarded}>
      <ManagementContext.Provider value={tools}>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">
          <Button variant="ghost" onClick={onBack} icon={<IconChevronLeft size={22} />} className="-ml-3 px-3 text-accent">
            Accueil
          </Button>
          <div className="mt-2 mb-6 flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Gestion</h1>
            {manager.mode === 'mock' && (
              <span title="Aucun serveur configuré : données simulées">
                <Badge tone="warn">Serveur simulé</Badge>
              </span>
            )}
          </div>
          {body}
        </main>
      </ManagementContext.Provider>
    </ManagerProvider>
  )
}
