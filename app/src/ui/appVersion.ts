// Version de l'application : date et heure de sa construction (remplie au build par vite.config.ts).
// Affichée dans l'Aide, pour vérifier que l'iPad a bien reçu la dernière mise à jour.
declare const __APP_BUILD_TIME__: string | undefined

export const APP_BUILD_TIME: string | null = typeof __APP_BUILD_TIME__ === 'string' ? __APP_BUILD_TIME__ : null

/** « 27/11/2026 à 17:50 » (heure de l'appareil), ou null hors build (tests). */
export function appVersionLabel(iso: string | null = APP_BUILD_TIME): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return `${date} à ${time}`
}
