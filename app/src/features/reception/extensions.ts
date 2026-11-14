// Points d'extension du module Réception (hors périmètre du lot 3a, prévus pour la suite) :
//  - lecture automatique de l'étiquette (OCR du lot, de la DLC/DDM, du GTIN) à partir d'une photo ;
//  - scan du code-barres (GTIN) ;
//  - recherche de lot / procédure de rappel : voir `findByLot` dans ./model.ts.
// Rien n'est branché par défaut : l'interface n'affiche ces fonctions que si elles sont enregistrées.

/** Champs lus sur une étiquette (tous facultatifs ; dates au format AAAA-MM-JJ, GTIN 8 à 14 chiffres). */
export interface LabelReading {
  product?: string
  lot?: string
  dlc?: string
  ddm?: string
  gtin?: string
}

export interface ReceptionExtensions {
  /**
   * Appelée après chaque photo d'étiquette ajoutée à une ligne. Les champs renvoyés pré-remplissent
   * UNIQUEMENT les champs encore vides ; l'utilisateur voit « lu sur l'étiquette, à vérifier ».
   */
  readLabel?: (photo: Blob) => Promise<LabelReading | null>
  /** Ouvre un lecteur de code-barres ; renvoie le GTIN lu ou null (annulé). */
  scanBarcode?: () => Promise<string | null>
}

const registry: ReceptionExtensions = {}

/** Branche une extension (au démarrage de l'app, dans main.tsx). */
export function registerReceptionExtensions(ext: ReceptionExtensions): void {
  Object.assign(registry, ext)
}

export function receptionExtensions(): Readonly<ReceptionExtensions> {
  return registry
}

/** Réinitialisation (tests). */
export function resetReceptionExtensions(): void {
  delete registry.readLabel
  delete registry.scanBarcode
}
