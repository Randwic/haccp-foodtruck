#!/usr/bin/env node
// Génère une paire de clés VAPID (Web Push, RFC 8292) au format attendu par alerts-evaluate et
// push-config — le même que la bibliothèque `web-push` :
//   VAPID_PUBLIC_KEY  = point P-256 non compressé (65 octets, 0x04‖X‖Y) en base64url ;
//   VAPID_PRIVATE_KEY = scalaire privé d (32 octets) en base64url.
// Usage : node scripts/generate-vapid.mjs [mailto:adresse@exemple.fr]
// N'écrit rien sur disque : copier les lignes affichées dans `supabase secrets set` (ou le tableau de bord).
// Changer de paire invalide tous les abonnements existants (chaque appareil devra se réabonner).
import { webcrypto } from 'node:crypto'

const subtle = webcrypto.subtle
const b64url = (buf) => Buffer.from(buf).toString('base64url')

const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicKey = b64url(await subtle.exportKey('raw', pair.publicKey))
const { d } = await subtle.exportKey('jwk', pair.privateKey)
const subject = process.argv[2] ?? 'mailto:alertes@example.org'
if (!/^(mailto:|https:\/\/)/.test(subject)) {
  console.error('Le sujet VAPID doit commencer par « mailto: » ou « https:// ».')
  process.exit(1)
}

// Vérification : la clé privée signe, la clé publique vérifie.
const data = new TextEncoder().encode('vapid-self-test')
const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, data)
if (!(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, sig, data))) throw new Error('auto-test VAPID échoué')
if (Buffer.from(publicKey, 'base64url').length !== 65 || Buffer.from(d, 'base64url').length !== 32) throw new Error('format inattendu')

console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${d}`)
console.log(`VAPID_SUBJECT=${subject}`)
console.log('')
console.log('# Exemple (CLI Supabase) :')
console.log(`# supabase secrets set VAPID_PUBLIC_KEY=${publicKey} VAPID_PRIVATE_KEY=<clé privée ci-dessus> VAPID_SUBJECT=${subject}`)
