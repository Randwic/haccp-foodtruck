// Validation des enregistrements du registre HACCP.
// TS pur, sans dépendance : utilisé par l'app (avant mise en file d'envoi) et par les Edge Functions
// (contrôle définitif côté serveur). Toute règle ajoutée ici s'applique donc des deux côtés.
import { ALLERGENS, PHOTO_PATH_RE } from './payloads.ts'
import type {
  Checklist,
  LabelPrintedPayload,
  MeasureSource,
  OilCheckPayload,
  ProcessStep,
  ReceptionItem,
  ThawingPayload,
  WastePayload,
} from './payloads.ts'
import type { EquipmentKind, RecordType, RejectReason } from './types.ts'

export type ValidationResult = { ok: true } | { ok: false; reason: RejectReason; detail: string }

/** Liste exhaustive des types du contrat (le `satisfies` casse la compilation si types.ts évolue). */
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
  'reception',
  'label_printed',
  'waste',
  'cleaning_done',
  'checklist_done',
  'corrective_action',
  'alert_ack',
  'correction',
] as const satisfies readonly RecordType[]
// Vérification inverse : tout RecordType doit figurer dans la liste.
type _Exhaustive = Exclude<RecordType, (typeof RECORD_TYPES)[number]> extends never ? true : never
const _exhaustive: _Exhaustive = true
void _exhaustive

/** Types dont le schéma de payload est défini (lots 1 à 6). Les autres sont refusés en `unknown_type`. */
export const SUPPORTED_RECORD_TYPES = [
  'system_test',
  'temperature_check',
  'corrective_action',
  'cooling',
  'reheating',
  'thawing',
  'hot_holding',
  'cooking_check',
  'reception',
  'waste',
  'label_printed',
  'cleaning_done',
  'checklist_done',
  'oil_check',
  'oil_change',
  'alert_ack',
  'correction',
] as const

export const CORRECTIVE_ACTIONS = [
  'discard',
  'reheat',
  'move_product',
  'adjust_equipment',
  'call_technician',
  'other',
] as const
export type CorrectiveActionKind = (typeof CORRECTIVE_ACTIONS)[number]

export const TEMPERATURE_SOURCES = ['manual', 'probe', 'sensor'] as const satisfies readonly MeasureSource[]
/** Étapes des procédés suivis (cooling, reheating) ; thawing n'a que start et end. */
export const PROCESS_STEPS = ['start', 'check', 'end'] as const satisfies readonly ProcessStep[]
export const THAWING_STEPS = ['start', 'end'] as const satisfies readonly ThawingPayload['step'][]
/** Lot 3 : conservation exigée d'un produit livré, motifs de perte / anomalie. */
export const STORAGE_KINDS = ['fridge', 'freezer', 'ambient'] as const satisfies readonly ReceptionItem['storage'][]
export const WASTE_REASONS = ['expired', 'non_compliant', 'temperature', 'damaged', 'recall', 'other'] as const satisfies readonly WastePayload['reason'][]
/** Lot 4 : nature d'une étiquette imprimée. */
export const LABEL_KINDS = ['opened', 'prepared', 'thawed'] as const satisfies readonly LabelPrintedPayload['kind'][]
/** Lot 5 : méthode de mesure des composés polaires, nature d'une checklist. */
export const OIL_METHODS = ['tester', 'strip'] as const satisfies readonly OilCheckPayload['method'][]
export const CHECKLIST_KINDS = ['opening', 'closing', 'pest_control', 'other'] as const satisfies readonly Checklist['kind'][]
/** Identifiant stable d'un point de checklist (ChecklistItem.id). */
export const CHECKLIST_ITEM_ID_RE = /^[a-z0-9_-]{1,40}$/

