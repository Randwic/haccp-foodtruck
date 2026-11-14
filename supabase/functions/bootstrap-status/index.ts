// Point d'entrée Deno de « bootstrap-status » : câblage uniquement (la logique est dans _shared/bootstrap.ts).
import { httpEnvFromDeno, serviceClient, SupabaseRepo } from '../_adapters/supabase_repo.ts'
import { createBootstrapStatusHandler } from '../_shared/bootstrap.ts'

const handler = createBootstrapStatusHandler({ ...httpEnvFromDeno(), repo: new SupabaseRepo(serviceClient()) })

Deno.serve(handler)
