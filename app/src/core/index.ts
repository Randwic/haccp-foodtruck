// Point d'entrée du core hors-ligne. L'interface n'utilise que CoreApi (./api.ts) + ces fabriques.
export type { CoreApi, DeviceInfo, PhotoInfo, PhotoStatus, SyncStatus, UnlockResult } from './api.ts'
export {
  createCore,
  notifyActivity,
  computeBackoffMs,
  CoreError,
  SYNC_BATCH_SIZE,
  SYNC_INTERVAL_MS,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  DEFAULT_AUTO_LOCK_MINUTES,
  PHOTO_LOCAL_KEEP_MS,
  PHOTO_DRAFT_KEEP_MS,
  type Core,
  type CoreOptions,
  type CoreErrorCode,
  type ChainCheck,
  type SyncTrigger,
} from './core.ts'
export {
  createHttpTransport,
  TransportError,
  isTransportError,
  type Transport,
  type DeviceAuth,
  type HttpTransportOptions,
  type TransportErrorKind,
  type PhotoUploadOutcome,
  type PhotoRefusal,
} from './transport.ts'
export {
  createBrowserPhotoEncoder,
  createAdaptiveEncoder,
  isWebp,
  fitWithin,
  syntheticWebp,
  PHOTO_MAX_DIMENSION,
  PHOTO_TARGET_BYTES,
  type PhotoEncoder,
  type EncodedPhoto,
  type EncoderBackend,
} from './photoEncoder.ts'
export {
  createMockTransport,
  DEMO_DEVICE,
  DEMO_PINS,
  DEMO_STAFF,
  DEMO_EQUIPMENT,
  DEMO_THRESHOLDS,
  DEMO_SETTINGS,
  DEMO_ESTABLISHMENT,
  DEMO_SUPPLIERS,
  DEMO_PRODUCTS,
  DEMO_RECIPES,
  DEMO_CLEANING_TASKS,
  DEMO_CHECKLISTS,
  type MockTransport,
  type MockTransportOptions,
} from './mockTransport.ts'
export { hashPin, verifyPin, isValidPinFormat, PIN_MAX_FAILURES, PIN_LOCKOUT_MS } from './pin.ts'
export { RECORD_TYPES } from './recordTypes.ts'
// Lot 4 bis : valeurs par défaut des nouveaux champs (serveur / base plus anciens), échantillon du menu Space Diner.
export { normalizeProduct, normalizeRecipe, normalizeProducts, normalizeRecipes } from './catalog.ts'
export { MENU_PRODUCTS, MENU_RECIPES, SAUCE_UFO_ID } from './demoMenu.ts'
