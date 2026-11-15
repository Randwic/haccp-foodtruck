// Point d'entrée Deno de « push-config » (GET public) : clé publique VAPID pour pushManager.subscribe().
import { httpEnvFromDeno } from '../_adapters/supabase_repo.ts'
import { createPushConfigHandler } from '../_shared/push_subscribe.ts'

const handler = createPushConfigHandler({ ...httpEnvFromDeno(), vapidPublicKey: Deno.env.get('VAPID_PUBLIC_KEY') })

Deno.serve(handler)
