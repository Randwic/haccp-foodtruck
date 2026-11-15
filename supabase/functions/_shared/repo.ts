// Accès aux données, injecté dans la logique pure. Implémentations :
//  - _adapters/supabase_repo.ts (Deno, supabase-js, service_role) en production ;
//  - _shared/memory_repo.ts (en mémoire) pour les tests Vitest.
import type { Alert, AlertKind, Checklist, CleaningTask, Product, Recipe, Sensor, Supplier } from '../../../shared/payloads.ts'
import type { Equipment, EquipmentKind, Establishment, Settings, StaffMember, Threshold } from '../../../shared/types.ts'

export interface DeviceRow {
  id: string
  name: string
  revoked_at: string | null
}

/**
 * Valeurs de `records.quarantine_reason` : enregistrement à la chaîne intègre mais au contenu
 * refusé. Il est stocké (la chaîne de l'appareil avance) mais exclu des données « valides ».
 */
export type QuarantineReason = 'unknown_author' | 'unknown_type' | 'invalid_payload' | 'supersedes_not_found'

/** Enregistrement tel que relu en base (sous-ensemble utile à la synchro). */
export interface StoredRecord {
  id: string
  /** Texte libre : un enregistrement en quarantaine `unknown_type` peut porter un type hors contrat. */
  type: string
  hash: string
  device_id: string
  device_seq: number
  supersedes_id: string | null
  server_time: string // ISO
  clock_suspect: boolean
  quarantine_reason: QuarantineReason | null
}

/** Ligne insérée dans `records` (server_time posé par la base : default now()). */
export interface NewRecordRow {
  id: string
  type: string
  payload: Record<string, unknown>
  author_id: string
  device_id: string
  device_seq: number
  device_time: string
  prev_hash: string
  hash: string
  supersedes_id: string | null
  quarantine_reason: QuarantineReason | null
  /**
   * `SyncPushRequest.device_now` (horloge de l'appareil à l'envoi), absent pour une ancienne app.
   * Le trigger calcule alors clock_suspect sur |server_time − device_now| au lieu de device_time
   * (pris en compte pour service_role seulement).
   */
  device_now?: string
  /**
   * Envoyé uniquement à `true`, quand le lot entier est jugé « horloge suspecte ». Le trigger fait
   * un OU avec son propre calcul : une valeur fournie ne peut jamais effacer un signalement.
   * server_time n'est jamais envoyé (imposé par le trigger).
   */
  clock_suspect?: true
}

export type InsertResult =
  /** Valeurs relues après insertion (posées par le trigger). */
  | { ok: true; server_time: string; clock_suspect: boolean }
  /** 23505 : id ou (device_id, device_seq) déjà pris, typiquement par un envoi concurrent. */
  | { ok: false; kind: 'unique_violation' }
  /**
   * Filet de sécurité de la base (`HACCP: seq_gap|broken_chain|device_revoked …`) : la chaîne
   * ou l'appareil ont changé entre nos contrôles et l'insertion. Refus d'intégrité.
   */
  | { ok: false; kind: 'integrity'; reason: 'seq_gap' | 'broken_chain' | 'device_revoked'; detail: string }
  /**
   * `HACCP: unknown_author|supersedes_not_found` : contrôle de contenu de la base (hors quarantaine).
   * La logique réessaie alors l'insertion en quarantaine avec cette raison.
   */
  | { ok: false; kind: 'content'; quarantine: 'unknown_author' | 'supersedes_not_found'; detail: string }
  /** Autre refus « métier » de la base (contrainte CHECK…) : définitif, pas de nouvel essai. */
  | { ok: false; kind: 'rejected'; detail: string }

/**
 * Traduit le message d'une exception levée par les triggers (`HACCP: <code> — …`).
 * Pur, partagé entre l'adaptateur Supabase et les tests.
 */
export function classifyDbError(code: string, message: string): InsertResult & { ok: false } {
  if (code === '23505') return { ok: false, kind: 'unique_violation' }
  const m = /^HACCP:\s*([a-z_]+)/.exec(message)
  const tag = m?.[1]
  if (tag === 'seq_gap' || tag === 'broken_chain' || tag === 'device_revoked') return { ok: false, kind: 'integrity', reason: tag, detail: message }
  if (tag === 'unknown_author' || tag === 'supersedes_not_found') return { ok: false, kind: 'content', quarantine: tag, detail: message }
  return { ok: false, kind: 'rejected', detail: `${code} ${message}`.trim() }
}

/**
 * Même règle que le trigger : |server_time − horloge appareil| > clock_suspect_minutes (5 par défaut).
 * Horloge appareil = device_now (moment de l'envoi) si fourni, sinon device_time (ancienne règle).
 */
