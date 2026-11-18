// Points d'extension du module Réception :
//  - lecture automatique de l'étiquette (OCR du lot, de la DLC/DDM, code-barres) à partir d'une photo ;
//  - scan du code-barres (GTIN, et lot + date pour un code GS1).
// Branchés au démarrage (main.tsx) avec ./scan/ ; rien par défaut (tests) : l'interface n'affiche
// ces fonctions que si elles sont enregistrées.
import type { ComponentType } from 'react'

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
  /** Lecteur de code-barres (fenêtre) : appelle onResult avec la lecture, ou null si annulé. */
  BarcodeScanner?: ComponentType<{ onResult: (r: LabelReading | null) => void }>
  /** Préparation en arrière-plan de la lecture d'étiquette (cache hors-ligne), à l'ouverture de la saisie. */
  warmUp?: () => void
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
  delete registry.BarcodeScanner
  delete registry.warmUp
}
