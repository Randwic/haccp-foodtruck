# Interface (lot 1)

## Branchement du core et de l'espace gérant — un seul endroit
`app/src/main.tsx` crée le core **et** l'espace gérant et les passe à `<App core={core} manager={manager} />`.
L'interface ne dépend que de `CoreApi` (`app/src/core/api.ts`, via `useCore()`) et de `ManagerApi`
(`app/src/manager/api.ts`, via `useManager()`).

| Situation | Core | Espace gérant |
|---|---|---|
| `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` | vrai core + `createHttpTransport` | `createSupabaseManagerApi` (fonctions `bootstrap-status`, `bootstrap-manager`, `device-enroll` + supabase-js REST/RLS, session persistée) |
| sans Supabase | vrai core + serveur simulé (`createMockTransport`) | `createMockManagerApi` branché sur ce serveur (écritures répercutées, état gardé dans localStorage) ; premier lancement par défaut, `?mock=seeded` = compte existant `gerant@demo.fr` / `demo-demo-demo` |
| `?demo=…`, `?sync=…`, `?staff=…` | `createFakeCore()` | mock « seeded », déjà connecté |

Paramètres de démo (fakeCore) : `?demo=enrolled|unlocked`, `?sync=pending|error|stale|rejected|offline`, `?staff=empty`,
`&releves=demo` (7 jours de relevés, une correction, une action corrective) ou `&releves=alerte` (+ relevé hors seuil sans action ce matin),
`&procedes=demo` (lots en cours, cuissons, décongélations, historique avec correction et action) ou `&procedes=alerte` (+ refroidissement en retard, cuisson hors seuil sans action),
`&receptions=demo` (réceptions sur 3 jours avec refus, photos d'étiquettes dessinées, photos en attente, correction, action corrective, une perte) ou `&receptions=alerte` (+ produit accepté hors température sans action).
Équipiers factices : Gérant `123456`, Équipier `654321` (blocage 5 min après 5 erreurs).

## Écrans (`app/src/features/`)
| Écran | Fichier | Rôle |
|---|---|---|
| Premier lancement | `setup/SetupFlow.tsx` | si `getDevice()` est null. Hors-ligne → « Connectez l’appareil à Internet pour la première configuration ». `needs_bootstrap` → `BootstrapScreen` (4 étapes : vous, compte email + mot de passe ×2 ≥ 12 car. avec force, PIN 6 chiffres ×2, nom de l’appareil deviné « iPad »/« iPhone » + avertissement « inscription fermée définitivement ») → bootstrap → connexion → `device-enroll` → `core.enrollDevice` → `syncNow`. Sinon `ManagerLoginScreen` (email, mot de passe, nom d’appareil). 409 → bascule vers la connexion (email prérempli) ; 429, 422, mauvais mot de passe : messages lisibles |
| Configuration avancée | `enrollment/EnrollScreen.tsx` | ancien enrôlement manuel (identifiant + jeton), lien en bas de la connexion gérant |
| Gestion | `management/ManagementScreen.tsx` | tuile « Gestion » sur l’accueil si l’équipier déverrouillé est `manager`. Exige Internet + session gérant (sinon mot de passe redemandé, aussi si la session expire). Onglets **Équipements** (`EquipmentSection` : ajout nom + type, seuils préremplis frigo ≤ 4 °C / congélateur ≤ −18 °C « à confirmer selon votre PMS », renommer, retirer/remettre en service, seuils min/max/tolérance avec bouton ±), **Équipe** (`StaffSection` : ajout + PIN ×2, changer le PIN, désactiver/réactiver ; impossible de se désactiver soi-même), **Réglages** (`SettingsSection` : nom, heures des relevés `daily_check_times` 1 à 6 « HH:MM » sans doublon, verrouillage auto 1–30 min, interrupteur « Créneau oublié la veille reste à faire » (`missed_slot_carry_over`), « DLC après décongélation (jours) » 0–30 (`thaw_dlc_days`), déconnexion gérant). Confirmation pour chaque action sensible ; `core.syncNow()` après chaque écriture |
| Verrouillage | `lock/LockScreen.tsx` | tuiles équipiers (initiales), pavé PIN, « PIN incorrect », « Bloqué, réessayez dans 4 min 32 s » ; équipe vide → message + « Réessayer » (`syncNow()`), rechargement auto sur `onSyncStatusChange` |
| Aujourd'hui | `today/TodayScreen.tsx` | bandeaux rouges (relevé ou procédé hors seuil sans action corrective) ; rappel des lots chronométrés en cours (« 1 refroidissement en cours · 1 h 12 restante », ambre puis rouge) ; tuiles **Températures**, **Refroidissement**, **Remise en température**, **Cuisson & maintien**, **Décongélation** avec compteurs réels (icône + texte) ; autres modules « Bientôt » ; outils |
| Procédés | `processes/` | voir « Module Procédés » ci-dessous |
| Températures | `temperatures/TemperaturesScreen.tsx` | voir « Module Températures » ci-dessous |
| Réception | `reception/ReceptionScreen.tsx` | voir « Module Réception » ci-dessous |
| Test d'enregistrement | `system-test/SystemTestPanel.tsx` | `addRecord('system_test')`, 20 derniers enregistrements (heure, auteur, statut) |

Enchaînement, en-tête et verrouillage auto : `app/src/ui/AppShell.tsx`, `AppHeader.tsx`, `hooks/useAutoLock.ts`
(`getSettings().auto_lock_minutes`, défaut 5 ; revérifié au retour au premier plan car iOS suspend les minuteries).

## Module Températures (`app/src/features/temperatures/`)
- **Calcul pur** : `schedule.ts` (créneaux `settings.daily_check_times` en heure locale de `establishment.timezone`,
  changements d'heure compris ; créneau en cours = le plus récent passé, éventuellement celui de la veille ; une enceinte
  est « à faire » sans relevé depuis ce créneau ; `enclosureStatuses`, `summarize`), `readings.ts` (`buildReadings` :
  relevés reconstruits depuis le registre, corrections en chaîne rattachées à l'original, actions correctives liées au
  relevé ou à l'une de ses corrections, `missingAction` = valeur en vigueur hors seuil sans action).
- **Données** : `useTemperatureData.ts` (équipements `fridge`/`freezer` actifs, seuils, relevés des 9 derniers jours,
  rechargés à chaque changement de synchro) ; seuil = celui de l'équipement pour `temperature_check`, sinon le générique,
  sinon défaut du type (frigo ≤ 4 °C, congélateur ≤ −18 °C, affiché « par défaut »).
- **Écrans** : liste des enceintes (dernier relevé, statut du créneau, actions manquantes), saisie (`ReadingEntry`),
  action corrective bloquante après un relevé hors seuil, historique 7 jours par jour / enceinte (valeur, heure, auteur,
  conformité, action liée, synchro), correction (`CorrectionView` : nouvelle valeur + motif obligatoire →
  `addRecord('correction', { reason, replacement }, { supersedes_id: dernière version })`, original barré).
  Payloads pré-validés par `shared/validation.ts` (`validatePayload`).
- **Réutilisable par les procédés** : `ui/components/TemperatureInput.tsx` (interface documentée dans le fichier) +
  `ui/temperature.ts` (`isInRange`, `formatTemperature`, `describeThreshold`) ;
  `features/corrective-action/CorrectiveActionFlow.tsx` (`relatedRecordId`, `subject`, `detail`, `onDone`) et
  `actions.ts` (libellés des 6 actions du contrat).

## Module Procédés (`app/src/features/processes/`)
- **Calcul pur** (testé dans `processes.test.ts`) : `thresholds.ts` (seuil générique `equipment_id` null du `check_type`,
  sinon `DEFAULT_PROCESS_THRESHOLDS` ; durée max = `tolerance_minutes`, 0 → défaut), `entries.ts` (enregistrements
  d'origine + corrections en chaîne + actions correctives ; lots reconstruits par `batch_id` : ils survivent au
  rechargement), `timing.ts` (`evaluateEnd` : `in_range` et `duration_min` calculés par l'app, minutes arrondies au-dessus,
  bornées à 1440 ; chronomètre ok → ambre dans le dernier quart du délai (≥ 15 min) → rouge une fois dépassé, échéance
  incluse ; DLC par défaut = date locale de fin + `settings.thaw_dlc_days`), `notifications.ts` (échéance signalée une
  fois par lot : `Notification` via le service worker si permise — demandée au démarrage d'un lot —, sinon toast + vibration).
- **Données** : `useProcessData.ts` (équipements, seuils, réglages, 9 jours de `cooling`/`reheating`/`thawing`/
  `hot_holding`/`cooking_check`/`correction`/`corrective_action`, rechargés à chaque synchro) ; `DeadlineWatcher`
  monté dans `AppShell` tant qu'un équipier est connecté.
- **Écrans** : `TimedProcessScreen` (refroidissement et remise en température : lots en cours avec chronomètre et barre,
  démarrage — avertissement si départ < 63 °C —, mesure intermédiaire, clôture avec aperçu « objectif / délai »,
  action corrective obligatoire liée à l'étape `end`, historique par lot, correction d'une étape), `CookingScreen`
  (cuisson à cœur et maintien au chaud, suggestions des produits récents, équipement `hot_holding` facultatif),
  `ThawingScreen` (produit + frigo actif, décongélations en cours, fin avec DLC modifiable et raccourcis J+n,
  correction de la DLC). Corrections : `CorrectionForms.tsx` (motif obligatoire, remplacement complet, original barré).
  Tous les payloads passent par `validatePayload` avant `addRecord`.

## Module Réception (`app/src/features/reception/`, lot 3)
- **Calcul pur** (`model.ts`, testé dans `reception.test.ts`) : lecture des payloads `reception`/`waste`, réceptions
  reconstruites par `buildEntries` (corrections en chaîne, actions correctives liées à une version), seuils par
  conservation `RECEPTION_THRESHOLDS` (frigo ≤ 4 °C, congélateur ≤ −18 °C, ambiant sans contrôle — « à confirmer selon
  votre PMS », non configurables tant que le contrat n'a pas de seuil par conservation), `missingAction` = ligne acceptée
  hors seuil sans action, `diffReception` (ce qu'une correction a changé), suggestions de produits par fournisseur,
  `matchingReceptions` (lien perte → réception), `summarizeReceptions` (accueil).
- **Données** : `useReceptionData.ts` (fournisseurs y compris désactivés, 32 jours de `reception`/`waste`/`correction`/
  `corrective_action`, état des photos via `getPhotoStatuses`, rechargés à chaque changement de synchro).
- **Écrans** : accueil du module (actions manquantes, photos en attente / refusées, « Nouvelle réception »,
  « Perte / produit jeté », réceptions du jour, refus des 7 jours) ; `ReceptionForm` en 3 étapes (1 Livraison :
  fournisseur en cartes + « Nouveau fournisseur » pour le gérant (`NewSupplierModal`, Internet + session gérant, mot de
  passe redemandé si besoin), n° de BL, photo du BL, véhicule / emballages Oui/Non ; 2 Produits : `ItemEditor` — produit
  (suggestions du fournisseur, conservation reprise), lot, DLC ou DDM (`type=date`, DLC dépassée signalée), conservation,
  `TemperatureInput` (obligatoire hors ambiant), photos d'étiquette 0..5, décision Accepté/Refusé + motif obligatoire ;
  ligne acceptée hors seuil → encadré rouge « Refuser ce produit » / « Accepter avec action corrective » ; 3 Validation :
  récapitulatif, commentaire, enregistrement), plafond de 20 photos (compteur « photos n/20 ») ; après l'enregistrement,
  `CorrectiveActionFlow` lié à la réception si besoin. `WasteForm` (produit, lots déjà reçus en pastilles, quantité,
  motif parmi les 6 du contrat, commentaire obligatoire si « Autre », photo, lien facultatif vers une réception).
  `ReceptionHistory` (30 jours, onglets Réceptions / Pertes, filtre par fournisseur, refus en rouge, miniatures plein
  écran, statut d'envoi des photos, corrections : motif + valeurs d'origine barrées, actions correctives, « Corriger »
  rouvre le parcours pré-rempli avec motif obligatoire → `correction` qui vise la dernière version).
- **Points d'extension** (`extensions.ts`) : `registerReceptionExtensions({ readLabel, scanBarcode })` — lecture OCR
  d'une photo d'étiquette (pré-remplit les champs vides, « Lu sur l'étiquette : vérifiez »), scan GTIN (bouton affiché
  seulement si branché) ; `findByLot` (model.ts) pour la recherche de lot / rappel.

## Photos (`app/src/ui/photos/`)
`PhotoPicker` (`<input type=file accept=image/* capture=environment>`, compression par `core.addPhoto`, miniatures
retirables — un brouillon retiré est effacé —, plafond par champ et global), `PhotoThumb` / `PhotoGallery` (pastille
« en attente » / « refusée »), `PhotoViewer` (plein écran, précédente/suivante, Échap), `usePhotoUrl` (copie locale, sinon
`manager.downloadPhoto` si une session gérant existe). Gestion › **Fournisseurs** (`management/SupplierSection.tsx`) :
ajout (nom, téléphone, email facultatifs, `normalizeSupplierInput`), modification, désactivation / réactivation.

## Synchro et PWA (`app/src/ui/`)
- `SyncIndicator.tsx` + `syncState.ts` : vert « Tout est synchronisé », orange « N saisies en attente » (ou « N photos
  en attente »), rouge si erreur, saisies ou photos refusées, attente > 24 h ; détail (dont photos en attente / refusées)
  + « Synchroniser maintenant » au toucher. Le `.wasm` de l'encodeur WebP est précaché (hors-ligne).
- `pwa/InstallBanner.tsx`, `pwa/InstallGuide.tsx` : bannière si non installée (`display-mode: standalone` / `navigator.standalone`), guide illustré iPhone/iPad.
- `pwa/UpdatePrompt.tsx` : « Nouvelle version disponible – Mettre à jour » (`useRegisterSW`).
- `pwa/OfflineBanner.tsx` : « Hors-ligne – vos saisies sont enregistrées sur l'appareil ».
- `requestPersistentStorage()` appelé au démarrage (résultat visible dans le détail de synchro).

## Composants (`app/src/ui/components/`)
`Button` (≥ 56 px), `Tile` (`layout="card"` module, `"row"` outil, `status`/`tone` pour un compteur),
`TemperatureInput` (pavé numérique intégré, touche « − » et virgule, 1 décimale, −50..300, « Conforme »/« Hors seuil » en direct), `Badge`, `Modal` (role=dialog, Échap, focus piégé), `PinPad` (touches ≥ 64 px, haptique, clavier physique), `PinSetup` (nouveau PIN saisi deux fois, refuse 000000/123456…), `TextField` + `Notice`, `Toast` (aria-live).
Les PIN sont hachés dans l’app (`hashPin`, PBKDF2) : seuls `pin_salt`/`pin_hash` sont envoyés.
Thème clair/sombre automatique, contrastes AA, focus cyan visible, zones sûres (`safe-pt/pb/px` dans `ui/theme.css`).

## Tests
`cd app && npx vitest run` — premier lancement (création complète avec vrai core, 409, 429, mauvais mot de passe, hors-ligne, serveur injoignable), configuration avancée, Gestion (accès, session expirée, équipements, seuils, équipe, réglages, répercussion dans la base locale), PIN OK/KO/bloqué, équipe vide, verrouillage auto, synchro, enregistrement test, températures (saisie conforme, hors seuil →
action corrective obligatoire, action manquante signalée après rechargement, correction avec original barré, correction
hors seuil → action, compteur de l'accueil), créneaux (Europe/Paris, changements d'heure, report du créneau oublié
désactivable), heures de relevé, report et DLC après décongélation (Réglages), procédés (refroidissement conforme, hors délai →
action corrective, lot en cours après rechargement, remise en température, cuisson hors seuil, décongélation avec DLC,
correction d'une étape, compteurs de l'accueil).

## Identité visuelle (Space Diner)
- **Jetons** : `app/src/ui/theme.css` — variables CSS (`--canvas`, `--surface`, `--elevated`, `--pressed`, `--sunken`,
  `--line(-strong)`, `--fg(-muted|-subtle)`, `--accent`, `--ok`, `--warn`, `--danger(-strong)`…) redéfinies sous
  `prefers-color-scheme: dark`, exposées à Tailwind via `@theme inline` (`bg-surface`, `text-fg-muted`, `border-line`,
  `bg-ok-soft`, `shadow-card`…). **Aucune couleur Tailwind brute (slate, sky…) ni hex dans les composants.**
- **Couleurs** : sombre = fond bleu nuit #0A0E1F, texte blanc chrome #F4F1EC, action cyan #22E6F2 ; clair = fond #F4F5F8,
  cartes blanches, texte #0A0E1F, action cyan foncé #0A6C75. Rose néon #FF2E97 = marque uniquement (logo, filet), jamais
  une erreur. États HACCP : vert = conforme, ambre/jaune = à faire, rouge = alerte (#FF5F57 / #BF2323, distinct du rose),
  toujours accompagnés d'une icône.
- **Contrastes (WCAG)** — sombre : texte 17,0:1, secondaire 9,2:1, tertiaire 6,3:1, cyan/bleu nuit 12,5:1, badges
  ok 7,8 / attente 8,9 / erreur 5,1:1, bouton danger 4,8:1. Clair : texte 17,6:1, secondaire 7,2:1, tertiaire 5,3:1
  (≥ 4,97 sur `--sunken`), bouton principal blanc/#0A6C75 6,2:1, badges ok 5,3 / attente 4,8 / erreur 4,8:1, danger 5,6:1.
- **Marque** : `ui/brand.tsx` — `BrandLogo` (SVG, « DINER » en Bowlby One auto-hébergée via `@fontsource/bowlby-one`,
  lueur rose subtile en sombre seulement) et `BrandStripe` (3 tubes : rose, cyan, chrome). En-tête, verrouillage,
  première configuration. Police de l'interface : police système (SF Pro sur iOS), chiffres tabulaires pour heures/températures.
- **Icônes** : Lucide (`lucide-react`) via `ui/icons.tsx` uniquement (épaisseur 1,75). Aucun emoji ni pictogramme Unicode.
- **Icônes PWA** : `cd app && node scripts/generate-icons.mjs` (rend `BrandLogo` sur fond bleu nuit avec Playwright).
