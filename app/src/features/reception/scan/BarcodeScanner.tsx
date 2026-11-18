// Lecteur de code-barres plein écran : caméra arrière en direct (ZXing), avec repli « prendre une photo »
// si la caméra est refusée ou indisponible. Rien n'est envoyé : tout est décodé sur l'appareil.
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Modal, Notice } from '../../../ui/components/index.ts'
import { IconCamera } from '../../../ui/icons.tsx'
import type { LabelReading } from '../extensions.ts'
import { readingFromBarcode } from './gtin.ts'
import { barcodeHints, decodeBarcodeFromImage } from './reader.ts'

export interface BarcodeScannerProps {
  /** Lecture réussie (GTIN, et pour un code GS1 le lot et la date) ou null (fermé sans lecture). */
  onResult: (r: LabelReading | null) => void
}

export function BarcodeScanner({ onResult }: BarcodeScannerProps) {
  const video = useRef<HTMLVideoElement>(null)
  const done = useRef(false)
  const [camera, setCamera] = useState<'starting' | 'on' | 'unavailable'>('starting')
  const [hint, setHint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let controls: { stop: () => void } | null = null
    let cancelled = false
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera')
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader(await barcodeHints(), { delayBetweenScanAttempts: 150 })
        const c = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video.current!, (result) => {
          if (!result || done.current) return
          const r = readingFromBarcode(result.getText())
          if (!r) {
            setHint('Code lu, mais ce n’est pas un code-barres de produit. Visez le code-barres principal.')
            return
          }
          done.current = true
          controls?.stop()
          onResult(r)
        })
        if (cancelled) c.stop()
        else {
          controls = c
          setCamera('on')
        }
      } catch {
        if (!cancelled) setCamera('unavailable')
      }
    })()
    return () => {
      cancelled = true
      controls?.stop()
    }
  }, [onResult])

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setHint(null)
    const r = await decodeBarcodeFromImage(file).catch(() => null)
    setBusy(false)
    if (r) {
      done.current = true
      onResult(r)
    } else setHint('Aucun code-barres lisible sur cette photo. Rapprochez-vous, bien à plat, sans reflet.')
  }

  return (
    <Modal open title="Scanner le code-barres" onClose={() => onResult(null)} closeLabel="Annuler">
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '4 / 3' }}>
          <video ref={video} className="h-full w-full object-cover" muted playsInline autoPlay aria-label="Image de la caméra" />
          {camera === 'on' && <div aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-danger/80 shadow-[0_0_12px_rgba(255,0,0,0.6)]" />}
          {camera !== 'on' && (
            <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-[16px] text-white/85">
              {camera === 'starting' ? 'Ouverture de la caméra…' : 'Caméra indisponible. Prenez plutôt une photo du code-barres.'}
            </p>
          )}
        </div>
        <p className="text-[15px] text-fg-muted">
          Placez le code-barres dans le cadre, à 10–20 cm. Les codes des étiquettes de viande (GS1) donnent aussi le lot et la date.
        </p>
        {hint && <Notice tone="warn">{hint}</Notice>}
        <label className="block">
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} disabled={busy} />
          <span className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-line-strong bg-elevated px-4 text-[16px] font-semibold text-fg active:bg-pressed">
            <IconCamera size={20} /> {busy ? 'Lecture…' : 'Prendre une photo du code-barres'}
          </span>
        </label>
      </div>
    </Modal>
  )
}
