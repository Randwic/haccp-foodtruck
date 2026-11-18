// « Documents & PMS » (gérant) : documents du contrôle sanitaire, assistant PMS, mode Contrôle, rappel produit et RGPD.
// Documents : Internet + session gérant. PMS : rédaction hors-ligne possible, enregistrement connecté.
// Contrôle : registre complet si connecté, sinon saisies de cet appareil.
import { useEffect, useState, type ReactNode } from 'react'
import { ManagerProvider, useManager } from '../../manager/ManagerContext.tsx'
import { Badge, Button } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { useOnline } from '../../ui/hooks/useOnline.ts'
import { IconChevronLeft, IconDocuments, IconLock, IconOffline, IconRecall, IconSystemTest, IconTable, type IconProps } from '../../ui/icons.tsx'
import { ControlTab } from '../control/ControlTab.tsx'
import { ManagerReauth, useManagerSession } from '../management/useManagerSession.tsx'
import { PmsTab } from '../pms/PmsTab.tsx'
import { RecallTab } from '../recall/RecallTab.tsx'
import { RgpdTab } from '../rgpd/RgpdTab.tsx'
import { DEFAULT_TIMEZONE } from '../temperatures/schedule.ts'
import { DocumentsTab } from './DocumentsTab.tsx'

export type DocumentsView = 'control' | 'recall' | 'documents' | 'pms' | 'rgpd'
const TABS: { id: DocumentsView; label: string; Icon: (p: IconProps) => ReactNode }[] = [
  { id: 'control', label: 'Mode Contrôle', Icon: IconSystemTest },
  { id: 'recall', label: 'Rappel produit', Icon: IconRecall },
  { id: 'documents', label: 'Documents', Icon: IconDocuments },
  { id: 'pms', label: 'Plan (PMS)', Icon: IconTable },
  { id: 'rgpd', label: 'RGPD', Icon: IconLock },
]

export function DocumentsScreen({ onBack, initialTab = 'control' }: { onBack: () => void; initialTab?: DocumentsView }) {
  const manager = useManager()
  const core = useCore()
  const online = useOnline()
  const { auth, setAuth, guarded } = useManagerSession()
  const [tab, setTab] = useState<DocumentsView>(initialTab)
  const [login, setLogin] = useState(false)
  const [timeZone, setTimeZone] = useState(DEFAULT_TIMEZONE)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    core.getEstablishment().then((e) => e?.timezone && setTimeZone(e.timezone), () => {})
  }, [core])

  const connected = online && auth.kind === 'ok' ? guarded : null
  const reauth = (intro: string) => (
    <ManagerReauth
      notice={auth.kind === 'needed' ? auth.notice : undefined}
      intro={intro}
      onDone={() => {
        setAuth({ kind: 'ok' })
        setLogin(false)
      }}
    />
  )
  const offline = (
    <div role="alert" className="flex items-start gap-4 rounded-2xl border border-warn/35 bg-warn-soft p-5 sm:p-6">
      <IconOffline size={24} className="mt-0.5 shrink-0 text-warn" />
      <div>
        <p className="text-xl font-semibold text-fg">Les documents nécessitent une connexion Internet.</p>
        <p className="mt-1.5 text-[17px] text-fg-muted">Ils sont rangés en sécurité sur le serveur. Le mode Contrôle et l’assistant PMS fonctionnent sans connexion.</p>
      </div>
    </div>
  )

  let body: ReactNode
  if (auth.kind === 'checking') body = <p className="text-[17px] text-fg-muted">Vérification de la session…</p>
  else if (login && online && auth.kind !== 'ok') body = reauth('Connectez-vous pour lire tout le registre (tous les appareils), les photos et les documents.')
  else if (tab === 'documents') {
    body = !online ? offline : auth.kind === 'needed' ? reauth('Par sécurité, les documents demandent le mot de passe de votre compte gérant.') : <DocumentsTab timeZone={timeZone} refreshKey={version} />
  } else if (tab === 'recall') {
    body = <RecallTab key={connected ? 'on' : 'off'} manager={connected} timeZone={timeZone} onSignIn={online ? () => setLogin(true) : undefined} />
  } else if (tab === 'pms') {
    body = <PmsTab key={connected ? 'on' : 'off'} manager={connected} timeZone={timeZone} onSaved={() => setVersion((v) => v + 1)} />
  } else if (tab === 'rgpd') {
    body = <RgpdTab key={connected ? 'on' : 'off'} manager={connected} timeZone={timeZone} />
  } else {
    body = <ControlTab key={connected ? 'on' : 'off'} manager={connected} timeZone={timeZone} onSignIn={online ? () => setLogin(true) : undefined} />
  }

  return (
    <ManagerProvider manager={guarded}>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">
        <Button variant="ghost" onClick={onBack} icon={<IconChevronLeft size={22} />} className="-ml-3 px-3 text-accent">
          Accueil
        </Button>
        <div className="mt-2 mb-6 flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[32px]">Documents & contrôle</h1>
          {manager.mode === 'mock' && (
            <span title="Aucun serveur configuré : données simulées">
              <Badge tone="warn">Serveur simulé</Badge>
            </span>
          )}
        </div>
        <div role="tablist" aria-label="Rubriques" className="mb-8 grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1 sm:grid-cols-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`doc-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`doc-panel-${t.id}`}
              onClick={() => {
                setTab(t.id)
                setLogin(false)
              }}
              className={`flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-lg px-1 text-[15px] font-semibold transition-colors sm:px-2 ${
                tab === t.id ? 'bg-elevated text-fg shadow-card' : 'text-fg-muted active:bg-pressed'
              }`}
            >
              <t.Icon className={`hidden sm:inline ${tab === t.id ? 'text-accent' : ''}`} size={18} />
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`doc-panel-${tab}`} aria-labelledby={`doc-tab-${tab}`}>
          {body}
        </div>
      </main>
    </ManagerProvider>
  )
}
