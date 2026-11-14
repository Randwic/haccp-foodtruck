import type { CoreApi } from './core/api.ts'
import type { ManagerApi } from './manager/api.ts'
import { ManagerProvider } from './manager/ManagerContext.tsx'
import { AppShell } from './ui/AppShell.tsx'
import { ToastProvider } from './ui/components/index.ts'
import { CoreProvider } from './ui/CoreContext.tsx'
import { UpdatePrompt } from './ui/pwa/UpdatePrompt.tsx'

/** Racine de l'interface : reçoit le core et l'espace gérant (voir main.tsx). */
export default function App({ core, manager }: { core: CoreApi; manager: ManagerApi }) {
  return (
    <CoreProvider core={core}>
      <ManagerProvider manager={manager}>
        <ToastProvider>
          <AppShell />
          <UpdatePrompt />
        </ToastProvider>
      </ManagerProvider>
    </CoreProvider>
  )
}
