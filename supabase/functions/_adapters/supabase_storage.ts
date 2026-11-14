// Adaptateur Deno : bucket privé `photos` via l'API Storage (clé service_role) et fonctions SQL
// de la purge des photos. Non couvert par Vitest (logique dans _shared/photo_upload.ts et
// _shared/purge_photos.ts, testée avec MemoryPhotoStore).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { PHOTO_BUCKET } from '../../../shared/payloads.ts'
import type { PhotoStore } from '../_shared/photo_upload.ts'
import type { PhotoRemover, PurgePhotosRepo } from '../_shared/purge_photos.ts'

/** Erreur Storage / SQL sans détail côté client (le message part seulement dans les journaux). */
class StorageError extends Error {
  constructor(op: string, err: { message?: string; statusCode?: string; status?: number; code?: string }) {
    super(`${op} : ${err.statusCode ?? err.status ?? err.code ?? '?'} ${err.message ?? ''}`.trim())
    this.name = 'StorageError'
  }
}

/** L'API Storage signale « objet déjà présent » par un statut 409 (ou 400 + statusCode '409'). */
function isDuplicate(err: unknown): boolean {
  const e = (err ?? {}) as { statusCode?: string | number; status?: number; message?: string; error?: string }
  return String(e.statusCode) === '409' || e.status === 409 || /already exists|duplicate/i.test(`${e.message ?? ''} ${e.error ?? ''}`)
}

export class SupabasePhotoStore implements PhotoStore, PhotoRemover, PurgePhotosRepo {
  constructor(private readonly db: SupabaseClient) {}

  private bucket() {
    return this.db.storage.from(PHOTO_BUCKET)
  }

  async stat(path: string): Promise<{ size: number } | null> {
    const slash = path.lastIndexOf('/')
    const dir = path.slice(0, slash)
    const file = path.slice(slash + 1)
    const { data, error } = await this.bucket().list(dir, { search: file, limit: 10 })
    if (error) throw new StorageError('storage.list', error)
    const hit = (data ?? []).find((o) => o.name === file)
    if (!hit) return null
    const size = Number((hit.metadata as Record<string, unknown> | null)?.size)
    // Taille inconnue (métadonnées pas encore écrites) : -1, jamais égale à un envoi réel → 409 prudent.
    return { size: Number.isFinite(size) ? size : -1 }
  }

  async create(path: string, bytes: Uint8Array, contentType: string): Promise<'created' | 'exists'> {
    const { error } = await this.bucket().upload(path, bytes, { contentType, upsert: false, cacheControl: '31536000' })
    if (!error) return 'created'
    if (isDuplicate(error)) return 'exists'
    throw new StorageError('storage.upload', error)
  }

  async remove(paths: string[]): Promise<string[]> {
    const { data, error } = await this.bucket().remove(paths)
    if (error) throw new StorageError('storage.remove', error)
    return (data ?? []).map((o) => o.name)
  }

  async listPurgeablePhotos(limit: number): Promise<string[]> {
    const { data, error } = await this.db.rpc('photos_to_purge', { p_limit: limit })
    if (error) throw new StorageError('photos_to_purge', error)
    return ((data ?? []) as { name: string }[]).map((r) => r.name)
  }

  async recordPhotoPurge(deleted: number, failed: number): Promise<void> {
    const { error } = await this.db.rpc('record_photo_purge', { p_deleted: deleted, p_failed: failed })
    if (error) throw new StorageError('record_photo_purge', error)
  }
}
