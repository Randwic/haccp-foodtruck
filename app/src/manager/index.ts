// Espace gérant : point d'entrée.
export * from './api.ts'
export { createSupabaseManagerApi, type SupabaseManagerOptions } from './supabaseManager.ts'
export { createMockManagerApi, withEstablishmentName, MOCK_MANAGER_ACCOUNT, type MockManagerApi, type MockManagerOptions } from './mockManager.ts'
export { ManagerProvider, useManager } from './ManagerContext.tsx'
export * from './helpers.ts'
