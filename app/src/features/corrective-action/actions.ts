// Libellés des actions correctives du contrat (shared/payloads.ts, CorrectiveActionPayload.action).
import type { CorrectiveActionPayload } from '../../../../shared/payloads.ts'
import { CORRECTIVE_ACTIONS } from '../../../../shared/validation.ts'

export type CorrectiveActionKind = CorrectiveActionPayload['action']

export const CORRECTIVE_ACTION_LABELS: Record<CorrectiveActionKind, { label: string; hint: string }> = {
  adjust_equipment: { label: 'Équipement réglé', hint: 'Thermostat ajusté, porte refermée, joint ou dégivrage vérifié' },
  move_product: { label: 'Produits transférés', hint: 'Denrées déplacées vers une autre enceinte conforme' },
  discard: { label: 'Produits jetés', hint: 'Denrées concernées retirées et éliminées' },
  reheat: { label: 'Produits remis en température', hint: 'Réchauffés ou recuits jusqu’à la température requise' },
  call_technician: { label: 'Technicien appelé', hint: 'Panne signalée, intervention demandée' },
  other: { label: 'Autre action', hint: 'À décrire dans le commentaire (obligatoire)' },
}

/** Ordre d'affichage : du plus fréquent au plus rare, « Autre » en dernier. */
export const CORRECTIVE_ACTION_ORDER: readonly CorrectiveActionKind[] = [
  'adjust_equipment',
  'move_product',
  'discard',
  'reheat',
  'call_technician',
  'other',
]

// Garde-fou : l'ordre d'affichage couvre exactement les actions du contrat.
if (CORRECTIVE_ACTION_ORDER.length !== CORRECTIVE_ACTIONS.length || !CORRECTIVE_ACTIONS.every((a) => CORRECTIVE_ACTION_ORDER.includes(a))) {
  throw new Error('CORRECTIVE_ACTION_ORDER ne correspond pas au contrat')
}

export function correctiveActionLabel(action: unknown): string {
  return typeof action === 'string' && action in CORRECTIVE_ACTION_LABELS ? CORRECTIVE_ACTION_LABELS[action as CorrectiveActionKind].label : 'Action corrective'
}
