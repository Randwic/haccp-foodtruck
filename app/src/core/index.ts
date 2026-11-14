// Point d'entrée du core hors-ligne. L'interface n'utilise que CoreApi (./api.ts) + ces fabriques.
export type { CoreApi, DeviceInfo, SyncStatus, UnlockResult } from './api.ts'
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
} from './transport.ts'
export {
  createMockTransport,
  DEMO_DEVICE,
  DEMO_PINS,
  DEMO_STAFF,
  DEMO_EQUIPMENT,
  DEMO_THRESHOLDS,
  DEMO_SETTINGS,
  DEMO_ESTABLISHMENT,
  type MockTransport,
  type MockTransportOptions,
} from './mockTransport.ts'
export { hashPin, verifyPin, isValidPinFormat, PIN_MAX_FAILURES, PIN_LOCKOUT_MS } from './pin.ts'
export { RECORD_TYPES } from './recordTypes.ts'
