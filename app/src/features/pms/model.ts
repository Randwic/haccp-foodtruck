// Assistant PMS (lot 7) : questionnaire (ce que l'application ne sait pas) + contenu du plan de maîtrise
// sanitaire construit avec les données de l'application (équipements, seuils, produits, recettes, nettoyage,
// checklists, fournisseurs, huiles, équipe, documents). Fonctions pures, testées dans pms.test.ts.
// Trame : règlement (CE) 852/2004, GBPH restauration, arrêté du 21/12/2009 ; adaptée à un food truck.
import { ALLERGEN_LABELS, type Allergen, type Checklist, type CleaningTask, type DocumentRef, type Product, type Recipe, type Supplier } from '../../../../shared/payloads.ts'
import type { Equipment, Settings, Threshold } from '../../../../shared/types.ts'
import { kindLabel } from '../../manager/helpers.ts'
import { describeThreshold, formatTemperature } from '../../ui/temperature.ts'
import { CHECKLIST_KIND_LABELS, FREQUENCY_LABELS } from '../cleaning/model.ts'
import { CATEGORY_LABELS, formatIsoDay } from '../documents/model.ts'
import { menuAllergenTable } from '../labels/allergenTable.ts'
import { allergenProfile, catalogOf } from '../labels/allergens.ts'
import { formatShelfLife } from '../labels/model.ts'
import { spotRule, timedRule } from '../processes/thresholds.ts'
import type { Cell, Column } from '../documents/report.ts'

// ---------- Questionnaire ----------

export const PMS_ANSWERS_VERSION = 1

export interface PmsAnswers {
  v: typeof PMS_ANSWERS_VERSION
  legal_name: string
  owner: string
  address: string
  siret: string
  ddpp: string
  contact: string
  activity: string
  schedule: string
  locations: string
  trailer: string
  water: string
  energy: string
  staff: string
  training: string
  hygiene: string
  health: string
  supplies: string
  pests: string
  waste: string
  allergens: string
  recall: string
  verification: string
  place: string
}

export type PmsField = Exclude<keyof PmsAnswers, 'v'>

export interface PmsQuestion {
  field: PmsField
  label: string
  hint?: string
  /** Champ court (une ligne) ; sinon zone de texte. */
  short?: boolean
  /** Obligatoire dans un PMS : signalé « à compléter » s'il est vide. */
  required?: boolean
}

export interface PmsStep {
  id: string
  title: string
  intro: string
  questions: PmsQuestion[]
}

