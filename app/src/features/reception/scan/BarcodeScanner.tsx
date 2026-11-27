// Lecteur de code-barres plein écran : caméra arrière en direct, en haute définition (ZXing), avec repli « prendre une photo »
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
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    const stop = () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera')
        // Haute définition demandée : par défaut Safari donne 640 × 480, trop peu pour les fines barres
        // d'un code EAN tenu à 10–20 cm (moins de 2 pixels par barre : rien n'est jamais lu).
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (cancelled) return stop()
        const track = stream.getVideoTracks()[0]
        // Mise au point continue (ignorée sans erreur là où ce n'est pas proposé).
        void track?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {})
        const v = video.current!
        v.srcObject = stream
        await v.play().catch(() => {})
        const [{ MultiFormatReader, BinaryBitmap, HybridBinarizer }, { HTMLCanvasElementLuminanceSource }, hints] = await Promise.all([
          import('@zxing/library'),
          import('@zxing/browser'),
          barcodeHints(),
        ])
        if (cancelled) return stop()
        const reader = new MultiFormatReader()
        reader.setHints(hints)
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        setCamera('on')
        let n = 0
        const tick = () => {
          if (cancelled || done.current) return
          const w = v.videoWidth
          const h = v.videoHeight
          if (w && h) {
            // Le plus souvent : bande centrale (là où est la ligne rouge) à pleine résolution, plus rapide ;
            // une fois sur trois : l'image entière, pour un code-barres décentré.
            const full = n++ % 3 === 2
            const [sx, sy, sw, sh] = full ? [0, 0, w, h] : [Math.round(w * 0.05), Math.round(h * 0.2), Math.round(w * 0.9), Math.round(h * 0.6)]
            const k = full ? Math.min(1, 1280 / Math.max(w, h)) : 1
            canvas.width = Math.round(sw * k)
            canvas.height = Math.round(sh * k)
            ctx.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
            let text: string | null = null
            try {
              text = reader.decode(new BinaryBitmap(new HybridBinarizer(new HTMLCanvasElementLuminanceSource(canvas))), hints).getText()
            } catch {
              // rien sur cette image : on réessaie sur la suivante
            }
            if (text) {
              const r = readingFromBarcode(text)
              if (r) {
                done.current = true
                stop()
                onResult(r)
                return
              }
              setHint('Code lu, mais ce n’est pas un code-barres de produit. Visez le code-barres principal.')
            }
          }
          timer = setTimeout(tick, 80)
        }
        tick()
      } catch {
        if (!cancelled) setCamera('unavailable')
        stop()
      }
    })()
    return stop
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
