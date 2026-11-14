import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorText } from '../../manager/api.ts'
import { guessDeviceName } from '../../manager/helpers.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Button, Notice } from '../../ui/components/index.ts'
import { useOnline } from '../../ui/hooks/useOnline.ts'
import { EnrollScreen } from '../enrollment/EnrollScreen.tsx'
import { BootstrapScreen } from './BootstrapScreen.tsx'
import { ManagerLoginScreen } from './ManagerLoginScreen.tsx'
import { SetupLayout } from './SetupLayout.tsx'

type State =
  | { kind: 'checking' }
  | { kind: 'error'; message: string }
  | { kind: 'bootstrap' }
  | { kind: 'login'; establishmentName?: string; notice?: string; email?: string }
  | { kind: 'advanced'; previous: State }

/** Premier lancement (aucun appareil enrôlé) : création du compte gérant ou connexion, puis enrôlement. */
export function SetupFlow({ onEnrolled }: { onEnrolled: () => void }) {
  const manager = useManager()
  const online = useOnline()
  const [state, setState] = useState<State>({ kind: 'checking' })
  const deviceName = useMemo(() => guessDeviceName(), [])

  const check = useCallback(async () => {
    setState({ kind: 'checking' })
    try {
      const s = await manager.getBootstrapStatus()
      setState(s.needs_bootstrap ? { kind: 'bootstrap' } : { kind: 'login', establishmentName: s.establishment_name || undefined })
    } catch (e) {
      setState({ kind: 'error', message: errorText(e) })
    }
  }, [manager])

  // Vérifie à l'ouverture et au retour du réseau (sauf si l'utilisateur a déjà commencé à saisir).
  const kind = useRef(state.kind)
  useEffect(() => {
    kind.current = state.kind
  })
  useEffect(() => {
    if (online && (kind.current === 'checking' || kind.current === 'error')) void check()
  }, [online, check])

  const advanced = () => setState((s) => ({ kind: 'advanced', previous: s }))

  if (state.kind === 'advanced') {
    return <EnrollScreen onEnrolled={onEnrolled} onBack={() => setState(state.previous)} />
  }

  if (!online) {
    return (
      <SetupLayout title="Connexion Internet nécessaire">
        <div role="alert" className="rounded-3xl bg-slate-900 p-6 ring-2 ring-amber-400">
          <p className="text-2xl font-bold text-amber-200">Connectez l’appareil à Internet pour la première configuration.</p>
          <p className="mt-3 text-lg text-slate-200">
            Wi-Fi ou partage de connexion du téléphone. Ensuite, l’application fonctionnera aussi sans réseau : vos saisies seront gardées sur l’appareil.
          </p>
        </div>
      </SetupLayout>
    )
  }

  if (state.kind === 'checking') {
    return (
      <SetupLayout title="Bienvenue">
        <p className="text-xl text-slate-300" aria-busy="true">
          Vérification auprès du serveur…
        </p>
      </SetupLayout>
    )
  }

  if (state.kind === 'error') {
    return (
      <SetupLayout title="Bienvenue" footer={<Button variant="ghost" onClick={advanced}>Configuration avancée</Button>}>
        <div className="space-y-5">
          <Notice>{state.message}</Notice>
          <Button size="lg" block onClick={check}>
            Réessayer
          </Button>
        </div>
      </SetupLayout>
    )
  }

  if (state.kind === 'bootstrap') {
    return (
      <BootstrapScreen
        defaultDeviceName={deviceName}
        onEnrolled={onEnrolled}
        onAlreadyBootstrapped={(notice, email) => setState({ kind: 'login', notice, email })}
        onContinueWithLogin={(notice, email) => setState({ kind: 'login', notice, email })}
      />
    )
  }

  return (
    <ManagerLoginScreen
      defaultDeviceName={deviceName}
      establishmentName={state.establishmentName}
      initialEmail={state.email}
      notice={state.notice}
      onEnrolled={onEnrolled}
      onAdvanced={advanced}
    />
  )
}
