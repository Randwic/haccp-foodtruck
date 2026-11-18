// Liste exécutable des types d'enregistrement (miroir de RecordType).
import type { RecordType } from '../../../shared/types.ts'

export const RECORD_TYPES = [
  'system_test',
  'temperature_check',
  'cooling',
  'reheating',
  'hot_holding',
  'cooking_check',
  'thawing',
  'oil_check',
  'oil_change',
  'thermometer_check',
  'reception',
  'label_printed',
  'waste',
  'cleaning_done',
  'checklist_done',
  'corrective_action',
  'alert_ack',
  'correction',
] as const satisfies readonly RecordType[]
// Vérification à la compilation : la liste couvre tout RecordType.
type _MissingRecordType = Exclude<RecordType, (typeof RECORD_TYPES)[number]>
const _exhaustive: [_MissingRecordType] extends [never] ? true : never = true
void _exhaustive
