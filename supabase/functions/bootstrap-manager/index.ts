// Point d'entrée Deno de « bootstrap-manager » : câblage uniquement (la logique est dans _shared/bootstrap.ts).
import { httpEnvFromDeno, serviceClient, SupabaseRepo } from '../_adapters/supabase_repo.ts'
import { createBootstrapManagerHandler } from '../_shared/bootstrap.ts'

const handler = createBootstrapManagerHandler({ ...httpEnvFromDeno(), repo: new SupabaseRepo(serviceClient()) })

Deno.serve(handler)
