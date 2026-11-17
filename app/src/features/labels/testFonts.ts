// Tests uniquement : polices incluses en data URL (pas de serveur sous jsdom). Jamais importé par l'application.
import regular from './fonts/Inter-Regular.ttf?inline'
import bold from './fonts/Inter-Bold.ttf?inline'
import black from './fonts/Inter-Black.ttf?inline'
import display from '@fontsource/bowlby-one/files/bowlby-one-latin-400-normal.woff?inline'
import { setDisplayFontLoader, setFontBytesLoader, type FontWeight } from './fonts.ts'

const DATA: Record<FontWeight, string> = { regular, bold, black }

function decode(dataUrl: string): Uint8Array {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function useInlineFonts(): void {
  setFontBytesLoader(async (w) => decode(DATA[w]))
  setDisplayFontLoader(async () => decode(display))
}