export const PMS_STEPS: readonly PmsStep[] = [
  {
    id: 'identity',
    title: 'Établissement',
    intro: 'Les informations administratives qui figurent en première page du plan.',
    questions: [
      { field: 'legal_name', label: 'Nom de l’entreprise', hint: 'Nom commercial et forme juridique (ex. « Space Diner – EI »).', short: true, required: true },
      { field: 'owner', label: 'Responsable (exploitant)', short: true, required: true },
      { field: 'address', label: 'Adresse du siège', hint: 'Adresse de domiciliation de l’entreprise.', short: true, required: true },
      { field: 'siret', label: 'Numéro SIRET', short: true, required: true },
      { field: 'ddpp', label: 'Déclaration à la DDPP', hint: 'Numéro et date du récépissé de déclaration d’activité (Cerfa 13984).', short: true, required: true },
      { field: 'contact', label: 'Téléphone et email', short: true },
    ],
  },
  {
    id: 'activity',
    title: 'Activité et remorque',
    intro: 'Ce que vous faites, où et quand, et comment la remorque est équipée.',
    questions: [
      { field: 'activity', label: 'Activité', required: true },
      { field: 'schedule', label: 'Jours et horaires', required: true },
      { field: 'locations', label: 'Emplacements habituels', hint: 'Marchés, parkings, événements…' },
      { field: 'trailer', label: 'Remorque et aménagement', hint: 'Les équipements enregistrés dans l’application sont ajoutés automatiquement.' },
      { field: 'water', label: 'Eau potable, lavage des mains et eaux usées', required: true },
      { field: 'energy', label: 'Énergie', hint: 'Branchement électrique, groupe électrogène, gaz…' },
    ],
  },
  {
    id: 'staff',
    title: 'Personnel',
    intro: 'Qui travaille dans la remorque et comment l’hygiène du personnel est assurée.',
    questions: [
      { field: 'staff', label: 'Personnes qui travaillent', required: true },
      { field: 'training', label: 'Formation à l’hygiène', required: true },
      { field: 'hygiene', label: 'Tenue et lavage des mains', required: true },
      { field: 'health', label: 'État de santé', hint: 'Conduite à tenir en cas de maladie ou de blessure.' },
    ],
  },
  {
    id: 'practices',
    title: 'Achats et bonnes pratiques',
    intro: 'Approvisionnement, nuisibles, déchets, allergènes, retrait et rappel de produits.',
    questions: [
      { field: 'supplies', label: 'Achats et transport des marchandises', required: true },
      { field: 'pests', label: 'Lutte contre les nuisibles', required: true },
      { field: 'waste', label: 'Déchets et huiles usagées', required: true },
      { field: 'allergens', label: 'Allergènes : information des clients et précautions' },
      { field: 'recall', label: 'Retrait et rappel de produits', required: true },
      { field: 'verification', label: 'Vérification du plan', hint: 'Quand et comment vous relisez le plan et les registres.' },
      { field: 'place', label: 'Fait à', hint: 'Ville de signature.', short: true },
    ],
  },
]

/** Réponses proposées : ce que l'on sait du Space Diner, à relire et adapter. */
export function defaultAnswers(ctx: { establishmentName: string; ownerName: string }): PmsAnswers {
  return {
    v: PMS_ANSWERS_VERSION,
    legal_name: ctx.establishmentName,
    owner: ctx.ownerName,
    address: '',
    siret: '',
    ddpp: '',
    contact: '',
    activity:
      'Restauration rapide ambulante (food truck) : burgers « Croq’Brioche », frites, nuggets, desserts et menus enfant, préparés dans la remorque et vendus à emporter. Viandes cuites à la plancha, frites et nuggets à la friteuse, quelques préparations maison (sauces, garnitures) faites le jour même.',
    schedule: 'Services du jeudi au samedi de 18 h 30 à 21 h ; préparation sur place de 16 h à 18 h 30.',
    locations: '',
    trailer:
      'Remorque aménagée en cuisine : parois et plans de travail lisses et lavables, rangement des denrées séparé du matériel de nettoyage. Matériel décrit ci-dessous (enceintes froides, friteuses, plancha, bain-marie, machine à sceller).',
    water:
      'Eau potable du réseau public, transportée dans un réservoir alimentaire propre (rincé et désinfecté chaque semaine). Lave-mains avec eau, savon liquide et essuie-mains à usage unique. Eaux usées recueillies dans un réservoir séparé, vidé dans un point prévu à cet effet après chaque service.',
    energy: '',
    staff: 'Exploitant seul, avec l’aide ponctuelle d’un membre de la famille formé aux règles d’hygiène de ce plan.',
    training: 'Formation hygiène alimentaire en restauration commerciale (14 heures) suivie en décembre 2026 ; attestation conservée dans les documents de l’application. Les aides éventuelles sont formées par l’exploitant aux règles de ce plan.',
    hygiene:
      'Tenue propre réservée au travail, cheveux couverts, bijoux retirés, ongles courts. Lavage des mains (savon, 30 secondes) à l’arrivée, après les toilettes, après avoir manipulé des déchets, de la viande crue, de l’argent ou les poubelles, et entre deux tâches. Gants à usage unique changés aussi souvent que nécessaire.',
    health: 'Personne malade (diarrhée, vomissements, fièvre) : ne travaille pas en cuisine. Plaie aux mains : pansement étanche et gant.',
    supplies:
      'Achats faits par l’exploitant chez Metro (cash & carry), fournisseur professionnel. Transport en glacières isothermes avec plaques eutectiques, trajet court ; produits frais et surgelés rangés dès l’arrivée. Contrôle à l’arrivée : température des produits frais et surgelés, dates (DLC / DDM), état des emballages, enregistré dans l’application avec photo de l’étiquette et numéro de lot.',
    pests:
      'Autocontrôle : inspection de la remorque à l’ouverture (checklist), denrées dans des bacs fermés, remorque fermée hors service, poubelles fermées et vidées après chaque service. Pas de piège ni d’appât à l’intérieur de la remorque.',
    waste:
      'Poubelle à couvercle et sacs fermés, évacués après chaque service dans les conteneurs prévus. Huiles de friture usagées stockées dans des bidons fermés et remises à un collecteur agréé (bon de collecte conservé).',
    allergens:
      'Tableau des 14 allergènes affiché à la remorque, tenu à jour à partir des recettes de l’application. Le client est invité à signaler toute allergie avant de commander. Friteuse et plancha communes : des traces sont possibles, ce qui est indiqué au client.',
    recall:
      'En cas de rappel d’un produit (RappelConso, information de Metro) ou de produit dangereux découvert : retirer immédiatement les produits du lot concerné (le registre de réception et les étiquettes indiquent les lots), les isoler avec la mention « Ne pas utiliser », les enregistrer dans « Produits jetés » (motif rappel), prévenir le fournisseur et, si des produits ont pu être servis, informer la DDPP du département.',
    verification:
      'Chaque semaine : relecture des registres de l’application (relevés manqués, actions correctives). Chaque année ou à chaque changement (nouvelle recette, nouveau matériel, nouveau fournisseur) : relecture et mise à jour du plan, nouvelle version enregistrée dans les documents.',
    place: '',
  }
}

