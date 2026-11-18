// RGPD (lot 8) : textes d'information de l'équipe, registre des traitements, historique d'une fiche,
// résumé des saisies d'une personne. Fonctions pures, une seule source pour l'écran et les PDF.
import type { RecordType } from '../../../../shared/types.ts'
import type { ManagedStaff, RegistryRecord, StaffAuditEntry } from '../../manager/api.ts'

/** Délai avant l'effacement automatique d'un ancien équipier sans saisie conservée (migration lot 8). */
export const FORGET_GRACE_DAYS = 30
export const DEFAULT_RETENTION_YEARS = 3

export interface PrivacyContext {
  establishmentName: string
  /** Nom du gérant (responsable du traitement). */
  managerName: string | null
  /** Email de contact du gérant (compte gérant), si connu. */
  managerEmail: string | null
  retentionYears: number
}

export interface TextSection {
  title: string
  paragraphs?: string[]
  bullets?: string[]
}

const years = (n: number) => `${n} an${n > 1 ? 's' : ''}`

export function controllerLine(ctx: PrivacyContext): string {
  const who = [ctx.establishmentName || 'L’établissement', ctx.managerName ? `représenté par ${ctx.managerName}` : null].filter(Boolean).join(', ')
  return ctx.managerEmail ? `${who} (contact : ${ctx.managerEmail})` : who
}

/** Note d'information des salariés (art. 13 RGPD) : affichée sur l'écran de verrouillage et remise en PDF. */
export function noticeSections(ctx: PrivacyContext): TextSection[] {
  const y = years(ctx.retentionYears)
  return [
    {
      title: 'Qui est responsable de vos données ?',
      paragraphs: [`${controllerLine(ctx)}. C’est à lui que vous vous adressez pour toute question ou demande.`],
    },
    {
      title: 'Pourquoi cette application garde des informations sur vous',
      paragraphs: [
        'L’application sert à tenir les registres d’hygiène obligatoires (plan de maîtrise sanitaire, méthode HACCP) : relevés de températures, réceptions, étiquettes, nettoyage, huiles… Chaque saisie porte le nom de la personne qui l’a faite, pour prouver aux services de contrôle qui a fait quoi et quand.',
        'Base légale : obligation légale de l’exploitant (règlements européens 852/2004 et 178/2002 sur l’hygiène et la traçabilité des aliments).',
      ],
    },
    {
      title: 'Ce qui est enregistré',
      bullets: [
        'Votre prénom et votre nom (tel que saisi par le gérant) et votre rôle (équipier ou gérant).',
        'Votre code PIN, uniquement sous forme d’empreinte chiffrée : personne ne peut le lire, pas même le gérant.',
        'Vos saisies : date et heure, appareil utilisé, valeurs relevées, commentaires et photos éventuelles (étiquettes, produits).',
        'Les dates de votre compte : ajout, changement de code, désactivation.',
        'Si vous en fournissez : votre attestation de formation hygiène et la date de validité de votre aptitude, jamais de détail médical.',
      ],
      paragraphs: ['Aucune géolocalisation, aucune photo de vous, aucune donnée bancaire ou de santé.'],
    },
    {
      title: 'Combien de temps',
      bullets: [
        `Les saisies sont gardées ${y} (durée du registre), puis effacées automatiquement.`,
        `Après votre départ, votre nom reste sur vos anciennes saisies tant qu’elles sont gardées, puis il est effacé automatiquement (au plus tôt ${FORGET_GRACE_DAYS} jours après votre départ si vous n’avez rien saisi).`,
        'Les sauvegardes de sécurité suivent la même durée.',
      ],
    },
    {
      title: 'Qui peut les voir',
      bullets: [
        'Le gérant. Les autres équipiers voient seulement les noms sur l’écran de verrouillage et sur les saisies.',
        'Les services de contrôle sanitaire (DDPP), sur demande, lors d’un contrôle.',
        'Les prestataires techniques qui hébergent l’application, sans droit d’utiliser vos données : Supabase (base de données, en Union européenne, Irlande), Cloudflare (diffusion de l’application), GitHub (sauvegardes, dépôt privé).',
      ],
    },
    {
      title: 'Vos droits',
      paragraphs: [
        'Vous pouvez demander à tout moment au gérant une copie de vos données (l’application la prépare en PDF), la correction de votre nom, ou l’effacement de vos données après votre départ. Vos saisies d’hygiène doivent rester dans le registre pendant leur durée légale : votre nom y est alors remplacé par « Ancien équipier n° … ».',
        'Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la CNIL (www.cnil.fr).',
      ],
    },
  ]
}