export function isClockSuspect(serverTime: Date, deviceTime: Date, clockSuspectMinutes: number | null | undefined): boolean {
  return Math.abs(serverTime.getTime() - deviceTime.getTime()) > (clockSuspectMinutes ?? 5) * 60_000
}

export interface ChainHead {
  device_seq: number
  hash: string
}

export interface DeviceAuthRepo {
  findDeviceByTokenHash(tokenHash: string): Promise<DeviceRow | null>
  touchDevice(deviceId: string, at: string): Promise<void>
}

export interface PushRepo extends DeviceAuthRepo {
  /** Paramètres (clock_suspect_minutes pour juger l'horloge du lot). */
  getSettings(): Promise<Settings | null>
  /**
   * `device_chain_head(device_id)` : dernier maillon, ou ancre de purge (record_chain_anchors)
   * si tous les enregistrements ont été purgés — traitée comme une tête normale. null si jamais rien reçu.
   */
  getChainHead(deviceId: string): Promise<ChainHead | null>
  getRecordsByIds(ids: string[]): Promise<StoredRecord[]>
  getStaffStatus(staffId: string): Promise<{ id: string; active: boolean } | null>
  /** Nature d'un équipement existant (actif ou non), null s'il est inconnu. */
  getEquipmentKind(equipmentId: string): Promise<EquipmentKind | null>
  /** Fournisseur existant (actif ou non) : `reception.supplier_id`. */
  supplierExists(supplierId: string): Promise<boolean>
  /** Produit / recette existants (actifs ou non) : `label_printed.product_id` / `recipe_id`. */
  productExists(productId: string): Promise<boolean>
  recipeExists(recipeId: string): Promise<boolean>
  /** Tâche de nettoyage / checklist existantes (actives ou non) : `cleaning_done.task_id` / `checklist_done.checklist_id`. */
  cleaningTaskExists(taskId: string): Promise<boolean>
  checklistExists(checklistId: string): Promise<boolean>
  /**
   * Type et payload d'enregistrements (corrections : photos reprises de l'enregistrement corrigé).
   * Ordre quelconque, id inconnus ignorés.
   */
  getPayloadsByIds(ids: string[]): Promise<{ id: string; type: string; payload: unknown }[]>
  /** Alerte existante (résolue ou non) : `alert_ack.alert_id` (lot 6). */
  alertExists(alertId: string): Promise<boolean>
  insertRecord(row: NewRecordRow): Promise<InsertResult>
}

export interface PullRepo extends DeviceAuthRepo {
  getEstablishment(): Promise<Establishment | null>
  getSettings(): Promise<Settings | null>
  /** Lignes (actives ou non) avec updated_at ≥ since ; toutes si since = null. */
  listStaff(since: string | null): Promise<StaffMember[]>
  listEquipment(since: string | null): Promise<Equipment[]>
  listThresholds(since: string | null): Promise<Threshold[]>
  listSuppliers(since: string | null): Promise<Supplier[]>
  listProducts(since: string | null): Promise<Product[]>
  listRecipes(since: string | null): Promise<Recipe[]>
  listCleaningTasks(since: string | null): Promise<CleaningTask[]>
  listChecklists(since: string | null): Promise<Checklist[]>
  /** Capteurs (actifs ou non) avec updated_at ≥ since ; tous si since = null. Jamais le token_hash. */
  listSensors(since: string | null): Promise<Sensor[]>
  /** Alertes ouvertes (resolved_at null) ∪ alertes modifiées depuis since (updated_at ≥ since). */
  listAlerts(since: string | null): Promise<Alert[]>
}

// ───────────────────────────── Lot 6 : capteurs, alertes, Web Push ─────────────────────────────

/** Capteur retrouvé par le SHA-256 de son jeton d'envoi. */
export interface SensorAuthRow {
  id: string
  name: string
  equipment_id: string
  active: boolean
  last_seen_at: string | null
}

/** Résultat de `sensor_record_reading()` (verrou, limite de débit, insertion, télémétrie : tout ou rien). */
export type RecordReadingResult = 'stored' | 'rate_limited' | 'inactive' | 'unknown_sensor'

export interface SensorIngestRepo {
  findSensorByTokenHash(tokenHash: string): Promise<SensorAuthRow | null>
  recordSensorReading(row: {
    sensor_id: string
    /** null : heure du serveur. */
    measured_at: string | null
    value_c: number
    battery_percent: number | null
    min_interval_seconds: number
  }): Promise<RecordReadingResult>
}

/** Capteur pour le moteur d'alertes (created_at : « muet depuis la création » s'il n'a jamais émis). */
export interface SensorForAlerts extends Sensor {
  created_at: string
}

export interface SensorReadingRow {
  sensor_id: string
  measured_at: string
  value_c: number
}

