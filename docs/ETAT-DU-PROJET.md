# État du projet — HACCP Space Diner (au 18/11/2026)

> **À lire en premier par toute nouvelle session.** Ce fichier remplace l'historique de la conversation d'origine.
> Propriétaire : Cédric (food truck « Space Diner », remorque, services jeudi–samedi 18 h 30–21 h, prépa 16 h–18 h 30).
> Il travaille seul (aide ponctuelle de son épouse). Il va lui-même chercher sa marchandise (Metro). Langue : **français**, utilisateur non développeur : expliquer simplement.

## 0 quater. 18/11/2026 (~04 h UTC) : « Marquer comme saisie de test » (demandé par Cédric)
- Registre append-only conservé : une **correction** `{ reason, replacement: valeur en vigueur, test: true }` marque la saisie. `shared/testMarks.ts` (`testMarkedRoots`, `withoutTestMarked`, `chainHead`) ; `buildEntries` et `buildReadings` écartent la saisie, sa chaîne et ses actions correctives ; le dossier de contrôle les compte avec les essais (`report.tests`, `report.testEntries`, note dans le PDF).
- Bouton « Marquer comme saisie de test » sur chaque ligne du mode Contrôle (sauf lots chronométrés refroidissement / remise en T° / décongélation), avec motif.
- Contrat : champ optionnel `test` (booléen) de la correction (`shared/validation.ts`) → **redéployer les fonctions Supabase AVANT de mettre l'app en ligne** (sinon le serveur refuse ces corrections : quarantaine).
- Saisies test de Cédric : les 3 de l'« Ordinateur » du 15/11 vers 17 h 41 (checklist nuisibles, contrôle d'huile 12 %, test d'enregistrement — ce dernier est déjà exclu d'office).
- Appareils : 2 « iPhone » (appli d'écran d'accueil et Safari = deux appareils) + « Ordinateur ». Pas d'écran pour retirer un appareil.

## 0 ter. 18/11/2026 (~03 h 40 UTC) : relecture du PMS avec Cédric (fil « Corriger les durées et produits du PMS »)
- Serveur vérifié : tous les produits actifs servent dans une recette ; les exemples du seed (Sauce burger, Steak haché surgelé, Salade iceberg, Sauce cheddar maison) sont désactivés depuis le 17/11. Aucun PMS enregistré sur le serveur : le PDF vu par Cédric (avec Sauce burger / steak haché) venait du serveur simulé ou d'un aperçu, pas de la vraie app.
- Branche `claude/project-thread-d6aa7n` : suggestions par défaut des écrans Cuisson, Maintien, Refroidissement, Remise en température et Décongélation remplacées par ses produits (plus de chili, bolognaise, steak, saucisse…). **Pas mise en ligne** (accord requis).
- Pain brioché : **4 jours après achat, 24 h après décongélation** — écrit sur le serveur le 18/11 03:45 UTC (accord de Cédric) et dans `space_diner_v43.sql`. Le PMS (`pms/model.ts`) ajoute une procédure pain (congélation du reste, décongélation à l'ambiante) si un produit « Pain… » existe — sur la branche, pas en ligne.
- Sauces validées par Cédric (18/11 03:47 UTC) et écrites sur le serveur : Sauce UFO 5 → **3 jours** ; Ranch, sauce piquante fumée, pommes cannelle 3 jours ; miel piquant 1 mois ; chutney au bacon **mélangé au dernier moment, reste jeté en fin de service (3 h)**.
- Crème pâtissière à l'amande (poudre Ancel + eau) : **48 h** au frigo (conseil du sachet), écrit sur le serveur le 18/11 03:50 UTC. Checklist Fermeture mise à jour (serveur + v43) : « jetée si plus de 48 h », mélange chutney-bacon jeté chaque soir, samedi = sauces froides seules.
- En attente de Cédric : accord pour la mise en ligne de la PR n°5.

## 0 bis. Suite du 18/11/2026 (~03 h UTC) : clé publishable + fonctions
- Fonctions Supabase **redéployées** (`deploy-supabase.sh … functions`, environnement « haccp-foodtruck » avec accès à api.supabase.com). Migrations : toutes déjà appliquées (16), rien relancé côté base, données réelles intactes.
- `LABEL_TRACES_IN_REGISTRY = true` (traces imprimées enregistrées dans le registre).
- Clé `sb_publishable_…` lue via l'API de gestion et posée dans `app/.env.production` (`VITE_SUPABASE_PUBLISHABLE_KEY`, l'ancienne clé anon reste en secours). Vérifié : `health` et `bootstrap-status` répondent avec la nouvelle clé seule.
- Mis en ligne (PR n°3, accord de Cédric, 03:04 UTC).
- Puis (PR n°4) : à l'achat et en « produit jeté », le champ Produit propose les **produits de Gestion** (recherche dès les premières lettres, sans accents ; bouton « Choisir dans mes produits (N) » = liste complète). Choisir un produit reprend sa conservation. `ProductField` accepte `catalog`, `matchCatalog()` dans `processes/common.tsx`, `ReceptionData.catalog`. Demandé par Cédric (« je suis obligé de taper à la main »).

