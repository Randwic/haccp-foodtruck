// Point d'entrée Deno de « device-enroll » : câblage uniquement (la logique est dans _shared/device_enroll.ts).
import { httpEnvFromDeno, serviceClient, SupabaseRepo } from '../_adapters/supabase_repo.ts'
import { createDeviceEnrollHandler } from '../_shared/device_enroll.ts'

const handler = createDeviceEnrollHandler({ ...httpEnvFromDeno(), repo: new SupabaseRepo(serviceClient()) })

Deno.serve(handler)
