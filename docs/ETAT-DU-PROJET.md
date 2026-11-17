# État du projet — HACCP Space Diner (au 17/11/2026)

> **À lire en premier par toute nouvelle session.** Ce fichier remplace l'historique de la conversation d'origine.
> Propriétaire : Cédric (food truck « Space Diner », remorque, services jeudi–samedi 18 h 30–21 h, prépa 16 h–18 h 30).
> Il travaille seul (aide ponctuelle de son épouse). Il va lui-même chercher sa marchandise (Metro). Langue : **français**, utilisateur non développeur : expliquer simplement.

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
- Tests : `cd app && npx vitest run` (737 au 17/11), `npx tsc -b --noEmit`, `bash supabase/tests/run.sh` (835 assertions), `npx -y deno@latest check supabase/functions/*/index.ts`.

## 3. Ce qui est fait et en ligne
| Lot | Contenu | État |
|---|---|---|
| 1 | Socle, compte gérant (inscription unique `bootstrap-manager`), enrôlement auto, PIN, Gestion, design | ✅ |
| 2 | Températures (créneaux, action corrective obligatoire, correction), procédés (refroidissement, remise en T°, cuisson par produit, maintien chaud, décongélation) | ✅ |
| 3 | Achats & réception (photos WebP, fournisseurs), produits jetés (tuile dédiée) | ✅ (OCR / scan / rappel produit : à faire) |
| 4 / 4 bis | Produits, recettes (préparations + plats du menu, sous-recettes), allergènes ● présents / ○ traces, étiquettes DLC 62 mm (AirPrint), DLC fabricant saisie à la main, tableau allergènes A4 fidèle au PDF de Cédric | ✅ |
| 5 | Nettoyage, checklists, huiles (polaires 25 % / alerte 22 %) | ✅ |
| 6 | Serveur capteurs (`sensor-ingest`, Shelly), moteur d'alertes, Web Push (VAPID), email Resend (inactif) | Serveur ✅ — **écrans à faire** |
| 7 | Serveur documents (bucket `documents`, `documents_expiring`), `verify-integrity`, vue `staff_public` | Serveur ✅ — **écrans à faire** |
| 8 | RGPD, durcissement, guide d'installation | À faire |

**Données réelles installées le 17/11** (`supabase/data/space_diner_v43.sql`, idempotent) : établissement « Space Diner », relevés 16:30 et 21:00, 8 équipements (Frigo inox 350 L ≤ 3 °C, Desserte 226 L ≤ 4 °C, Congélateur 120 L ≤ −18 °C, Friteuse, Friteuse d'appoint (nuggets), Bain-marie ≥ 63 °C, Plancha, Machine à sceller), 52 produits (porc 63 °C, poulet/nuggets 74 °C), 8 préparations, 14 plats (allergènes calculés = tableau de Cédric, vérifié par test), 9 tâches de nettoyage du classeur PMS.
**Compte réel** : créé par Cédric (1 gérant, 2 appareils). Registre : 4 saisies d'essai du 15/11 (dont 1 `system_test` en quarantaine `invalid_payload` — **à investiguer** : probablement un payload de test refusé par le validateur).

## 4. À faire (dans l'ordre conseillé)
1. **Écrans lot 7** : Documents (dépôt PDF/photo dans le bucket `documents`, `upsert:false` avant insertion de la fiche, rappels d'échéance), **assistant PMS** (pré-rempli avec les données de l'app + le classeur de Cédric), **mode Contrôle** (synthèse période, registres + photos, `verify-integrity`, export PDF/CSV). Tuile « Documents & PMS » encore « Bientôt ».
2. **Écrans lot 6** : abonnement Web Push (`push-config`, `push-subscribe`, service worker — iOS : PWA installée seulement), liste et prise en compte des alertes (`alert_ack`), Gestion › Capteurs (`rpc('sensor_create')`, jeton affiché une fois, guide `docs/backend-shelly.md`).
3. **Lot 3 bis** : OCR lot/DLC (Tesseract.js), scan code-barres (@zxing/browser), recherche de lot / rappel produit (`rpc('trace_lot')`) — points d'extension dans `app/src/features/reception/extensions.ts`.
4. **Lot 8** : RGPD (registre des traitements, export/effacement), durcissement, guide d'installation iPad.
5. Petits points : investiguer la quarantaine du `system_test` ; traces non stockées dans `label_printed` (champ de contrat à ajouter) ; seuil `cook_min_c` non appliqué à la remise en température ; passer de la clé anon « legacy » (retrait Supabase début 2027) à la clé publishable `sb_publishable_…` dans `app/.env.production` (vérifier les en-têtes des appels aux fonctions).

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
