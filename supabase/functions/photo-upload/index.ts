// Point d'entrée Deno de « photo-upload » : câblage uniquement (la logique est dans _shared/photo_upload.ts).
import { httpEnvFromDeno, serviceClient, SupabaseRepo } from '../_adapters/supabase_repo.ts'
import { SupabasePhotoStore } from '../_adapters/supabase_storage.ts'
import { createPhotoUploadHandler } from '../_shared/photo_upload.ts'

const db = serviceClient()
const handler = createPhotoUploadHandler({ ...httpEnvFromDeno(), repo: new SupabaseRepo(db), store: new SupabasePhotoStore(db) })

Deno.serve(handler)
