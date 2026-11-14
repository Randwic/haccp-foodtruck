// Point d'entrée Deno de « sync-push » : câblage uniquement (la logique est dans _shared/sync_push.ts).
import { httpEnvFromDeno, serviceClient, SupabaseRepo } from '../_adapters/supabase_repo.ts'
import { createSyncPushHandler } from '../_shared/sync_push.ts'

const handler = createSyncPushHandler({ ...httpEnvFromDeno(), repo: new SupabaseRepo(serviceClient()) })

Deno.serve(handler)
