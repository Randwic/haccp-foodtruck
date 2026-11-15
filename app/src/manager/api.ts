// Espace gérant : création du compte, connexion, enrôlement de l'appareil et paramétrage
// (équipements, seuils, équipe, réglages). L'interface ne dépend que de cette interface ;
// implémentations : Supabase (./supabaseManager.ts) et mémoire (./mockManager.ts).
import type { DeviceEnrollResponse, Equipment, EquipmentKind, RecordType, StaffMember, StaffRole, Threshold } from '../../../shared/types.ts'
import type { Allergen, Product, Recipe, StorageMode, Supplier } from '../../../shared/payloads.ts'

export interface BootstrapStatus {
  needs_bootstrap: boolean
  establishment_name: string
}

export interface BootstrapInput {
  email: string
  password: string
  display_name: string
  pin_salt: string
  pin_hash: string
  establishment_name: string
}

/** Membre de l'équipe vu par le gérant (sans le PIN haché). */
export type ManagedStaff = Pick<StaffMember, 'id' | 'display_name' | 'role' | 'active' | 'updated_at'>

export interface ThresholdInput {
  equipment_id: string
  check_type: RecordType
  min_c: number | null
  max_c: number | null
  tolerance_minutes: number
}

export interface ManagerSettings {
  establishment_name: string
  auto_lock_minutes: number
  /** Heures des relevés d'enceintes, « HH:MM » heure locale de l'établissement, 1 à 6, triées. */
  daily_check_times: string[]
  /** Un créneau de relevé oublié la veille reste « à faire » avant le premier créneau du jour. */
  missed_slot_carry_over: boolean
  /** DLC proposée après décongélation : jours à partir de la fin (0..30). */
  thaw_dlc_days: number
}

/** Fournisseur saisi par le gérant (téléphone et email facultatifs : null pour effacer). */
export interface SupplierInput {
  name: string
  phone?: string | null
  email?: string | null
}

/** Produit saisi par le gérant (durées de vie en heures, null = non applicable). */
export interface ProductInput {
  name: string
  allergens: Allergen[]
  storage: StorageMode
  shelf_life_opened_hours: number | null
  shelf_life_thawed_hours: number | null
}

/** Recette saisie par le gérant. */
export interface RecipeInput {
  name: string
  ingredient_product_ids: string[]
  extra_allergens: Allergen[]
  storage: StorageMode
  shelf_life_hours: number
}

export type ManagerErrorCode =
  | 'network' // pas de réseau / serveur injoignable
  | 'already_bootstrapped' // 409 : un compte gérant existe déjà
  | 'rate_limited' // 429
  | 'invalid_credentials' // email ou mot de passe incorrect
  | 'unauthorized' // session absente ou expirée : se reconnecter
  | 'forbidden' // connecté, mais pas gérant
  | 'validation' // 400 : données refusées
  | 'server' // 5xx / réponse inattendue

/** Erreur lisible par l'utilisateur (`message` en français). */
export class ManagerError extends Error {
  readonly code: ManagerErrorCode
  readonly status: number | null
  constructor(code: ManagerErrorCode, message: string, status: number | null = null) {
    super(message)
    this.name = 'ManagerError'
    this.code = code
    this.status = status
  }
}

export function isManagerError(e: unknown, code?: ManagerErrorCode): e is ManagerError {
  return e instanceof ManagerError && (code === undefined || e.code === code)
}

/** Message affichable pour n'importe quelle erreur. */
export function errorText(e: unknown, fallback = 'Une erreur est survenue. Réessayez.'): string {
  if (e instanceof ManagerError) return e.message
  if (e instanceof Error && e.message) return e.message
  return fallback
}

export const MESSAGES = {
  network: 'Serveur injoignable. Vérifiez la connexion Internet et réessayez.',
  already_bootstrapped: 'Un compte gérant existe déjà pour cet établissement. Connectez-vous avec son email et son mot de passe.',
  rate_limited: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
  invalid_credentials: 'Email ou mot de passe incorrect.',
  unauthorized: 'Votre session gérant a expiré. Saisissez à nouveau votre mot de passe.',
  forbidden: 'Ce compte n’est pas un compte gérant.',
  server: 'Le serveur a rencontré un problème. Réessayez dans un instant.',
} as const

export interface ManagerApi {
  /** 'mock' : serveur simulé en mémoire (développement, démo, tests). */
  readonly mode: 'supabase' | 'mock'

  // Premier lancement
  getBootstrapStatus(): Promise<BootstrapStatus>
  /** Crée le tout premier compte gérant (l'inscription est ensuite fermée définitivement). */
  bootstrap(input: BootstrapInput): Promise<{ staff_id: string }>

  // Session gérant (email + mot de passe)
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  /** Email du gérant si une session valide (ou renouvelable) existe, sinon null. */
  sessionEmail(): Promise<string | null>

  /** Crée un appareil côté serveur (session gérant requise). À passer ensuite à core.enrollDevice. */
  enrollDevice(name: string): Promise<DeviceEnrollResponse>

  // Équipements (pas de suppression : active=false)
  listEquipment(): Promise<Equipment[]> // actifs ET retirés
  addEquipment(input: { name: string; kind: EquipmentKind }): Promise<Equipment>
  updateEquipment(id: string, patch: { name?: string; active?: boolean }): Promise<Equipment>

  // Seuils (un par équipement et type de contrôle)
  listThresholds(): Promise<Threshold[]>
  saveThreshold(input: ThresholdInput): Promise<Threshold>

  // Équipe
  listStaff(): Promise<ManagedStaff[]> // actifs ET désactivés
  addStaff(input: { display_name: string; role: StaffRole; pin_salt: string; pin_hash: string }): Promise<ManagedStaff>
  updateStaff(id: string, patch: { display_name?: string; active?: boolean; pin_salt?: string; pin_hash?: string }): Promise<ManagedStaff>

  // Réglages
  getSettings(): Promise<ManagerSettings>
  saveSettings(patch: Partial<ManagerSettings>): Promise<ManagerSettings>

  // Fournisseurs (lot 3, table `suppliers`, RLS gérant ; jamais supprimés : active=false)
  listSuppliers(): Promise<Supplier[]> // actifs ET désactivés, triés par nom
  addSupplier(input: SupplierInput): Promise<Supplier>
  updateSupplier(id: string, patch: Partial<SupplierInput> & { active?: boolean }): Promise<Supplier>

  // Produits et recettes (lot 4, tables `products` / `recipes`, RLS gérant ; jamais supprimés : active=false)
  listProducts(): Promise<Product[]> // actifs ET désactivés, triés par nom
  addProduct(input: ProductInput): Promise<Product>
  updateProduct(id: string, patch: Partial<ProductInput> & { active?: boolean }): Promise<Product>
  listRecipes(): Promise<Recipe[]> // actives ET désactivées, triées par nom
  addRecipe(input: RecipeInput): Promise<Recipe>
  updateRecipe(id: string, patch: Partial<RecipeInput> & { active?: boolean }): Promise<Recipe>

  /**
   * Photo du bucket privé `photos` (lecture réservée au gérant connecté), pour afficher une photo
   * absente de l'appareil (prise sur un autre appareil, ou copie locale libérée).
   */
  downloadPhoto(path: string): Promise<Blob>
}