## 0. Session précédente (18/11/2026 nuit) : lot 3 bis « Achats » + corrections techniques
Branche `claude/project-thread-s0d29q` (poussée, **pas fusionnée** : la fusion met en ligne, accord de Cédric requis). Le lot 7 était déjà fusionné dans `main`.
- **Lecture de l'étiquette** (`app/src/features/reception/scan/`) : à chaque photo d'étiquette, code-barres (ZXing) + texte (Tesseract, français, `parseLabel.ts`) lus **sur l'appareil** ; lot, DLC/DDM, code-barres pré-remplis dans les champs vides, bandeau « à vérifier ». Fichiers OCR copiés au build sous `/ocr/` (plugin `ocrAssets` de `vite.config.ts`, ≈ 4 Mo moteur + 0,7 Mo langue), cache `haccp-ocr` à la 1re utilisation, préchargés en arrière-plan à l'ouverture de la saisie. Testé dans Chromium : étiquette générée lue en ≈ 1 s.
- **Scan du code-barres** (`BarcodeScanner.tsx`) : caméra en direct, repli photo. EAN/UPC → GTIN ; GS1-128 / DataMatrix / QR Digital Link → GTIN + lot (AI 10) + DLC (AI 17) ou DDM (AI 15). Un GTIN déjà reçu redonne le nom et la conservation (`productsByGtin`).
- **Rappel produit** (`app/src/features/recall/`) : onglet de « Documents & contrôle » + carte « Rappel produit » dans Achats (gérant). Recherche par lot ou code-barres sur 2 ans (registre du serveur si connecté, sinon l'appareil), logique = `trace_lot()` refaite en JS (+ GTIN, + étiquettes faites à partir d'étiquettes). « Noter le retrait » = `waste` motif `recall` lié à l'achat / l'étiquette. Fiche de rappel PDF. `listRegistry` accepte un filtre `types`. La RPC `trace_lot` n'est pas utilisée par l'app.
- **Corrections** : quarantaine du `system_test` expliquée (champ `ua` en trop, refusé par le validateur strict) → l'app met le navigateur dans `note`, le validateur accepte aussi `ua` ; `label_printed.may_contain` (traces imprimées) ajouté au contrat ; remise en température : objectif = max(seuil générique, `cook_min_c` du produit) (`ruleForBatch`) ; clé « publishable » prise en charge (`VITE_SUPABASE_PUBLISHABLE_KEY`, sans `Authorization: Bearer` car ce n'est pas un JWT).
- **Mis en ligne le 18/11/2026** (fusion de la PR n°2, accord de Cédric) **sans redéployer les fonctions Supabase** (pas d'accès à api.supabase.com depuis la session). Donc l'enregistrement des traces sur les étiquettes est **désactivé** (`LABEL_TRACES_IN_REGISTRY = false` dans `LabelEditor.tsx`). À faire dans une session qui a accès à Supabase : `bash scripts/deploy-supabase.sh tnikuszcrmsmlictktsj all`, PUIS passer cette constante à true et mettre en ligne. Aucun changement SQL.
- **Clé publishable** : à récupérer dans Supabase › Project Settings › API Keys (l'environnement de cette session n'avait pas accès à api.supabase.com), la mettre dans `app/.env.production` puis vérifier sync, photos, enrôlement et connexion gérant.
- Tests : 783 (vitest), `tsc` OK, `deno check` des fonctions OK. SQL non relancé (aucun changement SQL).

## 1. Infrastructure (tout gratuit)
| Élément | Où | Détail |
|---|---|---|
| Code | GitHub `Randwic/haccp-foodtruck` (privé), branche `main` | Monorepo : `app/` (PWA), `supabase/` (base + Edge Functions), `shared/` (contrat), `docs/`, `scripts/` |
| Application | Cloudflare Workers (static assets), `https://haccp-foodtruck.w6g28nh2fy.workers.dev` | Déployée automatiquement à chaque push sur `main` (`wrangler.jsonc`, build `npm run build`, sortie `app/dist`) |
| Serveur | Supabase projet `tnikuszcrmsmlictktsj` (eu-west-1, offre gratuite) | Déploiement : `bash scripts/deploy-supabase.sh tnikuszcrmsmlictktsj all` (API de gestion ; jeton `sbp_` injecté par le proxy de l'environnement Claude « haccp-foodtruck » sur `api.supabase.com`) |
| Sauvegardes | GitHub `Randwic/haccp-sauvegardes` (privé) | Robot GitHub Actions chaque dimanche ~03:41 UTC : `base/base.sql`, `base/auth.sql`, `csv/`, `photos/`. Secrets du dépôt : `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY` (clé `sb_secret_…`). Testé OK le 14/11 |

Tâches pg_cron sur le serveur : purge registre 03:17, purge mesures capteurs 03:27, purge photos 03:47 (`purge-photos`, secret Vault `purge_photos_secret`), moteur d'alertes toutes les 5 min (`alerts-evaluate`, secret Vault `alerts_evaluate_secret`), keep-alive 06:17.
Secrets de fonctions posés : `ALLOWED_ORIGIN` (URL de l'app), `PURGE_PHOTOS_SECRET`, `ALERTS_EVALUATE_SECRET`, `VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT`. **Pas encore** : `RESEND_API_KEY`, `ALERT_EMAIL_TO` (email d'alerte désactivé).

## 2. Architecture (voir `docs/ARCHITECTURE.md`, `docs/backend-db.md`, `docs/backend-logic.md`, `docs/core-offline.md`, `docs/ui.md`)
- **Contrat** : `shared/types.ts`, `shared/payloads.ts` (formes des saisies par lot), `shared/canonical.ts` (hash), `shared/validation.ts` (validateurs serveur, réutilisés par l'app).
- **Registre infalsifiable** : table `records` en insertion seule (triggers, même pour le propriétaire), chaîne de hash par appareil, corrections = nouvel enregistrement `correction` (original barré). Refus de contenu → **quarantaine** (stocké, chaîne avancée).
- **App** : React 19 + TS + Vite + Tailwind v4, hors-ligne d'abord (Dexie), synchro `sync-push`/`sync-pull`, PIN PBKDF2, design « Space Diner » (thème auto clair/sombre, charte dans `docs/marque/`), icônes Lucide (aucun emoji).
- **Modes** : URL nue = réel ; `?essai` = parcours complet sur serveur simulé (rien envoyé) ; `?demo=unlocked&…` = vitrine (paramètres : `releves`, `procedes`, `receptions`, `etiquettes`, `nettoyage`, `huiles`, `pertes`, `sync`).
- Tests : `cd app && npx vitest run` (783 au 18/11), `npx tsc -b --noEmit`, `bash supabase/tests/run.sh` (835 assertions), `npx -y deno@latest check supabase/functions/*/index.ts`.

## 3. Ce qui est fait et en ligne
| Lot | Contenu | État |
|---|---|---|
| 1 | Socle, compte gérant (inscription unique `bootstrap-manager`), enrôlement auto, PIN, Gestion, design | ✅ |
| 2 | Températures (créneaux, action corrective obligatoire, correction), procédés (refroidissement, remise en T°, cuisson par produit, maintien chaud, décongélation) | ✅ |
| 3 / 3 bis | Achats & réception (photos WebP, fournisseurs), produits jetés ; lecture d'étiquette (OCR), scan code-barres (GS1), rappel produit | 3 ✅ ; 3 bis ✅ sur la branche, **en attente de mise en ligne** |
| 4 / 4 bis | Produits, recettes (préparations + plats du menu, sous-recettes), allergènes ● présents / ○ traces, étiquettes DLC 62 mm (AirPrint), DLC fabricant saisie à la main, tableau allergènes A4 fidèle au PDF de Cédric | ✅ |
| 5 | Nettoyage, checklists, huiles (polaires 25 % / alerte 22 %) | ✅ |
| 6 | Serveur capteurs (`sensor-ingest`, Shelly), moteur d'alertes, Web Push (VAPID), email Resend (inactif) | Serveur ✅ — **écrans à faire** |
| 7 | Serveur documents (bucket `documents`, `documents_expiring`), `verify-integrity`, vue `staff_public` ; écrans Documents (rappels 30 j), assistant PMS (réponses rangées dans les métadonnées du PDF `HaccpPmsAnswers`, version suivante repart du dernier PDF), mode Contrôle (période, intégrité, dossier PDF + CSV) | ✅ sur la branche, **en attente de fusion** |
| 8 | RGPD, durcissement, guide d'installation | À faire |

**Données réelles installées le 17/11** (`supabase/data/space_diner_v43.sql`, idempotent) : établissement « Space Diner », relevés 16:30 et 21:00, 8 équipements (Frigo inox 350 L ≤ 3 °C, Desserte 226 L ≤ 4 °C, Congélateur 120 L ≤ −18 °C, Friteuse, Friteuse d'appoint (nuggets), Bain-marie ≥ 63 °C, Plancha, Machine à sceller), 52 produits (porc 63 °C, poulet/nuggets 74 °C), 8 préparations, 14 plats (allergènes calculés = tableau de Cédric, vérifié par test), 9 tâches de nettoyage du classeur PMS.
**Compte réel** : créé par Cédric (1 gérant, 2 appareils). Registre : 4 saisies d'essai du 15/11 (dont 1 `system_test` en quarantaine `invalid_payload` — **à investiguer** : probablement un payload de test refusé par le validateur).

## 4. À faire (dans l'ordre conseillé)
1. **Lot 3 bis** : mise en ligne après accord de Cédric (fonctions d'abord, puis fusion ; voir §0). Faire relire le PMS généré (lot 7, textes types) avec son classeur.
2. **Écrans lot 6** (remis à plus tard par Cédric le 18/11) : abonnement Web Push (`push-config`, `push-subscribe`, service worker — iOS : PWA installée seulement), liste et prise en compte des alertes (`alert_ack`), Gestion › Capteurs (`rpc('sensor_create')`, jeton affiché une fois, guide `docs/backend-shelly.md`).
3. Essayer la lecture d'étiquette sur de vraies étiquettes Metro (iPad) et ajuster `parseLabel.ts` si besoin.
4. **Lot 8** : RGPD (registre des traitements, export/effacement), durcissement, guide d'installation iPad.
5. Petits points : poser la clé `sb_publishable_…` dans `app/.env.production` (code prêt, voir §0) avant le retrait de la clé anon début 2027.

## 5. En attente de Cédric
- **Valider les allergènes supposés des produits achetés** (traces sur porc, poulet, ketchup, chutney, Worcestershire, sauce cheddar, Ancel…) et les durées supposées : pommes cannelle 72 h (étiquette inconnue), crème pâtissière 6 h (« jetée en fin de service »). Tout est modifiable dans Gestion.
- **Gluten ○ sur les frites** : tableau = friteuse commune ; PMS = friteuse d'appoint séparée pour les nuggets → à trancher.
- Fiches techniques fournisseurs (durées après ouverture), validation à la formation hygiène (décembre 2026).
- Matériel : Brother QL‑820NWB + rouleau **continu** 62 mm (amovible/dissolvable), capteurs : Shelly H&T Gen3 (frigos) ; congélateur : piste Shelly Plus Uni + sonde DS18B20 alimentée (à vérifier avant achat).
- Compte Resend (facultatif) pour l'email d'alerte.

## 6. Méthode de travail (pour économiser l'usage)
- Un seul sous-agent à la fois, avec `isolation: worktree`, `model: opus` ; il commite souvent ; le chef de projet intègre (tests complets), pousse `main`, déploie (`scripts/deploy-supabase.sh`).
- Le propriétaire veut un **travail complet et soigné**, pas de demi-mesure ; captures limitées à l'iPad clair sauf besoin de design.
- Commits en français, terminés par la ligne `Co-Authored-By` et `Claude-Session` fournies par l'environnement.
