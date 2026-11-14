// Point d'entrée Deno de « sync-pull » : câblage uniquement (la logique est dans _shared/sync_pull.ts).
import { httpEnvFromDeno, serviceClient, SupabaseRepo } from '../_adapters/supabase_repo.ts'
import { createSyncPullHandler } from '../_shared/sync_pull.ts'

const handler = createSyncPullHandler({ ...httpEnvFromDeno(), repo: new SupabaseRepo(serviceClient()) })

Deno.serve(handler)
