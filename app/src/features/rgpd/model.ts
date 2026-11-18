// RGPD (lot 8) : registre des traitements et note d'information de l'équipe, construits avec les
// réglages de l'application (durée de conservation) et les réponses de l'assistant PMS (raison sociale,
// exploitant, adresse, contact). Fonctions pures, testées dans rgpd.test.ts.
// Trame : RGPD art. 13 (information) et 30 (registre), modèle simplifié de la CNIL pour les TPE.

export interface RgpdContext {
  legalName: string
  owner: string
  address: string
  siret: string
  contact: string
  /** Durée de conservation du registre HACCP (réglage serveur, 3 ans par défaut). */
  retentionYears: number
  /** Nombre de membres de l'équipe (actifs). */
  staffCount: number
}

export interface Processing {
  name: string
  purpose: string
  legalBasis: string
  people: string
  data: string
  recipients: string
  retention: string
}

const TODO = 'À compléter'
const or = (v: string) => (v.trim() ? v.trim() : TODO)

/** Champs de l'identité du responsable encore vides (signalés en tête du registre). */
export function missingIdentity(ctx: RgpdContext): string[] {
  const out: string[] = []
  if (!ctx.legalName.trim()) out.push('raison sociale')
  if (!ctx.owner.trim()) out.push('nom de l’exploitant')
  if (!ctx.address.trim()) out.push('adresse')
  if (!ctx.contact.trim()) out.push('téléphone ou email de contact')
  return out
}

export function processings(ctx: RgpdContext): Processing[] {
  const years = `${ctx.retentionYears} an${ctx.retentionYears > 1 ? 's' : ''}`
  return [
    {
      name: 'Registres d’hygiène (HACCP) et traçabilité',
      purpose: 'Tenir les enregistrements du plan de maîtrise sanitaire (températures, cuissons, refroidissements, achats, étiquettes DLC, nettoyage, huiles, produits jetés, rappels) et savoir qui a fait chaque contrôle.',
      legalBasis: 'Obligation légale (RGPD art. 6.1.c) : règlements (CE) 852/2004 et 178/2002, arrêté du 21 décembre 2009.',
      people: 'Exploitant et membres de l’équipe.',
      data: 'Prénom et nom, rôle (gérant ou équipier), code PIN enregistré sous forme chiffrée (jamais lisible, même par le gérant), date, heure et appareil de chaque saisie. Photos d’étiquettes, de produits et de tickets d’achat (aucune photo de personne).',
      recipients: 'L’exploitant ; les services de contrôle (DDPP) lors d’une inspection.',
      retention: `${years} après la saisie, puis effacement automatique (photos comprises). Au départ d’un employé, son nom peut être remplacé par un pseudonyme : ses saisies restent, sans son nom.`,
    },
    {
      name: 'Compte gérant de l’application',
      purpose: 'Accéder à la gestion de l’application (équipe, produits, réglages, documents) et enrôler les appareils.',
      legalBasis: 'Intérêt légitime de l’exploitant à protéger l’accès à ses registres (RGPD art. 6.1.f).',
      people: 'Exploitant.',
      data: 'Adresse email, mot de passe (enregistré chiffré), nom des appareils enrôlés et date de dernière connexion.',
      recipients: 'L’exploitant.',
      retention: 'Tant que le compte existe.',
    },
    {
      name: 'Documents de l’établissement',
      purpose: 'Conserver les justificatifs du plan de maîtrise sanitaire : attestations de formation à l’hygiène, aptitude au travail, contrats (dératisation, entretien), analyses.',
      legalBasis: 'Obligation légale (RGPD art. 6.1.c) : formation à l’hygiène en restauration commerciale (Code rural, art. L. 233-4) et règlement (CE) 852/2004.',
      people: 'Exploitant et membres de l’équipe.',
      data: 'Attestation de formation (nom, dates). Aptitude médicale : seulement « apte » et sa date de validité, jamais de détail médical.',
      recipients: 'L’exploitant ; les services de contrôle sur demande.',
      retention: 'Pendant la validité du document, puis jusqu’à son remplacement par une nouvelle version.',
    },
  ]
}

/** Hébergement et sous-traitants (prestataires techniques). */
export const PROCESSORS: readonly [string, string][] = [
  ['Supabase', 'Base de données, photos et documents. Serveur en Irlande (Union européenne).'],
  ['Cloudflare', 'Diffusion de l’application web (aucune donnée de registre stockée).'],
  ['GitHub', 'Copie de sauvegarde chiffrée en transit, dépôt privé, chaque semaine (hébergement aux États-Unis, encadré par le cadre de protection des données UE–États-Unis).'],
]

export const SECURITY: readonly string[] = [
  'Connexions chiffrées (HTTPS) entre les appareils et le serveur.',
  'Code PIN personnel pour chaque membre, verrouillage automatique de l’appareil après inactivité.',
  'Codes PIN et mots de passe enregistrés chiffrés : personne ne peut les lire.',
  'Registre en insertion seule : une saisie ne peut être ni modifiée ni effacée ; une erreur se corrige par une nouvelle saisie.',
  'Gestion réservée au gérant, protégée par email et mot de passe.',
  'Sauvegarde automatique de la base, des photos et des documents chaque semaine.',
]

export const RIGHTS: readonly string[] = [
  'Accès : demander une copie de vos données (le gérant l’exporte depuis Gestion › Équipe).',
  'Rectification : faire corriger votre nom.',
  'Effacement : à votre départ, votre nom est remplacé par un pseudonyme. Vos saisies d’hygiène restent, car leur conservation est obligatoire.',
  'Limitation et opposition, dans les limites de l’obligation légale de tenir les registres.',
  'Réclamation auprès de la CNIL (www.cnil.fr) si vous estimez que vos droits ne sont pas respectés.',
]

export const GOOD_PRACTICES: readonly string[] = [
  'Donnez la note d’information à chaque nouvel employé, avant sa première saisie.',
  'Au départ d’un employé : désactivez son compte, exportez ses données s’il les demande, puis effacez son nom (Gestion › Équipe).',
  'Aptitude médicale : ne gardez que l’attestation « apte » et sa date, jamais de document médical détaillé.',
  'Ne photographiez pas de personnes : seulement les produits, étiquettes, tickets et défauts.',
  'Dans les commentaires, décrivez les faits, sans jugement sur une personne.',
  'Répondez à une demande d’un employé (copie, effacement) dans le mois.',
]

export function identityRows(ctx: RgpdContext): [string, string][] {
  return [
    ['Responsable du traitement', or(ctx.legalName)],
    ['Représenté par', or(ctx.owner)],
    ['Adresse', or(ctx.address)],
    ['SIRET', ctx.siret.trim() || '—'],
    ['Contact pour les données', or(ctx.contact)],
    ['Délégué à la protection des données', 'Non désigné (non obligatoire pour cette activité)'],
  ]
}

export function processingRows(p: Processing): [string, string][] {
  return [
    ['Finalité', p.purpose],
    ['Base légale', p.legalBasis],
    ['Personnes concernées', p.people],
    ['Données', p.data],
    ['Destinataires', p.recipients],
    ['Durée de conservation', p.retention],
  ]
}
