import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { BackButton } from '../features/processes/common.tsx'
import { useSwipeBack } from './swipeBack.ts'

function Demo({ dialog = false }: { dialog?: boolean }) {
  useSwipeBack()
  const [n, setN] = useState(0)
  return (
    <div>
      <BackButton label="Accueil" onClick={() => setN((x) => x + 100)} />
      <BackButton label="Retour" onClick={() => setN((x) => x + 1)} />
      <p>retours : {n}</p>
      {dialog && <div role="dialog">fenêtre</div>}
    </div>
  )
}

const swipe = (x0: number, x1: number, y0 = 300, y1 = 300) => {
  fireEvent.touchStart(document, { touches: [{ clientX: x0, clientY: y0 }] })
  fireEvent.touchEnd(document, { changedTouches: [{ clientX: x1, clientY: y1 }] })
}

describe('retour en glissant depuis le bord gauche', () => {
  it('touche le dernier bouton retour de l’écran', () => {
    render(<Demo />)
    swipe(10, 200)
    expect(screen.getByText('retours : 1')).toBeInTheDocument()
  })

  it('ignore un glissement parti du milieu, trop court ou vertical', () => {
    render(<Demo />)
    swipe(200, 400)
    swipe(10, 50)
    swipe(10, 120, 100, 400)
    expect(screen.getByText('retours : 0')).toBeInTheDocument()
  })

  it('ne fait rien quand une fenêtre est ouverte', () => {
    render(<Demo dialog />)
    swipe(10, 200)
    expect(screen.getByText('retours : 0')).toBeInTheDocument()
  })
})