export const LIMITS = {
  noteMax: 500,
  reasonMax: 500,
  commentMax: 1000,
  photoPathMax: 300,
  productMax: 80,
  /** duration_min des procédés (minutes depuis 'start'). */
  durationMaxMin: 1440,
  /** Lot 3 (réception, pertes) — bornes de shared/payloads.ts. */
  receptionItemsMax: 50,
  photoPathsMax: 5,
  lotMax: 40,
  deliveryNoteMax: 40,
  quantityMax: 40,
  refusalReasonMax: 200,
  receptionCommentMax: 500,
  wasteCommentMax: 500,
  /** Lot 4 (étiquettes) — bornes de shared/payloads.ts. */
  labelNameMax: 80,
  labelCopiesMax: 20,
  labelSourceRecordsMax: 20,
  /** dlc_at − made_at : au plus 90 jours. */
  labelMaxShelfLifeMs: 90 * 24 * 3_600_000,
  /** Lot 5 (nettoyage, checklists, huiles) — bornes de shared/payloads.ts. */
  cleaningCommentMax: 300,
  cleaningPhotosMax: 3,
  checklistAnswersMax: 40,
  /** Commentaire d'un point de checklist (borne non précisée par le contrat : alignée sur les autres commentaires du lot). */
  checklistCommentMax: 300,
  oilCommentMax: 300,
  /** Lot 6 (prise en compte d'une alerte) — borne de shared/payloads.ts. */
  alertAckCommentMax: 300,
  polarMin: 0,
  polarMax: 50,
  valueMinC: -50,
  valueMaxC: 300,
  /** Taille max du payload sérialisé (caractères JSON canonique, approximé par JSON.stringify). */
  payloadMaxChars: 16_000,
  maxDepth: 6,
} as const

// uuid v4 en minuscules : Postgres renvoie les uuid en minuscules, une majuscule casserait le hash.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
// uuid quelconque (références générées par la base ou le seed), toujours en minuscules.
const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HEX64 = /^[0-9a-f]{64}$/
const ISO_MS_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function isUuidV4(v: unknown): v is string {
  return typeof v === 'string' && UUID_V4.test(v)
}
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_ANY.test(v)
}
export function isHex64(v: unknown): v is string {
  return typeof v === 'string' && HEX64.test(v)
}
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}
/**
 * `device_time` doit être exactement `new Date(x).toISOString()` : c'est la seule forme qui survit
 * à l'aller-retour timestamptz (précision ms, UTC, suffixe Z) et garde le hash reproductible.
 */
export function isCanonicalIsoTime(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_MS_UTC.test(v)) return false
  const d = new Date(v)
  return !Number.isNaN(d.getTime()) && d.toISOString() === v
}

const ok: ValidationResult = { ok: true }
function fail(detail: string, reason: RejectReason = 'invalid_payload'): ValidationResult {
  return { ok: false, reason, detail }
}

function has(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k)
}

function charLength(s: string): number {
  return [...s].length
}

// ---------- Forme de l'enregistrement ----------

const RECORD_KEYS = new Set([
  'id',
  'type',
  'payload',
  'author_id',
  'device_id',
  'device_seq',
  'device_time',
  'prev_hash',
  'supersedes_id',
  'hash',
  'server_time', // toléré (ignoré : posé par le serveur)
])

/**
 * Contrôle « stockable et chaînable » : tout ce qu'il faut pour recalculer le hash, vérifier la
 * chaîne et insérer la ligne en base (colonnes uuid / timestamptz / jsonb). Le type n'a qu'à être
 * un identifiant court : un type inconnu reste stockable (le serveur le met alors en quarantaine).
 * Raisons possibles : `invalid_hash` (format du hash) ou `invalid_payload`.
 */
export function validateRecordStructure(r: unknown): ValidationResult {
  if (!isPlainObject(r)) return fail('enregistrement : objet attendu', 'invalid_record')
  for (const k of Object.keys(r)) {
    if (!RECORD_KEYS.has(k)) return fail(`champ inconnu : ${k.slice(0, 40)}`, 'invalid_record')
  }
  if (!isUuidV4(r.id)) return fail('id : uuid v4 en minuscules attendu', 'invalid_record')
  if (typeof r.type !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(r.type)) {
    return fail('type : identifiant attendu ([a-z0-9_], 40 caractères max)', 'invalid_record')
  }
  if (!isPlainObject(r.payload)) return fail('payload : objet attendu', 'invalid_record')
  const safe = checkJsonSafe(r.payload, 'payload', 0)
  if (safe) return fail(safe, 'invalid_record')
  if (JSON.stringify(r.payload).length > LIMITS.payloadMaxChars) return fail('payload : trop volumineux', 'invalid_record')
  if (!isUuid(r.author_id)) return fail('author_id : uuid en minuscules attendu', 'invalid_record')
  if (!isUuid(r.device_id)) return fail('device_id : uuid en minuscules attendu', 'invalid_record')
  if (typeof r.device_seq !== 'number' || !Number.isSafeInteger(r.device_seq) || r.device_seq < 1) {
    return fail('device_seq : entier ≥ 1 attendu', 'invalid_record')
  }
  if (!isCanonicalIsoTime(r.device_time)) {
    return fail('device_time : format ISO UTC canonique attendu (new Date(x).toISOString())', 'invalid_record')
  }
  if (!isHex64(r.prev_hash)) return fail('prev_hash : 64 caractères hexadécimaux minuscules attendus', 'invalid_record')
  if (!isHex64(r.hash)) return fail('hash : 64 caractères hexadécimaux minuscules attendus', 'invalid_hash')
  if (r.supersedes_id !== null && !isUuid(r.supersedes_id)) return fail('supersedes_id : null ou uuid en minuscules attendu', 'invalid_record')
  if (r.server_time !== undefined && typeof r.server_time !== 'string') return fail('server_time : chaîne attendue', 'invalid_record')
  return ok
}