/** Champs obligatoires restés vides. */
export function missingAnswers(a: PmsAnswers): PmsQuestion[] {
  return PMS_STEPS.flatMap((s) => s.questions).filter((q) => q.required && !a[q.field].trim())
}

/** Réponses relues (brouillon, PDF) : champs inconnus ignorés, champs manquants = proposition par défaut. */
export function parseAnswers(raw: unknown, defaults: PmsAnswers): PmsAnswers | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (r.v !== PMS_ANSWERS_VERSION) return null
  const out: PmsAnswers = { ...defaults }
  for (const k of Object.keys(defaults) as (keyof PmsAnswers)[]) {
    if (k !== 'v' && typeof r[k] === 'string') out[k] = (r[k] as string).slice(0, 4000)
  }
  return out
}

// ---------- Données de l'application ----------

export interface PmsAppData {
  establishmentName: string
  settings: Settings | null
  equipment: Equipment[]
  thresholds: Threshold[]
  products: Product[]
  recipes: Recipe[]
  cleaningTasks: CleaningTask[]
  checklists: Checklist[]
  suppliers: Supplier[]
  staff: { display_name: string; role: string; active: boolean }[]
  documents: DocumentRef[] | null
}

// ---------- Contenu ----------

export type PmsBlock =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'p'; text: string; tone?: 'muted' | 'warn' }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'kv'; rows: [string, string][] }
  | { kind: 'table'; columns: Column[]; rows: Cell[][]; empty?: string; size?: number }
  | { kind: 'callout'; text: string; tone: 'info' | 'warn' }
  | { kind: 'break' }

export interface PmsDocument {
  title: string
  versionLabel: string
  cover: [string, string][]
  blocks: PmsBlock[]
  /** Champs obligatoires non remplis (signalés dans le document). */
  missing: string[]
}

const TODO = 'À compléter'
const t = (v: number) => formatTemperature(v).replace(/ /g, ' ')
const th = (x: { min_c: number | null; max_c: number | null }) => describeThreshold(x).replace(/ /g, ' ')
const val = (s: string) => s.trim() || TODO
const allergenList = (list: readonly Allergen[]) => (list.length ? list.map((a) => ALLERGEN_LABELS[a]).join(', ') : '—')

