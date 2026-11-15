// Point d'entrée Deno de « push-subscribe » : câblage uniquement (logique : _shared/push_subscribe.ts).
import { SupabaseLot6Repo } from '../_adapters/supabase_alerts.ts'
import { httpEnvFromDeno, serviceClient } from '../_adapters/supabase_repo.ts'
import { createPushSubscribeHandler } from '../_shared/push_subscribe.ts'

const handler = createPushSubscribeHandler({ ...httpEnvFromDeno(), repo: new SupabaseLot6Repo(serviceClient()) })

Deno.serve(handler)