/** Règles de contenu de l'enveloppe : type du contrat, supersedes_id cohérent avec le type. */
export function validateRecordSemantics(r: { type: string; supersedes_id: string | null }): ValidationResult {
  if (!(RECORD_TYPES as readonly string[]).includes(r.type)) return fail(`type inconnu : ${r.type.slice(0, 40)}`, 'unknown_type')
  if (r.type === 'correction') {
    if (r.supersedes_id === null) return fail('supersedes_id : obligatoire (uuid) pour une correction')
  } else if (r.supersedes_id !== null) {
    return fail('supersedes_id : doit être null hors correction')
  }
  return ok
}

/**
 * Forme complète d'un HaccpRecord (structure + règles de l'enveloppe), hors contenu du payload.
 * Raisons possibles : `unknown_type`, `invalid_hash` (format du hash), `invalid_payload` (le reste).
 * Utilisée par l'app avant mise en file d'envoi.
 */
export function validateRecordShape(r: unknown): ValidationResult {
  if (isPlainObject(r) && typeof r.type === 'string' && !(RECORD_TYPES as readonly string[]).includes(r.type)) {
    return fail(`type inconnu : ${r.type.slice(0, 40)}`, 'unknown_type')
  }
  const s = validateRecordStructure(r)
  if (!s.ok) return s
  return validateRecordSemantics(r as { type: string; supersedes_id: string | null })
}

// ---------- Contrôles génériques du payload ----------

