import { createContext, useContext, type ReactNode } from 'react'
import type { ManagerApi } from './api.ts'

const ManagerContext = createContext<ManagerApi | null>(null)

/** Injecte l'implémentation de l'espace gérant (Supabase ou simulée). */
export function ManagerProvider({ manager, children }: { manager: ManagerApi; children: ReactNode }) {
  return <ManagerContext.Provider value={manager}>{children}</ManagerContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useManager(): ManagerApi {
  const m = useContext(ManagerContext)
  if (!m) throw new Error('useManager() doit être utilisé sous <ManagerProvider>.')
  return m
}
