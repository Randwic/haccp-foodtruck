import { act, fireEvent, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivityNotifier } from '../activity.ts'
import { createFakeCore } from '../fakeCore.ts'
import { renderWithCore } from '../testUtils.tsx'
import { useAutoLock } from './useAutoLock.ts'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useAutoLock', () => {
  it('appelle onIdle après le délai d’inactivité', () => {
    const onIdle = vi.fn()
    renderHook(() => useAutoLock(2, onIdle))
    vi.advanceTimersByTime(119_000)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2_000)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('repousse le délai à chaque toucher ou touche clavier', () => {
    const onIdle = vi.fn()
    renderHook(() => useAutoLock(2, onIdle))
    vi.advanceTimersByTime(100_000)
    fireEvent.pointerDown(window)
    vi.advanceTimersByTime(100_000)
    fireEvent.keyDown(window, { key: 'a' })
    vi.advanceTimersByTime(100_000)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(25_000)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('signale chaque activité au point unique reportActivity (futur notifyActivity du core)', () => {
    const notify = vi.fn()
    setActivityNotifier(notify)
    renderHook(() => useAutoLock(2, vi.fn()))
    fireEvent.touchStart(window)
    fireEvent.keyDown(window, { key: '1' })
    expect(notify).toHaveBeenCalledTimes(2)
    setActivityNotifier(null)
  })

  it('ne fait rien si désactivé', () => {
    const onIdle = vi.fn()
    renderHook(() => useAutoLock(2, onIdle, false))
    vi.advanceTimersByTime(10 * 60_000)
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('verrouille au retour au premier plan si le délai est dépassé (iOS suspend les minuteries)', () => {
    const onIdle = vi.fn()
    renderHook(() => useAutoLock(1, onIdle))
    // Simule une horloge qui avance sans que les minuteries ne se déclenchent.
    vi.setSystemTime(Date.now() + 2 * 60_000)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('verrouille l’app après auto_lock_minutes (réglage du core)', async () => {
    const core = createFakeCore({ enrolled: true, unlockedStaffId: 'staff-equipier', settings: { auto_lock_minutes: 3 } })
    renderWithCore(core)
    expect(await screen.findByRole('heading', { name: 'Aujourd’hui' })).toBeInTheDocument()
    await act(async () => {}) // laisse le temps aux réglages (getSettings) d'arriver
    await act(async () => {
      vi.advanceTimersByTime(3 * 60_000 + 500)
    })
    expect(core.currentStaff()).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Qui êtes-vous ?' })).toBeInTheDocument()
  })
})