/** Refuse ce que jsonb ou le hash ne peuvent pas représenter fidèlement. */
function checkJsonSafe(v: unknown, path: string, depth: number): string | null {
  if (depth > LIMITS.maxDepth) return `${path} : imbrication trop profonde`
  if (v === null || typeof v === 'boolean') return null
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path} : nombre non fini`
  if (typeof v === 'string') {
    // jsonb refuse \u0000 ; un demi-surrogate isolé n'est pas de l'UTF-8 valide.
    if (v.includes('\u0000')) return `${path} : caractère nul interdit`
    if (/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(v)) {
      return `${path} : texte unicode invalide`
    }
    return null
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const e = checkJsonSafe(v[i], `${path}[${i}]`, depth + 1)
      if (e) return e
    }
    return null
  }
  if (isPlainObject(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined) return `${path}.${k} : undefined interdit`
      const e = checkJsonSafe(k, `${path}.<clé>`, depth + 1) ?? checkJsonSafe(x, `${path}.${k}`, depth + 1)
      if (e) return e
    }
    return null
  }
  return `${path} : type non supporté`
}

// ---------- Mini-schémas ----------

type FieldCheck = (v: unknown, name: string) => string | null
interface FieldSpec {
  check: FieldCheck
  optional?: boolean
}

function checkObject(payload: Record<string, unknown>, spec: Record<string, FieldSpec>, path = 'payload'): string | null {
  for (const k of Object.keys(payload)) {
    if (!(k in spec)) return `${path}.${k} : champ inconnu`
  }
  for (const [k, s] of Object.entries(spec)) {
    const present = has(payload, k)
    if (!present) {
      if (s.optional) continue
      return `${path}.${k} : obligatoire`
    }
    const e = s.check(payload[k], `${path}.${k}`)
    if (e) return e
  }
  return null
}

const str =
  (opts: { max: number; nonEmpty?: boolean }): FieldCheck =>
  (v, name) => {
    if (typeof v !== 'string') return `${name} : texte attendu`
    if (opts.nonEmpty && v.trim().length === 0) return `${name} : ne doit pas être vide`
    if (charLength(v) > opts.max) return `${name} : ${opts.max} caractères maximum`
    return null
  }
const uuidField: FieldCheck = (v, name) => (isUuid(v) ? null : `${name} : uuid en minuscules attendu`)
const boolField: FieldCheck = (v, name) => (typeof v === 'boolean' ? null : `${name} : booléen attendu`)
const oneOf =
  (values: readonly string[]): FieldCheck =>
  (v, name) =>
    typeof v === 'string' && values.includes(v) ? null : `${name} : valeur attendue parmi ${values.join(', ')}`
const temperatureField: FieldCheck = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return `${name} : nombre attendu`
  if (v < LIMITS.valueMinC || v > LIMITS.valueMaxC) return `${name} : entre ${LIMITS.valueMinC} et ${LIMITS.valueMaxC} °C`
  if (Math.round(v * 10) / 10 !== v) return `${name} : une décimale maximum`
  return null
}
const photoPathField: FieldCheck = (v, name) => {
  const e = str({ max: LIMITS.photoPathMax, nonEmpty: true })(v, name)
  if (e) return e
  const s = v as string
  // Chemin relatif dans le bucket Storage, sans remontée ni caractères exotiques.
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(s) || s.includes('..') || s.includes('//')) {
    return `${name} : chemin de fichier invalide`
  }
  return null
}

const productField = str({ max: LIMITS.productMax, nonEmpty: true })
/** Chemin de photo du lot 3 : `<device_id>/<uuid>.webp` (PHOTO_PATH_RE du contrat). */
const photoRefField: FieldCheck = (v, name) =>
  typeof v === 'string' && PHOTO_PATH_RE.test(v) ? null : `${name} : chemin de photo <appareil>/<uuid>.webp attendu`
const arrayOf =
  (item: FieldCheck, opts: { min: number; max: number }): FieldCheck =>
  (v, name) => {
    if (!Array.isArray(v)) return `${name} : tableau attendu`
    if (v.length < opts.min) return `${name} : ${opts.min} élément(s) minimum`
    if (v.length > opts.max) return `${name} : ${opts.max} éléments maximum`
    for (let i = 0; i < v.length; i++) {
      const e = item(v[i], `${name}[${i}]`)
      if (e) return e
    }
    return null
  }
const photoPathsField = arrayOf(photoRefField, { min: 0, max: LIMITS.photoPathsMax })
const gtinField: FieldCheck = (v, name) => (typeof v === 'string' && /^\d{8,14}$/.test(v) ? null : `${name} : 8 à 14 chiffres attendus`)
const durationField: FieldCheck = (v, name) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= LIMITS.durationMaxMin
    ? null
    : `${name} : entier de 0 à ${LIMITS.durationMaxMin} attendu`
/** Date civile AAAA-MM-JJ réelle (refuse 2026-02-30). */
const dateField: FieldCheck = (v, name) => {
  const bad = `${name} : date AAAA-MM-JJ attendue`
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return bad
  const d = new Date(`${v}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? null : bad
}

const isoTimeField: FieldCheck = (v, name) =>
  isCanonicalIsoTime(v) ? null : `${name} : date-heure ISO UTC canonique attendue (new Date(x).toISOString())`
/** Allergènes : codes de ALLERGENS (annexe II INCO 1169/2011), sans doublon. */
const allergensField: FieldCheck = (v, name) => {
  const e = arrayOf(oneOf(ALLERGENS), { min: 0, max: ALLERGENS.length })(v, name)
  if (e) return e
  return new Set(v as string[]).size === (v as string[]).length ? null : `${name} : allergène en double`
}
const copiesField: FieldCheck = (v, name) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= LIMITS.labelCopiesMax
    ? null
    : `${name} : entier de 1 à ${LIMITS.labelCopiesMax} attendu`

/** Composés polaires : 0..50 %, une décimale. */
const polarField: FieldCheck = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return `${name} : nombre attendu`
  if (v < LIMITS.polarMin || v > LIMITS.polarMax) return `${name} : entre ${LIMITS.polarMin} et ${LIMITS.polarMax} %`
  if (Math.round(v * 10) / 10 !== v) return `${name} : une décimale maximum`
  return null
}
const checklistItemIdField: FieldCheck = (v, name) =>
  typeof v === 'string' && CHECKLIST_ITEM_ID_RE.test(v) ? null : `${name} : identifiant de point attendu ([a-z0-9_-], 1 à 40 caractères)`
