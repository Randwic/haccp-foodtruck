// Point d'entrée Deno de « purge-photos » : câblage uniquement (la logique est dans _shared/purge_photos.ts).
// Appel planifié (une fois par jour) avec l'en-tête x-purge-secret = secret PURGE_PHOTOS_SECRET.
import { httpEnvFromDeno, serviceClient } from '../_adapters/supabase_repo.ts'
import { SupabasePhotoStore } from '../_adapters/supabase_storage.ts'
import { createPurgePhotosHandler } from '../_shared/purge_photos.ts'

const store = new SupabasePhotoStore(serviceClient())
const handler = createPurgePhotosHandler({ ...httpEnvFromDeno(), repo: store, store, secret: Deno.env.get('PURGE_PHOTOS_SECRET') })

Deno.serve(handler)