export interface Treatment {
  name: string
  rows: [string, string][]
}

/** Registre des activités de traitement (art. 30 RGPD), pré-rempli pour l'établissement. */
export function registerTreatments(ctx: PrivacyContext): Treatment[] {
  const y = years(ctx.retentionYears)
  const hosts = 'Supabase (base de données et fichiers, région UE – Irlande) ; Cloudflare (diffusion de l’application, aucune saisie stockée) ; GitHub (sauvegardes hebdomadaires, dépôt privé). Prestataires techniques sans droit d’utilisation des données.'
  return [
    {
      name: '1. Registres d’hygiène HACCP signés par l’équipe',
      rows: [
        ['Finalité', 'Tenir les enregistrements du plan de maîtrise sanitaire et prouver qui a réalisé chaque contrôle (traçabilité).'],
        ['Base légale', 'Obligation légale (art. 6.1.c RGPD) : règlements (CE) 852/2004 et 178/2002.'],
        ['Personnes concernées', 'Gérant, salariés et aides occasionnelles qui utilisent l’application.'],
        ['Données', 'Prénom et nom, rôle, empreinte du code PIN (jamais le code), saisies signées (date, heure, appareil, valeurs, commentaires, photos d’étiquettes et de produits), dates du compte.'],
        ['Destinataires', 'Gérant ; services de contrôle (DDPP) sur demande.'],
        ['Sous-traitants', hosts],
        ['Durée de conservation', `Saisies et photos : ${y}, puis effacement automatique chaque nuit. Nom d’un ancien salarié : tant que ses saisies sont conservées, puis effacement automatique (au plus tôt ${FORGET_GRACE_DAYS} jours après le départ). Sauvegardes : à purger au-delà de la même durée.`],
        ['Sécurité', 'Code PIN personnel (empreinte PBKDF2), verrouillage automatique, registre infalsifiable (chaîne d’empreintes), accès gérant par mot de passe, connexions chiffrées (HTTPS), contrôle d’accès sur chaque table, hébergement UE.'],
      ],
    },
    {
      name: '2. Documents du personnel (formation hygiène, aptitude)',
      rows: [
        ['Finalité', 'Présenter au contrôle l’attestation de formation hygiène et la validité de l’aptitude du personnel.'],
        ['Base légale', 'Obligation légale (formation hygiène en restauration commerciale, aptitude du personnel manipulant des denrées).'],
        ['Personnes concernées', 'Gérant et salariés.'],
        ['Données', 'Attestation de formation, date de validité de l’aptitude. Jamais de détail médical.'],
        ['Destinataires', 'Gérant ; services de contrôle sur demande.'],
        ['Sous-traitants', 'Supabase (fichiers, région UE – Irlande) ; GitHub (sauvegardes).'],
        ['Durée de conservation', 'Pendant le contrat de travail ; archiver puis retirer au départ de la personne.'],
        ['Sécurité', 'Espace de fichiers privé, lisible par le gérant connecté seulement.'],
      ],
    },
    {
      name: '3. Compte du gérant',
      rows: [
        ['Finalité', 'Protéger l’accès aux réglages, au registre complet et aux documents.'],
        ['Base légale', 'Intérêt légitime (sécurité de l’application).'],
        ['Personnes concernées', 'Gérant.'],
        ['Données', 'Adresse email, empreinte du mot de passe, dates de connexion.'],
        ['Destinataires', 'Personne d’autre.'],
        ['Sous-traitants', 'Supabase (authentification, région UE – Irlande) ; GitHub (sauvegardes).'],
        ['Durée de conservation', 'Tant que le compte existe.'],
        ['Sécurité', 'Mot de passe de 12 caractères au moins, session à renouveler, connexions chiffrées.'],
      ],
    },
  ]
}