/** Réponse à un point de checklist : un « non » exige un commentaire non vide. */
const CHECKLIST_ANSWER_SCHEMA: Record<string, FieldSpec> = {
  item_id: { check: checklistItemIdField },
  ok: { check: boolField },
  comment: { check: str({ max: LIMITS.checklistCommentMax }), optional: true },
}
const checklistAnswerField: FieldCheck = (v, name) => {
  if (!isPlainObject(v)) return `${name} : objet attendu`
  const e = checkObject(v, CHECKLIST_ANSWER_SCHEMA, name)
  if (e) return e
  if (v.ok === false && (typeof v.comment !== 'string' || v.comment.trim() === '')) {
    return `${name}.comment : obligatoire quand le point n’est pas conforme (ok = false)`
  }
  return null
}

/** Une ligne de livraison (ReceptionItem). */
const RECEPTION_ITEM_SCHEMA: Record<string, FieldSpec> = {
  product: { check: productField },
  lot: { check: str({ max: LIMITS.lotMax, nonEmpty: true }), optional: true },
  dlc: { check: dateField, optional: true },
  ddm: { check: dateField, optional: true },
  gtin: { check: gtinField, optional: true },
  temperature_c: { check: temperatureField, optional: true },
  storage: { check: oneOf(STORAGE_KINDS) },
  accepted: { check: boolField },
  refusal_reason: { check: str({ max: LIMITS.refusalReasonMax, nonEmpty: true }), optional: true },
  photo_paths: { check: photoPathsField, optional: true },
}
const receptionItemField: FieldCheck = (v, name) => {
  if (!isPlainObject(v)) return `${name} : objet attendu`
  const e = checkObject(v, RECEPTION_ITEM_SCHEMA, name)
  if (e) return e
  if (v.accepted === false && !has(v, 'refusal_reason')) return `${name}.refusal_reason : obligatoire si le produit est refusé`
  return null
}

/** cooling / reheating (même forme). in_range et duration_min : facultatifs, sauf à 'end'. */
const PROCESS_SCHEMA: Record<string, FieldSpec> = {
  batch_id: { check: uuidField },
  step: { check: oneOf(PROCESS_STEPS) },
  product: { check: productField },
  value_c: { check: temperatureField },
  source: { check: oneOf(TEMPERATURE_SOURCES) },
  in_range: { check: boolField, optional: true },
  duration_min: { check: durationField, optional: true },
}

type SchemaType =
  | 'system_test'
  | 'temperature_check'
  | 'corrective_action'
  | 'cooling'
  | 'reheating'
  | 'thawing'
  | 'hot_holding'
  | 'cooking_check'
  | 'reception'
  | 'waste'
  | 'label_printed'
  | 'cleaning_done'
  | 'checklist_done'
  | 'oil_check'
  | 'oil_change'
  | 'alert_ack'

