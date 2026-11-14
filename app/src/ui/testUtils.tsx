// Aides de test (non incluses dans le build : importées uniquement par les *.test.tsx).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach } from 'vitest'
import type { CoreApi } from '../core/api.ts'
import { AppShell } from './AppShell.tsx'
import { ToastProvider } from './components/index.ts'
import { CoreProvider } from './CoreContext.tsx'

// Vitest sans `globals` : Testing Library ne démonte pas automatiquement entre les tests.
afterEach(() => {
  cleanup()
  localStorage.clear()
})

export function renderWithCore(core: CoreApi, ui: ReactNode = <AppShell />) {
  return render(
    <CoreProvider core={core}>
      <ToastProvider>{ui}</ToastProvider>
    </CoreProvider>,
  )
}

/** Tape un PIN sur le pavé numérique puis valide. */
export function typePin(pin: string) {
  for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d }))
  fireEvent.click(screen.getByRole('button', { name: 'Valider le code' }))
}

export async function unlockAs(name: string, pin: string) {
  fireEvent.click(await screen.findByRole('radio', { name: new RegExp(name) }))
  typePin(pin)
}