/** Enregistrement du registre utile au moteur d'alertes (hors quarantaine). */
export interface EngineRecord {
  id: string
  type: string
  payload: Record<string, unknown>
  device_time: string
  supersedes_id: string | null
}

export interface NewAlertRow {
  kind: AlertKind
  equipment_id: string | null
  sensor_id: string | null
  related_record_id: string | null
  message: string
}

export interface PushSubscriptionRow {
  id: string
  device_id: string
  endpoint: string
  p256dh: string
  auth: string
  failures: number
}

export interface AlertsRepo {
  getSettings(): Promise<Settings | null>
  getEstablishment(): Promise<Establishment | null>
  listEquipment(since: null): Promise<Equipment[]>
  listThresholds(since: null): Promise<Threshold[]>
  listSensorsForAlerts(): Promise<SensorForAlerts[]>
  /** Mesures des capteurs donnés avec measured_at ≥ since, ordre quelconque. */
  listSensorReadings(sensorIds: string[], since: string): Promise<SensorReadingRow[]>
  /** Enregistrements HORS QUARANTAINE des types donnés, reçus (server_time) depuis `sinceServerTime`. */
  listRecentRecords(sinceServerTime: string, types: readonly string[]): Promise<EngineRecord[]>
  listOpenAlerts(): Promise<Alert[]>
  /** Ouvre une alerte ; null si une alerte ouverte existe déjà pour ce sujet (index unique). */
  openAlert(row: NewAlertRow): Promise<Alert | null>
  resolveAlerts(ids: string[]): Promise<void>
  markAlertsNotified(ids: string[]): Promise<void>
  listPushSubscriptions(): Promise<PushSubscriptionRow[]>
  recordPushSuccess(id: string, at: string): Promise<void>
  /** failures + 1 ; renvoie le nouveau compteur. */
  recordPushFailure(id: string): Promise<number>
  deletePushSubscriptionById(id: string): Promise<void>
}

export interface PushSubscribeRepo extends DeviceAuthRepo {
  /** Crée ou met à jour (même endpoint : clés et appareil remplacés, échecs remis à zéro). */
  upsertPushSubscription(row: { device_id: string; endpoint: string; p256dh: string; auth: string }): Promise<'created' | 'updated'>
  /** Supprime l'abonnement de CET appareil ; false s'il n'existait pas. */
  removePushSubscription(deviceId: string, endpoint: string): Promise<boolean>
}

export interface EnrollRepo {
  /** Vérifie le JWT auprès de Supabase Auth ; renvoie l'id utilisateur ou null. */
  getUserIdFromJwt(jwt: string): Promise<string | null>
  isManager(userId: string): Promise<boolean>
  insertDevice(row: { name: string; token_hash: string; enrolled_by: string }): Promise<{ id: string }>
}

export interface HealthRepo {
  ping(): Promise<void>
}

/** Résultat de la création d'un utilisateur via l'API admin Supabase Auth. */
export type CreateAuthUserResult =
  | { ok: true; user_id: string }
  /** Refus « métier » d'Auth : e-mail déjà pris, mot de passe jugé trop faible, autre refus de validation. */
  | { ok: false; kind: 'email_exists' | 'weak_password' | 'rejected' }

/** Résultat de `bootstrap_manager()` (transaction SQL sérialisée par verrou). */
export type BootstrapManagerResult =
  | { ok: true; staff_id: string }
  /** `HACCP: already_bootstrapped` : un gérant existe déjà (y compris inscrit en concurrence). */
  | { ok: false; kind: 'already_bootstrapped' }

export interface BootstrapManagerRow {
  user_id: string
  display_name: string
  pin_salt: string
  pin_hash: string
  establishment_name: string
}

export interface BootstrapRepo {
  countManagers(): Promise<number>
  /** Nom de l'établissement, null s'il n'existe pas. */
  getEstablishmentName(): Promise<string | null>
  /** `bootstrap_failure_count(minutes)` : échecs enregistrés dans la fenêtre. */
  countRecentBootstrapFailures(windowMinutes: number): Promise<number>
  /** `bootstrap_record_failure(reason)` : raison courte `[a-z_]`, jamais de donnée personnelle. */
  recordBootstrapFailure(reason: string): Promise<void>
  /** `auth.admin.createUser({ email, password, email_confirm: true })`. */
  createAuthUser(email: string, password: string): Promise<CreateAuthUserResult>
  /** `auth.admin.deleteUser(id)` : nettoyage après échec de l'étape SQL. */
  deleteAuthUser(userId: string): Promise<void>
  /** `bootstrap_manager(…)` ; toute autre erreur SQL est levée. */
  bootstrapManager(row: BootstrapManagerRow): Promise<BootstrapManagerResult>
}