const SCHEMAS: Record<SchemaType, Record<string, FieldSpec>> = {
  system_test: {
    note: { check: str({ max: LIMITS.noteMax }) },
  },
  temperature_check: {
    equipment_id: { check: uuidField },
    value_c: { check: temperatureField },
    source: { check: oneOf(TEMPERATURE_SOURCES) },
    in_range: { check: boolField },
    corrective_action_id: { check: uuidField, optional: true },
  },
  corrective_action: {
    related_record_id: { check: uuidField },
    action: { check: oneOf(CORRECTIVE_ACTIONS) },
    comment: { check: str({ max: LIMITS.commentMax }) },
    photo_path: { check: photoPathField, optional: true },
  },
  cooling: PROCESS_SCHEMA,
  reheating: PROCESS_SCHEMA,
  thawing: {
    batch_id: { check: uuidField },
    step: { check: oneOf(THAWING_STEPS) },
    product: { check: productField },
    equipment_id: { check: uuidField },
    dlc: { check: dateField, optional: true },
  },
  hot_holding: {
    product: { check: productField },
    value_c: { check: temperatureField },
    source: { check: oneOf(TEMPERATURE_SOURCES) },
    in_range: { check: boolField },
    equipment_id: { check: uuidField, optional: true },
  },
  cooking_check: {
    product: { check: productField },
    value_c: { check: temperatureField },
    source: { check: oneOf(TEMPERATURE_SOURCES) },
    in_range: { check: boolField },
  },
  reception: {
    supplier_id: { check: uuidField },
    delivery_note: { check: str({ max: LIMITS.deliveryNoteMax, nonEmpty: true }), optional: true },
    vehicle_ok: { check: boolField },
    packaging_ok: { check: boolField },
    items: { check: arrayOf(receptionItemField, { min: 1, max: LIMITS.receptionItemsMax }) },
    photo_paths: { check: photoPathsField, optional: true },
    comment: { check: str({ max: LIMITS.receptionCommentMax }), optional: true },
  },
  waste: {
    product: { check: productField },
    lot: { check: str({ max: LIMITS.lotMax, nonEmpty: true }), optional: true },
    quantity: { check: str({ max: LIMITS.quantityMax, nonEmpty: true }), optional: true },
    reason: { check: oneOf(WASTE_REASONS) },
    comment: { check: str({ max: LIMITS.wasteCommentMax }), optional: true },
    related_record_id: { check: uuidField, optional: true },
    photo_paths: { check: photoPathsField, optional: true },
  },
  label_printed: {
    kind: { check: oneOf(LABEL_KINDS) },
    product_id: { check: uuidField, optional: true },
    recipe_id: { check: uuidField, optional: true },
    name: { check: str({ max: LIMITS.labelNameMax, nonEmpty: true }) },
    made_at: { check: isoTimeField },
    dlc_at: { check: isoTimeField },
    allergens: { check: allergensField },
    storage: { check: oneOf(STORAGE_KINDS) },
    lot: { check: str({ max: LIMITS.lotMax, nonEmpty: true }), optional: true },
    source_record_ids: { check: arrayOf(uuidField, { min: 0, max: LIMITS.labelSourceRecordsMax }), optional: true },
    copies: { check: copiesField },
  },
  cleaning_done: {
    task_id: { check: uuidField },
    comment: { check: str({ max: LIMITS.cleaningCommentMax }), optional: true },
    photo_paths: { check: arrayOf(photoRefField, { min: 0, max: LIMITS.cleaningPhotosMax }), optional: true },
  },
  checklist_done: {
    checklist_id: { check: uuidField },
    answers: { check: arrayOf(checklistAnswerField, { min: 1, max: LIMITS.checklistAnswersMax }) },
    all_ok: { check: boolField },
  },
  oil_check: {
    equipment_id: { check: uuidField },
    polar_percent: { check: polarField },
    method: { check: oneOf(OIL_METHODS) },
    in_range: { check: boolField },
  },
  oil_change: {
    equipment_id: { check: uuidField },
    comment: { check: str({ max: LIMITS.oilCommentMax }), optional: true },
  },
  alert_ack: {
    alert_id: { check: uuidField },
    comment: { check: str({ max: LIMITS.alertAckCommentMax }), optional: true },
    corrective_action_id: { check: uuidField, optional: true },
  },
}

/**
 * Équipement référencé par un payload valide (pour le contrôle d'existence côté serveur), ou null.
 * temperature_check, thawing, oil_check, oil_change : obligatoire ; hot_holding : facultatif.
 */
export function referencedEquipmentId(type: RecordType | string, payload: Record<string, unknown>): string | null {
  if (type === 'temperature_check' || type === 'thawing' || type === 'hot_holding' || type === 'oil_check' || type === 'oil_change') {
    return typeof payload.equipment_id === 'string' ? payload.equipment_id : null
  }
  return null
}

/** Nature d'équipement exigée par le type (huiles : bac de friteuse), ou null si indifférente. */
export function requiredEquipmentKind(type: RecordType | string): EquipmentKind | null {
  return type === 'oil_check' || type === 'oil_change' ? 'fryer_vat' : null
}

/** Tâche du plan de nettoyage référencée (`cleaning_done.task_id`), ou null. */
export function referencedCleaningTaskId(type: RecordType | string, payload: Record<string, unknown>): string | null {
  return type === 'cleaning_done' && typeof payload.task_id === 'string' ? payload.task_id : null
}

