import { createContext, useContext, type ReactNode } from 'react'
import type { CoreApi } from '../core/api.ts'

const CoreContext = createContext<CoreApi | null>(null)

/** Injecte l'implémentation du core (vraie ou factice) dans l'arbre React. */
export function CoreProvider({ core, children }: { core: CoreApi; children: ReactNode }) {
  return <CoreContext.Provider value={core}>{children}</CoreContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCore(): CoreApi {
  const core = useContext(CoreContext)
  if (!core) throw new Error('useCore() doit être utilisé sous <CoreProvider>.')
  return core
}
