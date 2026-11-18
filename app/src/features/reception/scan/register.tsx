// Branchement de la lecture d'étiquette et du scan de code-barres (appelé une fois dans main.tsx).
// Tout est chargé à la demande : Tesseract et ZXing ne pèsent rien au démarrage de l'app.
import { lazy, Suspense } from 'react'
import { registerReceptionExtensions, type LabelReading } from '../extensions.ts'

const Scanner = lazy(() => import('./BarcodeScanner.tsx').then((m) => ({ default: m.BarcodeScanner })))

function LazyBarcodeScanner(props: { onResult: (r: LabelReading | null) => void }) {
  return (
    <Suspense fallback={null}>
      <Scanner {...props} />
    </Suspense>
  )
}

export function registerLabelScanning(): void {
  registerReceptionExtensions({
    readLabel: (photo) => import('./reader.ts').then((m) => m.readLabelPhoto(photo)),
    BarcodeScanner: LazyBarcodeScanner,
    warmUp: () => void import('./reader.ts').then((m) => m.warmUpLabelReader()).catch(() => {}),
  })
}