/**
 * Checklist référencée (`checklist_done.checklist_id`), ou null. Le serveur vérifie qu'elle existe
 * (même désactivée), mais PAS que chaque `answers[].item_id` figure dans sa version actuelle : la
 * checklist a pu changer pendant une tournée hors réseau ; l'enregistrement atteste les réponses données.
 */
export function referencedChecklistId(type: RecordType | string, payload: Record<string, unknown>): string | null {
  return type === 'checklist_done' && typeof payload.checklist_id === 'string' ? payload.checklist_id : null
}

/**
 * Produit / recette référencés par une étiquette valide (`label_printed`), ou null.
 * Le serveur vérifie leur existence (même désactivés : saisie hors réseau), mais PAS que les
 * allergènes imprimés correspondent à la fiche actuelle : la fiche a pu changer depuis l'impression,
 * et l'étiquette atteste ce qui a été imprimé.
 */
export function referencedProductId(type: RecordType | string, payload: Record<string, unknown>): string | null {
  return type === 'label_printed' && typeof payload.product_id === 'string' ? payload.product_id : null
}
export function referencedRecipeId(type: RecordType | string, payload: Record<string, unknown>): string | null {
  return type === 'label_printed' && typeof payload.recipe_id === 'string' ? payload.recipe_id : null
}

/**
 * Alerte prise en compte (`alert_ack.alert_id`), ou null. Le serveur exige qu'elle existe
 * (sinon quarantaine `invalid_payload`) ; `corrective_action_id` n'est pas vérifié (choix : l'action
 * corrective est un enregistrement du registre, éventuellement envoyé dans le même lot ou plus tard).
 */
export function referencedAlertId(type: RecordType | string, payload: Record<string, unknown>): string | null {
  return type === 'alert_ack' && typeof payload.alert_id === 'string' ? payload.alert_id : null
}

/** Fournisseur référencé par un payload valide (réception), ou null. */
export function referencedSupplierId(type: RecordType | string, payload: Record<string, unknown>): string | null {
  return type === 'reception' && typeof payload.supplier_id === 'string' ? payload.supplier_id : null
}

/**
 * Chemins de photos (lot 3, `<device_id>/<uuid>.webp`) référencés par un payload valide :
 * `photo_paths` (reception, waste, cleaning_done) et `items[].photo_paths` (reception). Sans doublon.
 * Le `photo_path` libre de corrective_action (lot 2) n'est pas concerné.
 */
/** Plafond total de photos d'une réception (reste sous la limite de taille d'un payload). */
export const RECEPTION_MAX_PHOTOS = 20

export function referencedPhotoPaths(type: RecordType | string, payload: Record<string, unknown>): string[] {
  if (type !== 'reception' && type !== 'waste' && type !== 'cleaning_done') return []
  const out = new Set<string>()
  const add = (v: unknown) => {
    if (Array.isArray(v)) for (const p of v) if (typeof p === 'string') out.add(p)
  }
  add(payload.photo_paths)
  if (type === 'reception' && Array.isArray(payload.items)) {
    for (const it of payload.items) if (isPlainObject(it)) add(it.photo_paths)
  }
  return [...out]
}

export interface PayloadContext {
  /**
   * Pour `correction` : type de l'enregistrement corrigé (le serveur le lit en base).
   * Absent : seule la structure de `replacement` (objet) est vérifiée.
   */
  supersededType?: RecordType
}

