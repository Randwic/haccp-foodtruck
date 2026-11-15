// Impression depuis Safari iOS vers l'imprimante AirPrint (Brother QL-820NWB, rouleau 62 mm).
//
// Méthode principale — PDF au format exact + feuille de partage iOS (`navigator.share({ files })`) :
//   l'utilisateur touche « Imprimer » dans la feuille de partage, choisit l'imprimante ; iOS respecte la taille
//   de page du PDF (62 mm × hauteur) et le rouleau continu de la Brother. Fonctionne aussi dans l'app installée
//   sur l'écran d'accueil (mode standalone), où `window.open` d'un PDF est peu fiable. Le PDF est généré AVANT
//   le toucher (aperçu), car Safari n'autorise le partage que pendant le geste de l'utilisateur.
// Repli (ordinateur, navigateur sans partage de fichiers) : le PDF s'ouvre dans un nouvel onglet (visionneuse
//   avec bouton Imprimer), sinon il est téléchargé.
// Secours — « Impression directe » : `window.print()` sur une vue dédiée (`@page { size: 62mm <h>mm; margin: 0 }`,
//   une page par copie). Safari iOS applique la taille de page de façon moins sûre (selon la version, il peut
//   ajouter des marges ou mettre à l'échelle) : à utiliser si la feuille de partage n'est pas disponible.

export type ShareOutcome = 'shared' | 'cancelled' | 'opened' | 'downloaded'

function pdfFile(bytes: Uint8Array, filename: string): File {
  return new File([bytes.slice().buffer as ArrayBuffer], filename, { type: 'application/pdf' })
}

/** Le navigateur sait-il partager un fichier PDF (feuille de partage iOS / Android) ? */
export function canSharePdf(): boolean {
  try {
    const probe = new File([new Uint8Array([37])], 'x.pdf', { type: 'application/pdf' })
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [probe] }) === true
  } catch {
    return false
  }
}

/** Partage (→ Imprimer) ou ouvre le PDF. À appeler directement dans le gestionnaire du toucher. */
export async function sharePdf(bytes: Uint8Array, filename: string, title: string): Promise<ShareOutcome> {
  const file = pdfFile(bytes, filename)
  if (canSharePdf()) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // NotAllowedError (geste expiré) : repli sur l'ouverture.
    }
  }
  const url = URL.createObjectURL(file)
  setTimeout(() => URL.revokeObjectURL(url), 120_000)
  const w = window.open(url, '_blank')
  if (w) return 'opened'
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  return 'downloaded'
}

/** Nom de fichier lisible : « etiquette-sauce-burger-1511-1430.pdf ». */
export function pdfFilename(prefix: string, name: string, suffix = ''): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `${prefix}-${slug || 'document'}${suffix ? `-${suffix}` : ''}.pdf`
}
