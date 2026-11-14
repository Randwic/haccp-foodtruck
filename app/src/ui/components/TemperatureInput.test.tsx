import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemperatureInput } from './TemperatureInput.tsx'

afterEach(cleanup)

function Harness({ onChange, initial = null }: { onChange?: (v: number | null) => void; initial?: number | null }) {
  const [v, setV] = useState<number | null>(initial)
  return (
    <TemperatureInput
      label="Température"
      value={v}
      onChange={(x) => {
        setV(x)
        onChange?.(x)
      }}
      threshold={{ min_c: null, max_c: 4 }}
      autoFocus
    />
  )
}

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

describe('TemperatureInput', () => {
  it('pavé tactile : valeur, statut conforme / hors seuil en direct (icône + texte)', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    expect(screen.getByRole('group', { name: 'Température' })).toHaveFocus()
    expect(screen.getByText(/^Seuil : ≤.4.°C$/)).toBeInTheDocument()
    press('3')
    press('Virgule')
    press('5')
    expect(onChange).toHaveBeenLastCalledWith(3.5)
    expect(screen.getByLabelText('Valeur saisie : 3,5 degrés')).toBeInTheDocument()
    expect(screen.getByText('Conforme')).toBeInTheDocument()
    press('Effacer le dernier caractère')
    press('Effacer le dernier caractère')
    press('Effacer le dernier caractère')
    expect(onChange).toHaveBeenLastCalledWith(null)
    press('7')
    expect(screen.getByText('Hors seuil')).toBeInTheDocument()
    press('Moins (changer le signe)')
    expect(onChange).toHaveBeenLastCalledWith(-7)
    expect(screen.getByLabelText('Valeur saisie : −7 degrés')).toBeInTheDocument()
  })

  it('refuse une 2ᵉ décimale et explique les bornes', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} initial={2.5} />)
    press('5')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/une décimale au plus/)).toBeInTheDocument()
  })

  it('clavier physique', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'Température' })
    for (const key of ['-', '1', '8', '.', '5']) fireEvent.keyDown(group, { key })
    expect(onChange).toHaveBeenLastCalledWith(-18.5)
    fireEvent.keyDown(group, { key: 'Escape' })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