/** Valide le payload d'un enregistrement selon son type. */
export function validatePayload(type: RecordType | string, payload: unknown, ctx: PayloadContext = {}): ValidationResult {
  if (!(RECORD_TYPES as readonly string[]).includes(type)) return fail(`type inconnu : ${String(type).slice(0, 40)}`, 'unknown_type')
  if (!(SUPPORTED_RECORD_TYPES as readonly string[]).includes(type)) {
    return fail(`type « ${type} » pas encore pris en charge`, 'unknown_type')
  }
  if (!isPlainObject(payload)) return fail('payload : objet attendu')
  const safe = checkJsonSafe(payload, 'payload', 0)
  if (safe) return fail(safe)
  if (JSON.stringify(payload).length > LIMITS.payloadMaxChars) return fail('payload : trop volumineux')

  if (type === 'correction') return validateCorrection(payload, ctx)

  const schema = SCHEMAS[type as keyof typeof SCHEMAS]
  const e = checkObject(payload, schema)
  if (e) return fail(e)
  if (type === 'reception' && referencedPhotoPaths(type, payload).length > RECEPTION_MAX_PHOTOS) {
    return fail(`photos : ${RECEPTION_MAX_PHOTOS} au maximum par réception (toutes lignes confondues)`)
  }

  if (type === 'corrective_action' && payload.action === 'other' && (payload.comment as string).trim() === '') {
    return fail('payload.comment : obligatoire quand l’action est « other »')
  }
  if ((type === 'cooling' || type === 'reheating') && payload.step === 'end') {
    if (!has(payload, 'in_range')) return fail('payload.in_range : obligatoire à l’étape « end »')
    if (!has(payload, 'duration_min')) return fail('payload.duration_min : obligatoire à l’étape « end »')
  }
  if (type === 'thawing' && payload.step === 'end' && !has(payload, 'dlc')) {
    return fail('payload.dlc : obligatoire à l’étape « end »')
  }
  if (type === 'label_printed') {
    const e = checkLabel(payload)
    if (e) return fail(e)
  }
  if (type === 'checklist_done') {
    const e = checkChecklistDone(payload)
    if (e) return fail(e)
  }
  if (type === 'waste' && payload.reason === 'other' && (typeof payload.comment !== 'string' || payload.comment.trim() === '')) {
    return fail('payload.comment : obligatoire quand le motif est « other »')
  }
  // Pas de contrôle de cohérence in_range / seuils : l'app calcule in_range avec le seuil en vigueur
  // au moment de la saisie (éventuellement hors réseau) ; le serveur ne peut pas le rejuger.
  return ok
}

/**
 * Règles croisées d'une checklist remplie : `item_id` uniques, `all_ok` = tous les points ok.
 * L'appartenance des `item_id` à la checklist n'est pas vérifiée (voir referencedChecklistId).
 */
function checkChecklistDone(p: Record<string, unknown>): string | null {
  const answers = p.answers as { item_id: string; ok: boolean }[]
  const seen = new Set<string>()
  for (let i = 0; i < answers.length; i++) {
    if (seen.has(answers[i].item_id)) return `payload.answers[${i}].item_id : point en double (${answers[i].item_id})`
    seen.add(answers[i].item_id)
  }
  const allOk = answers.every((a) => a.ok)
  if (p.all_ok !== allOk) return `payload.all_ok : doit valoir ${allOk} (tous les points ok)`
  return null
}

/** Règles croisées d'une étiquette (champs déjà validés un à un). */
function checkLabel(p: Record<string, unknown>): string | null {
  if (p.kind === 'prepared') {
    if (!has(p, 'recipe_id')) return 'payload.recipe_id : obligatoire pour une préparation (kind = prepared)'
    if (has(p, 'product_id')) return 'payload.product_id : interdit pour une préparation (kind = prepared)'
  } else {
    if (!has(p, 'product_id')) return `payload.product_id : obligatoire pour kind = ${String(p.kind)}`
    if (has(p, 'recipe_id')) return `payload.recipe_id : interdit pour kind = ${String(p.kind)}`
  }
  const made = new Date(p.made_at as string).getTime()
  const dlc = new Date(p.dlc_at as string).getTime()
  if (dlc <= made) return 'payload.dlc_at : doit être postérieure à made_at'
  if (dlc - made > LIMITS.labelMaxShelfLifeMs) return 'payload.dlc_at : au plus 90 jours après made_at'
  return null
}

function validateCorrection(payload: Record<string, unknown>, ctx: PayloadContext): ValidationResult {
  const e = checkObject(payload, {
    reason: { check: str({ max: LIMITS.reasonMax, nonEmpty: true }) },
    replacement: { check: (v, name) => (isPlainObject(v) ? null : `${name} : objet attendu`) },
  })
  if (e) return fail(e)
  const target = ctx.supersededType
  if (target === undefined) return ok
  if (target === 'correction') {
    // Le serveur remonte la chaîne jusqu'à l'original : on ne valide jamais un remplacement « de correction ».
    return fail('replacement : le type corrigé doit être celui de l’enregistrement d’origine')
  }
  const inner = validatePayload(target, payload.replacement)
  if (!inner.ok) {
    return fail(`replacement (${target}) : ${inner.detail.replace(/^payload/, 'replacement')}`, inner.reason === 'unknown_type' ? 'unknown_type' : 'invalid_payload')
  }
  return ok
}
