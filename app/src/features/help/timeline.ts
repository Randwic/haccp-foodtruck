// Aide : « Quoi faire, et quand » dans l'application. Même contenu que le guide PDF (docs/guide/guide.html,
// chapitre « La timeline »). Si un écran change de nom ou si un horaire change, mettre à jour les deux.
import { formatOpeningDate, isValidOpeningDate } from '../../../../shared/opening.ts'

export interface HelpStep {
  /** Moment (« 16 h 30 », « Prépa »…). */
  when: string
  /** Ce qu'il faut faire. */
  what: string
  /** Où dans l'application. */
  where: string
}

export interface HelpPeriod {
  id: string
  title: string
  intro?: string
  steps: HelpStep[]
  /** Réservé au gérant (affiché à tous, avec la mention). */
  managerOnly?: boolean
}

export interface HelpOptions {
  openingDate?: string | null
  thermometerCheckDays?: number
  thermometerToleranceC?: number
}

const fmtC = (v: number) => `${String(v).replace('.', ',')} °C`

/** Les périodes de la timeline, dans l'ordre : avant l'ouverture, chaque jour de service, semaine, mois, au besoin. */
export function helpTimeline(o: HelpOptions = {}): HelpPeriod[] {
  const days = o.thermometerCheckDays ?? 30
  const tol = o.thermometerToleranceC ?? 1
  const opening = isValidOpeningDate(o.openingDate) ? formatOpeningDate(o.openingDate) : null
  return [
    {
      id: 'before',
      title: opening ? `Avant l’ouverture (jusqu’au ${opening})` : 'Avant l’ouverture',
      intro: opening
        ? `Tant que le camion n’est pas ouvert, l’application ne lance aucune alerte et met les rappels en pause. Vous pouvez faire des saisies d’essai.`
        : 'À faire une fois, avant le premier service.',
      steps: [
        { when: 'Une fois', what: 'Installer l’application sur l’iPad (Safari › Partager › Sur l’écran d’accueil), puis toujours l’ouvrir depuis son icône', where: 'Bandeau « Comment faire ? »' },
        { when: 'Une fois', what: 'Vérifier les équipements froids, les produits (durée après ouverture), les recettes et l’équipe', where: 'Gestion (gérant)' },
        { when: 'Une fois', what: 'Ranger la déclaration DDPP, l’attestation de formation hygiène et les contrats d’entretien', where: 'Documents & PMS › Documents (gérant)' },
        { when: 'Une fois', what: 'Faire et enregistrer le Plan de Maîtrise Sanitaire (PMS)', where: 'Documents & PMS › Plan (PMS) (gérant)' },
        { when: 'Quand vous voulez', what: 'S’entraîner sur chaque écran. Une saisie faite pour essayer se marque ensuite « saisie de test »', where: 'Documents & PMS › Mode Contrôle (gérant)' },
        { when: 'Le jour J', what: 'Vérifier la date d’ouverture (ou décocher « Pas encore ouvert »), puis activer les notifications', where: 'Gestion › Réglages, puis Aujourd’hui › Alertes' },
      ],
    },
    {
      id: 'day',
      title: 'Chaque jour de service (jeudi à samedi)',
      intro: 'Prépa de 16 h à 18 h 30, service de 18 h 30 à 21 h. Pas besoin de tout retenir : faites ce que l’écran « Aujourd’hui » montre en orange ou en rouge, jusqu’à ce que tout soit vert.',
      steps: [
        { when: '16 h, en arrivant', what: 'Ouvrir l’application, toucher son nom et taper son code. Si « Nouvelle version disponible » s’affiche, toucher Mettre à jour', where: 'Écran de verrouillage' },
        { when: '16 h', what: 'Lire les alertes et toucher « Vu » sur chacune après avoir réglé le problème', where: 'Aujourd’hui › Alertes' },
        { when: '16 h 30', what: 'Relever les 3 températures (frigo inox, desserte, congélateur)', where: 'Températures' },
        { when: 'Prépa', what: 'Étiqueter chaque produit ouvert. Un produit acheté se choisit dans « Produits reçus aux Achats » : le lot et la DLC sont repris tout seuls', where: 'Étiquettes DLC › Ouverture d’un produit' },
        { when: 'Prépa', what: 'Étiqueter les préparations maison et le pain décongelé', where: 'Étiquettes DLC' },
        { when: 'Prépa', what: 'Jeter ce qui a dépassé sa DLC (bouton « Jeté »)', where: 'Étiquettes DLC' },
        { when: 'Prépa', what: 'Réchauffer la viande (porc 63 °C, poulet 74 °C à cœur, en 1 h maximum)', where: 'Remise en température' },
        { when: 'Avant 18 h 30', what: 'Contrôler l’huile des deux friteuses', where: 'Huiles de friture' },
        { when: 'Avant 18 h 30', what: 'Faire la checklist Ouverture', where: 'Nettoyage › Checklists' },
        { when: '18 h 30 – 21 h', what: 'Mesurer à cœur les nuggets (74 °C) et contrôler le bain-marie (63 °C, 3 h maximum)', where: 'Cuisson & maintien' },
        { when: '21 h', what: 'Relever de nouveau les 3 températures', where: 'Températures' },
        { when: 'Après le service', what: 'Cocher le nettoyage fait (plancha, friteuses, machine à sceller, plan de travail, sonde, vaisselle)', where: 'Nettoyage' },
        { when: 'Après le service', what: 'Faire la checklist Fermeture (restes du bain-marie jetés)', where: 'Nettoyage › Checklists' },
        { when: 'Avant de partir', what: 'Vérifier que la pastille en haut dit « Tout est synchronisé »', where: 'En haut de l’écran' },
      ],
    },
    {
      id: 'shopping',
      title: 'Le jour des courses',
      steps: [
        { when: 'Au retour', what: 'Enregistrer les achats en rangeant : magasin, photo de l’étiquette (lot et DLC lus tout seuls), température des produits frais et surgelés', where: 'Achats & réception' },
      ],
    },
    {
      id: 'week',
      title: 'Chaque semaine',
      steps: [
        { when: 'Jeudi', what: 'Faire les sauces maison froides et les étiqueter (3 jours)', where: 'Étiquettes DLC › Préparation maison' },
        { when: '1 fois', what: 'Faire la checklist Contrôle nuisibles', where: 'Nettoyage › Checklists' },
        { when: '1 fois', what: 'Nettoyer les frigos et la desserte', where: 'Nettoyage' },
        { when: 'Samedi soir', what: 'Jeter les sauces maison froides restantes', where: 'Checklist Fermeture' },
      ],
    },
    {
      id: 'month',
      title: days === 30 ? 'Chaque mois' : `Tous les ${days} jours`,
      steps: [
        { when: `Tous les ${days} jours`, what: `Vérifier chaque thermomètre dans l’eau glacée (0 °C). Écart admis : ${fmtC(tol)}. Sinon, le régler ou le remplacer`, where: 'Thermomètres' },
        { when: 'Chaque mois', what: 'Regarder les documents qui arrivent à échéance (prévenu 30 jours avant)', where: 'Documents & PMS › Documents (gérant)' },
      ],
    },
    {
      id: 'sometimes',
      title: 'Seulement quand il le faut',
      steps: [
        { when: 'Température pas bonne', what: 'Dire ce que vous avez fait (action corrective), puis refaire une mesure', where: 'S’ouvre tout seul' },
        { when: 'Produit jeté', what: 'Le déclarer avec son motif', where: 'Produits jetés' },
        { when: 'Erreur de saisie', what: 'Corriger : l’ancienne valeur reste visible, barrée', where: 'Historique de l’écran › Corriger' },
        { when: 'Rappel produit', what: 'Chercher le lot, retirer le produit, noter le retrait', where: 'Documents & PMS › Rappel produit (gérant)' },
        { when: 'Contrôle sanitaire', what: 'Choisir la période, Vérifier, puis Préparer le dossier PDF', where: 'Documents & PMS › Mode Contrôle (gérant)' },
        { when: 'Recette ou produit changé', what: 'Mettre à jour la fiche, puis refaire le PMS et le tableau des allergènes', where: 'Gestion, puis Documents & PMS' },
      ],
    },
  ]
}

/** Ce que l'application fait toute seule (rien à faire). */
export const AUTOMATIC: readonly string[] = [
  'Chaque saisie est enregistrée tout de suite sur l’iPad, même sans Internet, puis envoyée au serveur dès qu’il y a du réseau.',
  'Le serveur est sauvegardé chaque nuit (registres, photos et réglages).',
  'À chaque ouverture, l’application vérifie s’il existe une nouvelle version et propose « Mettre à jour ».',
  'Après l’ouverture du camion : alerte si un relevé est oublié ou hors seuil, même application fermée (notifications activées).',
  'La date limite d’une étiquette ne dépasse jamais la DLC du fabricant.',
]
