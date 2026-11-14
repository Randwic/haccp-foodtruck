// Point d'entrée Deno de « health » : câblage uniquement (la logique est dans _shared/health.ts).
import { httpEnvFromDeno, serviceClient, SupabaseRepo } from '../_adapters/supabase_repo.ts'
import { createHealthHandler } from '../_shared/health.ts'

const handler = createHealthHandler({ ...httpEnvFromDeno(), repo: new SupabaseRepo(serviceClient()) })

Deno.serve(handler)
