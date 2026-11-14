import { useState } from 'react'
import { Button, Modal } from '../components/index.ts'
import { IconAddHome, IconChevronLeft, IconChevronRight, IconShare } from '../icons.tsx'
import { detectAppleDevice, type AppleDevice } from './installState.ts'

/** Schéma de la barre Safari indiquant où se trouve le bouton Partager. */
function SafariSketch({ device }: { device: Exclude<AppleDevice, 'other'> }) {
  const share = (
    <span className="rounded-lg bg-accent p-1 text-on-accent">
      <IconShare size={20} />
    </span>
  )
  const nav = (
    <span className="flex gap-2">
      <IconChevronLeft size={18} />
      <IconChevronRight size={18} />
    </span>
  )
  if (device === 'ipad') {
    return (
      <div aria-hidden="true" className="flex h-12 items-center justify-between rounded-xl border border-line bg-sunken px-3 text-fg-subtle">
        {nav}
        <span className="mx-3 flex-1 rounded-lg bg-elevated px-3 py-1 text-center text-sm">haccp…</span>
        {share}
      </div>
    )
  }
  return (
    <div aria-hidden="true" className="mx-auto w-52 rounded-2xl border border-line bg-sunken p-2 text-fg-subtle">
      <div className="mb-2 rounded-lg bg-elevated px-3 py-1 text-center text-sm">haccp…</div>
      <div className="flex items-center justify-between px-1">
        {nav}
        {share}
        <span className="h-4 w-4 rounded-[4px] border-[1.75px] border-current" />
        <span className="h-4 w-5 rounded-[4px] border-[1.75px] border-current" />
      </div>
    </div>
  )
}

export function InstallGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const detected = detectAppleDevice()
  const [device, setDevice] = useState<Exclude<AppleDevice, 'other'>>(detected === 'iphone' ? 'iphone' : 'ipad')

  const steps = [
    {
      icon: <IconShare size={22} />,
      title: 'Touchez « Partager »',
      text: device === 'ipad' ? 'En haut à droite de Safari.' : 'En bas de l’écran, au centre de la barre Safari.',
      sketch: <SafariSketch device={device} />,
    },
    {
      icon: <IconAddHome size={22} />,
      title: 'Choisissez « Sur l’écran d’accueil »',
      text: 'Faites défiler la liste vers le bas si besoin.',
    },
    { icon: null, title: 'Touchez « Ajouter »', text: 'En haut à droite.' },
    {
      icon: <img src="/apple-touch-icon.png" alt="" className="h-8 w-8 rounded-lg" />,
      title: 'Ouvrez l’app depuis son icône',
      text: 'Utilisez toujours l’icône HACCP, plus jamais l’onglet Safari.',
    },
  ]

  return (
    <Modal open={open} onClose={onClose} title="Installer l’application" footer={<Button onClick={onClose}>J’ai compris</Button>}>
      <p className="mb-5 text-fg-muted">
        Indispensable pour <strong className="font-semibold text-fg">ne pas perdre les saisies</strong> (Safari peut effacer les données d’un site non installé) et pour{' '}
        <strong className="font-semibold text-fg">recevoir les alertes</strong> (notifications).
      </p>
      <div role="radiogroup" aria-label="Type d’appareil" className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1">
        {(['iphone', 'ipad'] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={device === d}
            onClick={() => setDevice(d)}
            className={`min-h-12 rounded-lg text-[15px] font-semibold transition-colors ${device === d ? 'bg-elevated text-fg shadow-card' : 'text-fg-muted active:bg-pressed'}`}
          >
            {d === 'iphone' ? 'iPhone' : 'iPad'}
          </button>
        ))}
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-4 rounded-xl border border-line bg-surface p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[15px] font-semibold text-accent tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                {s.icon && <span className="text-accent">{s.icon}</span>}
                <span className="text-[17px] font-semibold text-fg">{s.title}</span>
              </div>
              <p className="mt-1 text-[15px] text-fg-muted">{s.text}</p>
              {s.sketch && <div className="mt-3">{s.sketch}</div>}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[15px] text-fg-subtle">Faites-le depuis Safari : c’est le navigateur pris en charge pour l’installation et les notifications.</p>
    </Modal>
  )
}
