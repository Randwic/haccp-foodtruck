// Point d'entrée Deno de « alerts-evaluate » : câblage uniquement (logique : _shared/alerts_evaluate.ts).
// Appel planifié (toutes les 5 min, pg_cron + pg_net) avec l'en-tête x-alerts-secret = ALERTS_EVALUATE_SECRET.
// Web Push : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (sinon désactivé).
// E-mail : RESEND_API_KEY et ALERT_EMAIL_TO (ALERT_EMAIL_FROM facultatif) — sinon désactivé.
import { SupabaseLot6Repo } from '../_adapters/supabase_alerts.ts'
import { httpEnvFromDeno, serviceClient } from '../_adapters/supabase_repo.ts'
import { createAlertsEvaluateHandler } from '../_shared/alerts_evaluate.ts'
import { createEmailSender } from '../_shared/email.ts'
import { createWebPushSender, type WebPushSender } from '../_shared/webpush.ts'

const env = httpEnvFromDeno()
let push: WebPushSender | null = null
const vapid = {
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
  subject: Deno.env.get('VAPID_SUBJECT') ?? '',
}
if (vapid.publicKey && vapid.privateKey) {
  try {
    push = createWebPushSender(vapid)
  } catch (e) {
    env.logger.log('error', 'vapid_invalid', { error: e instanceof Error ? e.message : String(e) })
  }
} else {
  env.logger.log('warn', 'push_not_configured', { hint: 'définir VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT' })
}
const email = createEmailSender({
  RESEND_API_KEY: Deno.env.get('RESEND_API_KEY'),
  ALERT_EMAIL_TO: Deno.env.get('ALERT_EMAIL_TO'),
  ALERT_EMAIL_FROM: Deno.env.get('ALERT_EMAIL_FROM'),
})

const handler = createAlertsEvaluateHandler({
  ...env,
  repo: new SupabaseLot6Repo(serviceClient()),
  push,
  email,
  secret: Deno.env.get('ALERTS_EVALUATE_SECRET'),
})

Deno.serve(handler)
