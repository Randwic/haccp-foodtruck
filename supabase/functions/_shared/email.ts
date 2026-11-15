// Envoi d'e-mails d'alerte. Abstraction `EmailSender` ; implémentation Resend (offre gratuite),
// activée SEULEMENT si RESEND_API_KEY et ALERT_EMAIL_TO sont définis — sinon envoi désactivé,
// sans erreur (les alertes restent visibles dans l'app et par Web Push).

export interface EmailMessage {
  subject: string
  text: string
}

export interface EmailSender {
  readonly enabled: boolean
  /** Lève une erreur si le service refuse (journalisée par l'appelant, sans bloquer les alertes). */
  send(message: EmailMessage): Promise<void>
}

export const disabledEmailSender: EmailSender = {
  enabled: false,
  async send() {},
}

export interface ResendEnv {
  RESEND_API_KEY?: string
  /** Destinataire(s), séparés par des virgules. */
  ALERT_EMAIL_TO?: string
  /** Expéditeur ; défaut : adresse de test de Resend (n'envoie qu'à l'adresse du compte Resend). */
  ALERT_EMAIL_FROM?: string
}

export const RESEND_API_URL = 'https://api.resend.com/emails'
export const DEFAULT_ALERT_EMAIL_FROM = 'HACCP Space Diner <onboarding@resend.dev>'

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean }>

export function createEmailSender(env: ResendEnv, fetchFn: FetchLike = (url, init) => fetch(url, init)): EmailSender {
  const key = env.RESEND_API_KEY?.trim() ?? ''
  const to = (env.ALERT_EMAIL_TO ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+$/.test(s))
  if (key === '' || to.length === 0) return disabledEmailSender
  const from = env.ALERT_EMAIL_FROM?.trim() || DEFAULT_ALERT_EMAIL_FROM
  return {
    enabled: true,
    async send(message) {
      const res = await fetchFn(RESEND_API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject: message.subject, text: message.text }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`resend : statut ${res.status}`)
    },
  }
}
