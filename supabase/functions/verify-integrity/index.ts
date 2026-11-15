// Point d'entrée Deno de « verify-integrity » (lot 7) : câblage uniquement (logique : _shared/verify_integrity.ts).
// JWT du gérant (verify_jwt = true + contrôle dans managers) ; lecture du registre avec la clé service_role.
import { SupabaseIntegrityRepo } from '../_adapters/supabase_integrity.ts'
import { httpEnvFromDeno, serviceClient } from '../_adapters/supabase_repo.ts'
import { createVerifyIntegrityHandler } from '../_shared/verify_integrity.ts'

const handler = createVerifyIntegrityHandler({ ...httpEnvFromDeno(), repo: new SupabaseIntegrityRepo(serviceClient()) })

Deno.serve(handler)