// ---------------------------------------------------------------------------
// Fiche d'une personne (droit d'accès)
// ---------------------------------------------------------------------------

export const RECORD_LABELS: Record<RecordType, string> = {
  system_test: 'Test de l’application',
  temperature_check: 'Relevé de température',
  cooling: 'Refroidissement',
  reheating: 'Remise en température',
  hot_holding: 'Maintien au chaud',
  cooking_check: 'Cuisson à cœur',
  thawing: 'Décongélation',
  oil_check: 'Contrôle de l’huile',
  oil_change: 'Changement d’huile',
  thermometer_check: 'Vérification du thermomètre',
  reception: 'Achat / réception',
  label_printed: 'Étiquette imprimée',
  waste: 'Produit jeté',
  cleaning_done: 'Nettoyage',
  checklist_done: 'Checklist',
  corrective_action: 'Action corrective',
  alert_ack: 'Alerte prise en compte',
  correction: 'Correction',
}

const num = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })

/** Détail court d'une saisie : produit, température, commentaire. */
export function recordSummary(r: Pick<RegistryRecord, 'payload'>): string {
  const p = (r.payload ?? {}) as Record<string, unknown>
  const parts: string[] = []
  const str = (k: string) => (typeof p[k] === 'string' && (p[k] as string).trim() ? (p[k] as string).trim() : null)
  const product = str('product') ?? str('name') ?? str('title') ?? str('vendor')
  if (product) parts.push(product)
  for (const k of ['value_c', 'temperature_c']) {
    if (typeof p[k] === 'number') {
      parts.push(`${num(p[k] as number)} °C`)
      break
    }
  }
  if (typeof p.polar_percent === 'number') parts.push(`${num(p.polar_percent)} %`)
  const note = str('reason') ?? str('comment') ?? str('note')
  if (note) parts.push(note)
  return parts.join(' · ').slice(0, 160)
}

export interface HistoryEvent {
  at: string
  label: string
}

/** Historique lisible d'une fiche à partir du journal d'audit (aucun secret). */
export function staffHistory(entries: readonly StaffAuditEntry[]): HistoryEvent[] {
  const out: HistoryEvent[] = []
  for (const e of entries) {
    const o = e.old ?? {}
    const n = e.new ?? {}
    if (e.action === 'INSERT') out.push({ at: e.at, label: 'Compte créé' })
    else if (e.action === 'RGPD_FORGET') out.push({ at: e.at, label: 'Données personnelles effacées (RGPD)' })
    else if (e.action === 'DELETE') out.push({ at: e.at, label: 'Fiche supprimée' })
    else if (e.action === 'UPDATE') {
      const labels: string[] = []
      if (o.display_name !== n.display_name && n.display_name !== undefined) labels.push('Nom modifié')
      if (o.active !== n.active && n.active !== undefined) labels.push(n.active ? 'Compte réactivé' : 'Compte désactivé (départ)')
      if (Array.isArray(n._secrets_changed) && n._secrets_changed.length > 0) labels.push('Code PIN changé')
      if (o.role !== n.role && n.role !== undefined) labels.push('Rôle modifié')
      if (o.privacy_notice_on !== n.privacy_notice_on && n.privacy_notice_on) labels.push('Note d’information remise')
      for (const l of labels) out.push({ at: e.at, label: l })
    }
  }
  return out
}

export type NoticeState = 'given' | 'missing' | 'forgotten'

export function noticeState(s: Pick<ManagedStaff, 'privacy_notice_on' | 'forgotten_at'>): NoticeState {
  if (s.forgotten_at) return 'forgotten'
  return s.privacy_notice_on ? 'given' : 'missing'
}

/** « Ancien équipier n° 2 » : effacé ; sinon désactivé ou actif. */
export function canForget(s: Pick<ManagedStaff, 'role' | 'active' | 'forgotten_at'>): boolean {
  return s.role === 'staff' && !s.active && !s.forgotten_at
}

/** Jour local AAAA-MM-JJ. */
export function todayIso(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function fileSlug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'personne'
  )
}
