// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createEmailSender, DEFAULT_ALERT_EMAIL_FROM, disabledEmailSender, RESEND_API_URL } from './email.ts'

function fakeFetch(status = 200) {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = []
  const fn = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, init })
    return { status, ok: status >= 200 && status < 300 }
  }
  return { calls, fn }
}

describe('EmailSender (Resend)', () => {
  it('désactivé sans RESEND_API_KEY ou sans ALERT_EMAIL_TO (aucun appel réseau)', async () => {
    const f = fakeFetch()
    for (const env of [{}, { RESEND_API_KEY: 're_x' }, { ALERT_EMAIL_TO: 'moi@example.org' }, { RESEND_API_KEY: ' ', ALERT_EMAIL_TO: 'moi@example.org' }, { RESEND_API_KEY: 're_x', ALERT_EMAIL_TO: 'pas-une-adresse' }]) {
      const s = createEmailSender(env, f.fn)
      expect(s).toBe(disabledEmailSender)
      expect(s.enabled).toBe(false)
      await s.send({ subject: 's', text: 't' })
    }
    expect(f.calls).toHaveLength(0)
  })
  it('activé avec les deux variables : POST https://api.resend.com/emails', async () => {
    const f = fakeFetch()
    const s = createEmailSender({ RESEND_API_KEY: 're_test_123', ALERT_EMAIL_TO: 'gerant@example.org, associe@example.org' }, f.fn)
    expect(s.enabled).toBe(true)
    await s.send({ subject: '[HACCP] Capteur muet', text: 'Frigo 1 : aucune mesure' })
    expect(f.calls).toHaveLength(1)
    const { url, init } = f.calls[0]
    expect(url).toBe(RESEND_API_URL)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer re_test_123')
    expect(JSON.parse(init.body)).toEqual({
      from: DEFAULT_ALERT_EMAIL_FROM,
      to: ['gerant@example.org', 'associe@example.org'],
      subject: '[HACCP] Capteur muet',
      text: 'Frigo 1 : aucune mesure',
    })
  })
  it('expéditeur configurable ; refus du service → erreur', async () => {
    const f = fakeFetch(403)
    const s = createEmailSender({ RESEND_API_KEY: 'k', ALERT_EMAIL_TO: 'a@b.fr', ALERT_EMAIL_FROM: 'Alertes <alertes@mondomaine.fr>' }, f.fn)
    await expect(s.send({ subject: 's', text: 't' })).rejects.toThrow(/403/)
    expect(JSON.parse(f.calls[0].init.body).from).toBe('Alertes <alertes@mondomaine.fr>')
  })
})
