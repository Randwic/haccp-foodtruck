// Contrat partagé app <-> backend. NE PAS MODIFIER sans accord du chef de projet.
// Fichier sans dépendance : importé par l'app (Vite) et les Edge Functions (Deno).
import type { Product, Recipe, Supplier } from './payloads.ts'

export type RecordType =
  | 'system_test'
  | 'temperature_check'
  | 'cooling'
  | 'reheating'
  | 'hot_holding'
  | 'cooking_check'
  | 'thawing'
  | 'oil_check'
  | 'oil_change'
  | 'reception'
  | 'label_printed'
  | 'waste'
  | 'cleaning_done'
  | 'checklist_done'
  | 'corrective_action'
  | 'alert_ack'
  | 'correction'

/** Champs couverts par l'empreinte (hash). */
export interface RecordCore {
  id: string // uuid v4 généré sur l'appareil
  type: RecordType
  payload: Record<string, unknown>
  author_id: string // uuid du membre de l'équipe (staff)
  device_id: string // uuid de l'appareil enrôlé
  device_seq: number // 1, 2, 3… sans trou, par appareil
  device_time: string // ISO 8601 UTC avec millisecondes : 2026-11-14T10:00:00.000Z
  prev_hash: string // hash de l'enregistrement device_seq-1 du même appareil, ou GENESIS_HASH
  supersedes_id: string | null // pour type 'correction' : id de l'enregistrement corrigé
}

export interface HaccpRecord extends RecordCore {
  hash: string // SHA-256 hex (minuscules) de canonicalJson(RecordCore)
  server_time?: string // posé par le serveur uniquement
}

export const GENESIS_HASH = '0'.repeat(64)

// ---------- API Edge Functions ----------
// Authentification appareil : en-tête `x-device-token: <jeton>` (jeton remis une seule fois à l'enrôlement).
// Authentification gérant : session Supabase Auth (Authorization: Bearer <jwt>).

/** POST /functions/v1/sync-push  (appareil) */
export interface SyncPushRequest {
  device_id: string
  // Horloge de l'appareil au moment de l'envoi (ISO UTC). Sert à détecter une horloge déréglée
  // sans signaler à tort les saisies faites hors réseau et envoyées plus tard.
  device_now?: string
  records: HaccpRecord[] // triés par device_seq croissant
}
export interface SyncPushResponse {
  accepted: { id: string; server_time: string; clock_suspect: boolean }[]
  // already_known : même id + même hash déjà reçu (envoi idempotent) -> compté comme accepté
  // quarantined = true : l'enregistrement EST stocké côté serveur (quarantaine, chaîne avancée) ; ne pas le renvoyer.
  rejected: { id: string; reason: RejectReason; detail?: string; quarantined?: boolean }[]
  last_device_seq: number // dernier device_seq enregistré côté serveur pour cet appareil
}
export type RejectReason =
  | 'invalid_hash'
  | 'broken_chain'
  | 'seq_gap'
  | 'invalid_payload'
  | 'invalid_record' // enveloppe non stockable (uuid, date non canonique, champ inconnu…)
  | 'supersedes_not_found' // correction visant un enregistrement inconnu
  | 'unknown_author'
  | 'unknown_type'
  | 'id_conflict' // même id, hash différent
  | 'device_revoked'

/** GET /functions/v1/sync-pull?since=<ISO|vide>  (appareil) */
export interface SyncPullResponse {
  server_now: string
  establishment: Establishment
  staff: StaffMember[]
  equipment: Equipment[]
  thresholds: Threshold[]
  settings: Settings
  suppliers: Supplier[] // fournisseurs actifs (lot 3)
  products: Product[] // produits actifs (lot 4)
  recipes: Recipe[] // recettes actives (lot 4)
  deleted: { table: string; id: string }[] // références désactivées depuis `since`
}

/** POST /functions/v1/device-enroll  (gérant connecté) body: { name: string } */
export interface DeviceEnrollResponse {
  device_id: string
  device_token: string // affiché une seule fois
}

// ---------- Données de référence ----------
export interface Establishment {
  id: string
  name: string
  timezone: string // 'Europe/Paris'
}

export type StaffRole = 'manager' | 'staff'
export interface StaffMember {
  id: string
  display_name: string
  role: StaffRole
  active: boolean
  // PIN : PBKDF2-SHA256, PIN_PBKDF2_ITERATIONS itérations, sel 16 octets, clé 32 octets, base64
  pin_salt: string
  pin_hash: string
  updated_at: string
}
export const PIN_PBKDF2_ITERATIONS = 210_000

export type EquipmentKind = 'fridge' | 'freezer' | 'fryer_vat' | 'hot_holding' | 'other'
export interface Equipment {
  id: string
  name: string // ex. 'Frigo 1', 'Friteuse – bac gauche'
  kind: EquipmentKind
  active: boolean
  updated_at: string
}

export interface Threshold {
  id: string
  equipment_id: string | null // null = seuil générique par type de contrôle
  check_type: RecordType
  min_c: number | null
  max_c: number | null
  tolerance_minutes: number // durée hors seuil avant alerte (capteurs)
  updated_at: string // NB : la base interdit la suppression d'un seuil (désactivation prévue au lot 2)
}

export interface Settings {
  retention_years: number // 3
  auto_lock_minutes: number
  clock_suspect_minutes: number // écart device/serveur au-delà duquel on signale
  email_alerts: boolean
  daily_check_times: string[] // heures des relevés d'enceintes, ex. ['08:00', '18:00'] (heure locale de l'établissement)
  missed_slot_carry_over: boolean // un créneau oublié la veille reste « à faire » avant le premier créneau du jour (défaut true)
  thaw_dlc_days: number // DLC proposée après décongélation, en jours à partir de la fin (défaut 3, 0..30)
  oil_polar_max: number // limite des composés polaires en % (défaut 25, légal), 10..30
  oil_polar_warn: number // seuil d'alerte préventive en % (défaut 22), < oil_polar_max
}