export function buildPmsDocument(a: PmsAnswers, app: PmsAppData, opts: { version: number; date: Date; timeZone: string }): PmsDocument {
  const date = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: opts.timeZone }).format(opts.date)
  const name = a.legal_name.trim() || app.establishmentName || 'Établissement'
  const blocks: PmsBlock[] = []
  const B = (b: PmsBlock) => blocks.push(b)
  const thresholds = app.thresholds
  const equipment = app.equipment.filter((e) => e.active).sort((x, y) => x.name.localeCompare(y.name, 'fr'))
  const cold = equipment.filter((e) => e.kind === 'fridge' || e.kind === 'freezer')
  const fryers = equipment.filter((e) => e.kind === 'fryer_vat')
  const eqThreshold = (e: Equipment) => thresholds.find((x) => x.equipment_id === e.id && (x.check_type === 'temperature_check' || x.check_type === 'hot_holding'))
  const cooling = timedRule('cooling', thresholds)
  const reheating = timedRule('reheating', thresholds)
  const hot = spotRule('hot_holding', thresholds)
  const cook = spotRule('cooking_check', thresholds)
  const products = app.products.filter((p) => p.active).sort((x, y) => x.name.localeCompare(y.name, 'fr'))
  const cookProducts = products.filter((p) => p.cook_min_c !== null)
  // Pain du boulanger : procédure propre (durée après achat, congélation possible du reste).
  const bread = products.find((p) => /^pain\b/i.test(p.name))
  const preparations = app.recipes.filter((r) => r.active && r.kind === 'preparation').sort((x, y) => x.name.localeCompare(y.name, 'fr'))
  const checkTimes = app.settings?.daily_check_times ?? []
  const oilMax = app.settings?.oil_polar_max ?? 25
  const oilWarn = app.settings?.oil_polar_warn ?? 22
  const thawDays = app.settings?.thaw_dlc_days ?? 3
  const missing = missingAnswers(a).map((q) => q.label)

  // ---- 0. Présentation ----
  B({ kind: 'h1', text: '1. Présentation de l’établissement' })
  B({
    kind: 'kv',
    rows: [
      ['Entreprise', val(a.legal_name)],
      ['Responsable', val(a.owner)],
      ['Siège', val(a.address)],
      ['SIRET', val(a.siret)],
      ['Déclaration DDPP', val(a.ddpp)],
      ['Contact', a.contact.trim() || '—'],
      ['Emplacements', a.locations.trim() || 'Variables (marchés, événements) : liste tenue à jour par l’exploitant.'],
    ],
  })
  B({ kind: 'h2', text: 'Activité' })
  B({ kind: 'p', text: val(a.activity) })
  B({ kind: 'h2', text: 'Jours et horaires' })
  B({ kind: 'p', text: val(a.schedule) })
  B({ kind: 'h2', text: 'Remorque et matériel' })
  B({ kind: 'p', text: val(a.trailer) })
  B({
    kind: 'table',
    columns: [
      { title: 'Équipement', width: 2.4 },
      { title: 'Type', width: 1.6 },
      { title: 'Température à respecter', width: 2.6 },
    ],
    rows: equipment.map((e) => {
      const x = eqThreshold(e)
      return [e.name, kindLabel(e.kind), x ? th(x) : e.kind === 'fryer_vat' ? `Huile : composés polaires au plus ${oilMax} %` : '—']
    }),
    empty: 'Aucun équipement enregistré dans l’application.',
  })
  if (a.energy.trim()) {
    B({ kind: 'h2', text: 'Énergie' })
    B({ kind: 'p', text: a.energy })
  }
  B({ kind: 'h2', text: 'Eau' })
  B({ kind: 'p', text: val(a.water) })
  B({
    kind: 'callout',
    tone: 'info',
    text: 'Ce plan s’appuie sur l’application HACCP de la remorque : chaque contrôle y est enregistré (date, heure, auteur), les écarts imposent une action corrective, et rien ne peut être effacé. Les registres cités dans ce plan sont ceux de l’application.',
  })

  // ---- 2. Bonnes pratiques d'hygiène ----
  B({ kind: 'h1', text: '2. Bonnes pratiques d’hygiène' })
  B({ kind: 'h2', text: '2.1 Personnel' })
  B({ kind: 'kv', rows: [['Effectif', val(a.staff)], ['Formation', val(a.training)], ['Tenue et mains', val(a.hygiene)], ['Santé', a.health.trim() || '—']] })
  const team = app.staff.filter((s) => s.active)
  if (team.length) B({ kind: 'p', text: `Personnes enregistrées dans l’application : ${team.map((s) => `${s.display_name} (${s.role === 'manager' ? 'gérant' : 'équipier'})`).join(', ')}.`, tone: 'muted' })

  B({ kind: 'h2', text: '2.2 Achats et réception des marchandises' })
  B({ kind: 'p', text: val(a.supplies) })
  B({
    kind: 'bullets',
    items: [
      'Produits réfrigérés : au plus +4 °C à l’arrivée ; surgelés : au plus −18 °C. Au-delà : produit refusé ou jeté, ou action corrective enregistrée.',
      'Dates vérifiées (DLC dépassée ou trop courte : refus), emballages intacts.',
      `Fournisseurs enregistrés : ${app.suppliers.filter((s) => s.active).map((s) => s.name).join(', ') || 'à enregistrer dans l’application'}.`,
      'Enregistrement : registre « Achats & réception » (produits, lots, dates, températures, photos des étiquettes et du ticket).',
    ],
  })

  B({ kind: 'h2', text: '2.3 Stockage et maîtrise des températures' })
  B({
    kind: 'p',
    text: `Relevé de la température de chaque enceinte froide ${checkTimes.length ? `à ${checkTimes.join(' et à ')}` : 'à chaque service'}, enregistré dans le registre « Températures ». Hors seuil : action corrective obligatoire (réglage, transfert ou destruction des produits).`,
  })
  B({
    kind: 'table',
    columns: [
      { title: 'Enceinte', width: 2.4 },
      { title: 'Seuil', width: 2 },
      { title: 'Contrôle', width: 2.2 },
    ],
    rows: cold.map((e) => {
      const x = eqThreshold(e)
      return [e.name, x ? th(x) : TODO, checkTimes.length ? `Relevé à ${checkTimes.join(', ')}` : 'Relevé à chaque service']
    }),
    empty: 'Aucune enceinte froide enregistrée.',
  })
  B({
    kind: 'bullets',
    items: [
      'Produits rangés dès l’arrivée, cru et cuit séparés, denrées couvertes et étiquetées.',
      `Décongélation uniquement en enceinte froide, enregistrée ; DLC fixée à ${thawDays} jour${thawDays > 1 ? 's' : ''} après la fin de la décongélation, jamais recongelé${bread ? ' (sauf le pain, voir ci-dessous)' : ''}.`,
      'Produits entamés et préparations maison étiquetés (nom, date, DLC, allergènes) avec l’imprimante d’étiquettes ; durées en annexe.',
      ...(bread
        ? [
            `${bread.name} (boulanger, sans DLC du fabricant) : gardé ${formatShelfLife(bread.shelf_life_opened_hours ?? 96)} après l’achat. Le reste peut être congelé avant la fin de ce délai, bien emballé, avec la date de congélation, 1 mois au plus à −18 °C ; décongelé dans son sachet à température ambiante, servi dans les ${formatShelfLife(bread.shelf_life_thawed_hours ?? 24)}, jamais recongelé.`,
          ]
        : []),
    ],
  })

  B({ kind: 'h2', text: '2.4 Nettoyage et désinfection' })
  B({ kind: 'p', text: 'Plan de nettoyage suivi dans l’application : chaque tâche faite est enregistrée (avec photo si besoin) ; les tâches en retard sont signalées.' })
  B({
    kind: 'table',
    columns: [
      { title: 'Quoi', width: 2 },
      { title: 'Fréquence', width: 1.5 },
      { title: 'Produit', width: 1.6 },
      { title: 'Comment', width: 3.2 },
    ],
    rows: app.cleaningTasks
      .filter((x) => x.active)
      .sort((x, y) => x.name.localeCompare(y.name, 'fr'))
      .map((x) => [x.name, FREQUENCY_LABELS[x.frequency], x.product ?? '—', x.method ?? '—']),
    empty: 'Plan de nettoyage à saisir dans Gestion › Nettoyage.',
    size: 8.5,
  })
  const lists = app.checklists.filter((c) => c.active)
  if (lists.length) {
    B({ kind: 'h2', text: '2.5 Checklists' })
    B({
      kind: 'table',
      columns: [
        { title: 'Checklist', width: 1.6 },
        { title: 'Points contrôlés', width: 5 },
      ],
      rows: lists.map((c) => [`${c.name} (${CHECKLIST_KIND_LABELS[c.kind].toLowerCase()})`, c.items.map((i) => i.label).join(' ; ')]),
      size: 8.5,
    })
    B({ kind: 'p', text: 'Tout point « non » est commenté dans l’application (ce qui a été fait).', tone: 'muted' })
  }

  B({ kind: 'h2', text: `${lists.length ? '2.6' : '2.5'} Lutte contre les nuisibles` })
  B({ kind: 'p', text: val(a.pests) })
  B({ kind: 'h2', text: `${lists.length ? '2.7' : '2.6'} Déchets et huiles usagées` })
  B({ kind: 'p', text: val(a.waste) })

  // ---- 3. Plan HACCP ----
  B({ kind: 'h1', text: '3. Plan HACCP : dangers et points de maîtrise' })
  B({
    kind: 'p',
    text: 'Pour chaque étape, le danger principal, ce qui le maîtrise, la limite à respecter, le contrôle, ce qu’on fait en cas d’écart et le registre où c’est noté. CCP = point critique (le danger n’est éliminé qu’à cette étape) ; PRPo = bonne pratique opérationnelle surveillée.',
    tone: 'muted',
  })
  const cookLimits = cookProducts.length
    ? cookProducts.map((p) => `${p.name} : au moins ${t(p.cook_min_c!)} à cœur`).join(' ; ') + ` ; autres : ${th(cook.threshold)}`
    : `${th(cook.threshold)} à cœur`
  const plan: Cell[][] = [
    ['Réception (PRPo)', 'Microbes qui se multiplient (rupture du froid), produit périmé ou abîmé', 'Achat chez un fournisseur professionnel, transport isotherme, trajet court', 'Frais : au plus +4 °C ; surgelés : au plus −18 °C ; DLC valable', 'Thermomètre et lecture des étiquettes à chaque achat', 'Refus ou destruction, action corrective', 'Achats & réception'],
    ['Stockage au froid (CCP)', 'Multiplication des microbes', 'Enceintes réglées, non surchargées, portes fermées', cold.map((e) => `${e.name} : ${eqThreshold(e) ? th(eqThreshold(e)!) : TODO}`).join(' ; ') || TODO, `Relevé ${checkTimes.length ? `à ${checkTimes.join(' et ')}` : 'à chaque service'}`, 'Réglage, transfert ou destruction selon la durée de l’écart', 'Températures'],
    ['Décongélation (PRPo)', 'Multiplication des microbes', 'En enceinte froide uniquement', `DLC : ${thawDays} jour(s) après la fin`, 'Début et fin enregistrés, étiquette DLC', 'Produit jeté si DLC dépassée', 'Décongélation, Étiquettes'],
    ['Préparation, assemblage (PRPo)', 'Contamination croisée (cru / cuit, allergènes, mains)', 'Lavage des mains, ustensiles et planches distincts, plans nettoyés, denrées sorties du froid juste avant usage', 'Bonnes pratiques du chapitre 2', 'Checklists d’ouverture et de fermeture', 'Produit jeté en cas de doute', 'Checklists, Nettoyage'],
    ['Cuisson (CCP)', 'Survie de microbes (salmonelles, E. coli…)', 'Cuisson suffisante, sonde nettoyée et désinfectée', cookLimits, 'Température à cœur mesurée à la sonde', 'Poursuivre la cuisson jusqu’à la température', 'Cuisson & maintien'],
    ['Maintien au chaud (PRPo)', 'Multiplication des microbes', 'Bain-marie préchauffé, bacs couverts', `${th(hot.threshold)} à cœur`, 'Mesure pendant le service', 'Remise à température rapide ou destruction', 'Cuisson & maintien'],
    ['Refroidissement (CCP)', 'Multiplication des microbes', 'Refroidissement rapide (bacs peu épais, cellule ou froid)', `De ${th(cooling.start ?? { min_c: 63, max_c: null })} à ${th(cooling.target)} en ${cooling.maxMinutes} min au plus`, 'Température au début et à la fin, durée calculée', 'Produit jeté si objectif non atteint', 'Refroidissement'],
    ['Remise en température (CCP)', 'Multiplication des microbes', 'Réchauffage rapide d’une préparation refroidie', `${th(reheating.target)} en ${reheating.maxMinutes} min au plus`, 'Température à cœur et durée', 'Poursuivre ou jeter', 'Remise en température'],
    ['Friture (PRPo)', 'Huile dégradée (composés polaires)', `Contrôle de l’huile${fryers.length ? ` (${fryers.map((f) => f.name).join(', ')})` : ''}, filtrage, changement`, `Au plus ${oilMax} % (alerte à ${oilWarn} %)`, 'Testeur ou bandelette', 'Changement de l’huile', 'Huiles de friture'],
    ['Information allergènes (PRPo)', 'Réaction allergique d’un client', 'Recettes à jour, tableau affiché, fiches techniques', 'Les 14 allergènes réglementaires déclarés', 'Tableau régénéré à chaque modification de recette', 'Retrait du plat, information du client', 'Tableau des allergènes'],
  ]
  B({
    kind: 'table',
    columns: [
      { title: 'Étape', width: 1.3 },
      { title: 'Danger', width: 1.6 },
      { title: 'Mesure de maîtrise', width: 1.9 },
      { title: 'Limite', width: 1.8 },
      { title: 'Surveillance', width: 1.5 },
      { title: 'En cas d’écart', width: 1.5 },
      { title: 'Registre', width: 1.1 },
    ],
    rows: plan,
    size: 7.5,
  })

  // ---- 4. Traçabilité, non-conformités, allergènes ----
  B({ kind: 'h1', text: '4. Traçabilité et gestion des non-conformités' })
  B({ kind: 'h2', text: 'Traçabilité' })
  B({
    kind: 'bullets',
    items: [
      'Amont : chaque achat est enregistré (fournisseur, produits, lots, dates, photos des étiquettes et du ticket).',
      'Interne : chaque produit entamé, préparation maison ou produit décongelé reçoit une étiquette (date, DLC, lot, allergènes) dont l’impression est enregistrée.',
      'Les enregistrements sont conservés au moins 3 ans et sauvegardés automatiquement chaque semaine.',
    ],
  })
  B({ kind: 'h2', text: 'Actions correctives' })
  B({ kind: 'p', text: 'Toute mesure hors seuil saisie dans l’application impose une action corrective (produit jeté, transféré, remis en température, matériel réglé, technicien appelé…) avec l’auteur et l’heure. Une erreur de saisie est corrigée par une nouvelle saisie motivée ; l’original reste visible.' })
  B({ kind: 'h2', text: 'Retrait et rappel de produits' })
  B({ kind: 'p', text: val(a.recall) })
  B({ kind: 'h2', text: 'Allergènes' })
  B({ kind: 'p', text: val(a.allergens) })
  const table = menuAllergenTable(app.recipes, app.products)
  B({
    kind: 'table',
    columns: [
      { title: 'Plat', width: 2 },
      { title: 'Allergènes présents', width: 3 },
      { title: 'Peut contenir (traces)', width: 2.4 },
    ],
    rows: table.groups.flatMap((g) => g.rows.map((r): Cell[] => [`${r.name} (${g.title})`, allergenList(r.allergens), allergenList(r.traces)])),
    empty: 'Aucun plat du menu enregistré.',
    size: 8,
  })

  // ---- 5. Vérification ----
  B({ kind: 'h1', text: '5. Vérification et mise à jour du plan' })
  B({ kind: 'p', text: val(a.verification) })
  if (app.documents) {
    B({ kind: 'h2', text: 'Documents tenus à disposition' })
    B({
      kind: 'table',
      columns: [
        { title: 'Document', width: 3 },
        { title: 'Catégorie', width: 2.4 },
        { title: 'Échéance', width: 1.2 },
      ],
      rows: app.documents.filter((d) => d.active && d.category !== 'pms').map((d) => [d.title, CATEGORY_LABELS[d.category], d.valid_until ? formatIsoDay(d.valid_until) : '—']),
      empty: 'Aucun document enregistré pour l’instant.',
    })
  }

  // ---- Annexes ----
  B({ kind: 'h1', text: 'Annexe 1 : produits utilisés' })
  const storage = { fridge: 'Frigo', freezer: 'Congélateur', ambient: 'Ambiant' } as const
  B({
    kind: 'table',
    columns: [
      { title: 'Produit', width: 2.2 },
      { title: 'Conservation', width: 1.1 },
      { title: 'Après ouverture', width: 1.4 },
      { title: 'Cuisson à cœur', width: 1.1 },
      { title: 'Allergènes (traces)', width: 2.6 },
    ],
    rows: products.map((p) => [
      p.name,
      storage[p.storage],
      p === bread && p.shelf_life_opened_hours !== null
        ? `${formatShelfLife(p.shelf_life_opened_hours)} après achat`
        : p.shelf_life_opened_hours === null
          ? 'Selon l’étiquette'
          : formatShelfLife(p.shelf_life_opened_hours),
      p.cook_min_c === null ? '—' : `au moins ${t(p.cook_min_c)}`,
      `${allergenList(p.allergens)}${p.may_contain.length ? ` (traces : ${allergenList(p.may_contain)})` : ''}`,
    ]),
    size: 7.5,
  })
  B({ kind: 'h1', text: 'Annexe 2 : préparations maison' })
  const catalog = catalogOf(app.products, app.recipes)
  B({
    kind: 'table',
    columns: [
      { title: 'Préparation', width: 2.2 },
      { title: 'Conservation', width: 1.1 },
      { title: 'Durée de vie', width: 1.2 },
      { title: 'Allergènes', width: 3 },
    ],
    rows: preparations.map((r) => [
      r.name,
      // Préparation tenue au chaud (ex. poivrons au bain-marie) : « ambiant » au contrat, quelques heures au plus.
      r.storage === 'ambient' && (r.shelf_life_hours ?? 0) <= 6 ? 'Au chaud (bain-marie)' : storage[r.storage],
      formatShelfLife(r.shelf_life_hours),
      allergenList(allergenProfile(r, catalog).present),
    ]),
    empty: 'Aucune préparation maison enregistrée.',
    size: 8,
  })

  return {
    title: `Plan de maîtrise sanitaire — ${name}`,
    versionLabel: `Version ${opts.version} du ${date}`,
    cover: [
      ['Entreprise', val(a.legal_name)],
      ['Responsable', val(a.owner)],
      ['Version', `${opts.version}, établie le ${date}`],
      ['Signature', `Fait à ${a.place.trim() || '…………………'}, le ${date}. Signature de l’exploitant :`],
    ],
    blocks,
    missing,
  }
}
