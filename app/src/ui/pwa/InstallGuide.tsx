import { useState } from 'react'
import { Button, Modal } from '../components/index.ts'
import { detectAppleDevice, type AppleDevice } from './installState.ts'

export function ShareIcon({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="M7.5 7.5 12 3l4.5 4.5" />
      <path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" />
    </svg>
  )
}

export function AddHomeIcon({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  )
}

/** Schéma de la barre Safari indiquant où se trouve le bouton Partager. */
function SafariSketch({ device }: { device: Exclude<AppleDevice, 'other'> }) {
  const share = (
    <span className="rounded-lg bg-sky-300 p-1 text-slate-950 ring-4 ring-sky-300/40">
      <ShareIcon className="h-6 w-6" />
    </span>
  )
  if (device === 'ipad') {
    return (
      <div aria-hidden="true" className="flex h-12 items-center justify-between rounded-xl bg-slate-700 px-3 text-slate-300">
        <span className="text-sm">‹ ›</span>
        <span className="mx-3 flex-1 rounded-lg bg-slate-800 px-3 py-1 text-center text-sm">haccp…</span>
        {share}
      </div>
    )
  }
  return (
    <div aria-hidden="true" className="mx-auto w-48 rounded-2xl bg-slate-700 p-2 text-slate-300">
      <div className="mb-2 rounded-lg bg-slate-800 px-3 py-1 text-center text-sm">haccp…</div>
      <div className="flex items-center justify-between px-2 text-sm">
        <span>‹</span>
        <span>›</span>
        {share}
        <span>▢</span>
        <span>⧉</span>
      </div>
    </div>
  )
}

export function InstallGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const detected = detectAppleDevice()
  const [device, setDevice] = useState<Exclude<AppleDevice, 'other'>>(detected === 'iphone' ? 'iphone' : 'ipad')

  const steps = [
    {
      icon: <ShareIcon />,
      title: 'Touchez « Partager »',
      text: device === 'ipad' ? 'En haut à droite de Safari.' : 'En bas de l’écran, au centre de la barre Safari.',
      sketch: <SafariSketch device={device} />,
    },
    {
      icon: <AddHomeIcon />,
      title: 'Choisissez « Sur l’écran d’accueil »',
      text: 'Faites défiler la liste vers le bas si besoin.',
    },
    { icon: <span className="text-2xl font-bold">Ajouter</span>, title: 'Touchez « Ajouter »', text: 'En haut à droite.' },
    {
      icon: <img src="/apple-touch-icon.png" alt="" className="h-12 w-12 rounded-xl" />,
      title: 'Ouvrez l’app depuis son icône',
      text: 'Utilisez toujours l’icône HACCP, plus jamais l’onglet Safari.',
    },
  ]

  return (
    <Modal open={open} onClose={onClose} title="Installer l’application" footer={<Button onClick={onClose}>J’ai compris</Button>}>
      <p className="mb-4 text-slate-200">
        Indispensable pour <strong className="text-white">ne pas perdre les saisies</strong> (Safari peut effacer les données d’un site non installé) et pour{' '}
        <strong className="text-white">recevoir les alertes</strong> (notifications).
      </p>
      <div role="radiogroup" aria-label="Type d’appareil" className="mb-5 grid grid-cols-2 gap-3">
        {(['iphone', 'ipad'] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={device === d}
            onClick={() => setDevice(d)}
            className={`min-h-14 rounded-2xl text-lg font-semibold ${device === d ? 'bg-sky-300 text-slate-950' : 'bg-slate-800 text-white ring-1 ring-slate-600'}`}
          >
            {d === 'iphone' ? 'iPhone' : 'iPad'}
          </button>
        ))}
      </div>
      <ol className="space-y-4">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-4 rounded-2xl bg-slate-800 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-300 text-xl font-bold text-slate-950">{i + 1}</span>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span className="text-sky-200">{s.icon}</span>
                <span className="text-xl font-bold text-white">{s.title}</span>
              </div>
              <p className="mt-1 text-slate-300">{s.text}</p>
              {s.sketch && <div className="mt-3">{s.sketch}</div>}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-base text-slate-400">Faites-le depuis Safari : c’est le navigateur pris en charge pour l’installation et les notifications.</p>
    </Modal>
  )
}
