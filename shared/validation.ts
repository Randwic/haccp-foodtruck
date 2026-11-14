// Validation des enregistrements du registre HACCP.
// TS pur, sans dépendance : utilisé par l'app (avant mise en file d'envoi) et par les Edge Functions
// (contrôle définitif côté serveur). Toute règle ajoutée ici s'applique donc des deux côtés.
import type { MeasureSource, ProcessStep, ThawingPayload } from './payloads.ts'
import type { RecordType, RejectReason } from './types.ts'

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

/** Types dont le schéma de payload est défini (lot 1-2). Les autres sont refusés en `unknown_type`. */
export const SUPPORTED_RECORD_TYPES = [
  'system_test',
  'temperature_check',
  'corrective_action',
  'cooling',
  'reheating',
  'thawing',
  'hot_holding',
  'cooking_check',
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

export const LIMITS = {
  noteMax: 500,
  reasonMax: 500,
  commentMax: 1000,
  photoPathMax: 300,
  productMax: 80,
  /** duration_min des procédés (minutes depuis 'start'). */
  durationMaxMin: 1440,
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

type SchemaType = 'system_test' | 'temperature_check' | 'corrective_action' | 'cooling' | 'reheating' | 'thawing' | 'hot_holding' | 'cooking_check'

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
}

/**
 * Équipement référencé par un payload valide (pour le contrôle d'existence côté serveur), ou null.
 * temperature_check et thawing : obligatoire ; hot_holding : facultatif.
 */
export function referencedEquipmentId(type: RecordType | string, payload: Record<string, unknown>): string | null {
  if (type === 'temperature_check' || type === 'thawing' || type === 'hot_holding') {
    return typeof payload.equipment_id === 'string' ? payload.equipment_id : null
  }
  return null
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
  // Pas de contrôle de cohérence in_range / seuils : l'app calcule in_range avec le seuil en vigueur
  // au moment de la saisie (éventuellement hors réseau) ; le serveur ne peut pas le rejuger.
  return ok
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
