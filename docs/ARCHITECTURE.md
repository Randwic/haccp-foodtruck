# Proposition d'architecture — HACCP Food Truck (étape 1, à valider)

> Rien n'est codé tant que ce document n'est pas validé.
> Contrainte n° 1 : **coût zéro** (aucun abonnement, aucun compte Apple, aucun Mac).

---

## 1. Vue d'ensemble

```
 iPhone / iPad (PWA installée)            Camion (Wi‑Fi maison)
 ┌───────────────────────────┐            ┌──────────────────────────┐
 │ App React (hors‑ligne)    │            │ Shelly H&T Gen3 (frigos) │
 │  • IndexedDB (Dexie)      │            │ Capteur + sonde (congél.)│
 │  • file d'envoi (outbox)  │            └────────────┬─────────────┘
 │  • PDF étiquettes→AirPrint│                         │ HTTPS (webhook / API)
 └────────────┬──────────────┘                         ▼
              │ HTTPS (sync)         ┌──────────────────────────────────┐
              └────────────────────► │ Supabase gratuit — région UE     │
                                     │  • PostgreSQL + RLS              │
   Notifications push web ◄──────────│  • Edge Functions (Deno)         │
   (iPhone, même hors du camion)     │  • pg_cron (alertes, purge)      │
                                     │  • Storage (photos, PDF)         │
                                     └──────────────────────────────────┘
 Hébergement de l'app : Cloudflare Pages (gratuit, dépôt privé accepté)
```

Note : GitHub Pages n'est **pas** gratuit pour un dépôt privé ; d'où Cloudflare Pages.

## 2. Choix techniques

| Besoin | Choix | Pourquoi |
|---|---|---|
| Application | React 19 + TypeScript strict + Vite | Standard, rapide, très bien outillé |
| Installation / hors‑ligne | `vite-plugin-pwa` (Workbox) | Service worker, mises à jour contrôlées |
| Base locale | IndexedDB via **Dexie** + `navigator.storage.persist()` | Fiable sur Safari, requêtes indexées |
| Interface | Tailwind CSS, composants maison gros boutons | Lisible avec des gants, mode sombre |
| État / données | Zustand + hooks Dexie (`useLiveQuery`) | Simple, réactif, sans serveur |
| Étiquettes & exports | **pdf-lib** (PDF au mm près : 62 × N mm) | Impression via le menu iOS → AirPrint |
| Scan code‑barres | **@zxing/browser** (caméra) | Safari n'a pas `BarcodeDetector` |
| Lecture lot / DLC | **Tesseract.js** (OCR dans le navigateur, gratuit) | Préremplit, l'utilisateur confirme |
| Photos | Compression WebP côté client (~200 Ko) | Rester dans le quota gratuit |
| Backend | Supabase (Postgres, Auth, Storage, Edge Functions, pg_cron) | Gratuit, UE, sécurité par RLS |
| Push | Web Push (VAPID) depuis une Edge Function | Gratuit ; iOS 16.4+ si app installée |
| Tests | Vitest (logique), Playwright (parcours), tests SQL (RLS/triggers) | Fiabilité vérifiée automatiquement |
| CI/CD | GitHub Actions → Cloudflare Pages + `supabase db push` | Déploiement à chaque validation |

## 3. Le cœur : un registre « append‑only »

Toutes les saisies HACCP (relevé, réception, nettoyage, huile, étiquette imprimée, action corrective…) sont des **événements** dans une seule table `records`. On n'y fait **que des ajouts**.

```
records
  id              uuid      (généré sur l'appareil → envoi idempotent)
  type            text      ('temperature_check', 'reception', 'cooling', 'oil_check', 'label_printed', 'cleaning_done', 'corrective_action', 'correction', …)
  payload         jsonb     (contenu validé par un schéma par type)
  author_id       uuid      (employé identifié par son PIN)
  device_id       uuid
  device_seq      bigint    (n° d'ordre sur l'appareil)
  device_time     timestamptz
  server_time     timestamptz  (posé par le serveur, jamais par le client)
  prev_hash       text      (hash de l'enregistrement précédent DU MÊME APPAREIL)
  hash            text      (SHA‑256 de l'enregistrement)
  supersedes_id   uuid null (pour une correction « annule et remplace »)
```

- **Pourquoi ce choix** : la synchro hors‑ligne devient simple et sûre (pas de conflit possible sur des ajouts) et l'infalsifiabilité est naturelle.
- **Chaîne de hachage par appareil** : deux appareils hors‑ligne ne peuvent pas partager une chaîne unique ; chaque appareil a la sienne, le serveur la vérifie à la réception et refuse tout trou ou hash invalide.
- **Interdiction technique de modifier** : RLS n'autorise que `INSERT` ; un trigger rejette tout `UPDATE`/`DELETE`, même pour l'administrateur applicatif. Seule la purge de fin de conservation (fonction dédiée, journalisée) peut supprimer.
- **Horloge** : écart `device_time` / `server_time` > 5 min → enregistrement signalé « horloge suspecte ».

**Données de référence** (modifiables par le gérant seulement, versionnées) : `staff`, `equipment` (frigos, congélateur, friteuses), `sensors`, `thresholds`, `suppliers`, `products` (durées de vie secondaires, allergènes), `recipes`, `cleaning_plan`, `task_templates`, `documents`, `settings`.

**Mesures capteurs** : table `sensor_readings` séparée (volumineuse, insertion seule), agrégée pour les graphiques.

## 4. Utilisateurs et sécurité

- **Gérant** : compte Supabase (email + mot de passe), accès complet, paramétrage, exports.
- **Tablette / iPhone de cuisine** : appareil « enrôlé » une fois par le gérant (jeton d'appareil), puis chaque équipier se déverrouille avec son **PIN à 4–6 chiffres**.
  - Les PIN sont stockés **hachés** (PBKDF2 via WebCrypto) et vérifiables hors‑ligne.
  - Verrouillage automatique après X minutes d'inactivité ; blocage temporaire après 5 PIN faux.
- RLS sur toutes les tables ; aucune clé secrète dans l'app (seule la clé publique « anon » est utilisée).
- RGPD : données minimales, aptitude médicale = « apte + date » seulement, export / effacement d'un ex‑salarié (ses enregistrements HACCP restent, pseudonymisés).

## 5. Synchronisation

1. Chaque saisie est écrite **d'abord** dans IndexedDB + une file d'envoi (outbox).
2. Dès qu'il y a du réseau : envoi par lots, idempotent (même `id` = ignoré), le serveur renvoie `server_time`.
3. Données de référence : téléchargement incrémental (`updated_at` > dernier passage).
4. Indicateur visible en permanence : « ✓ tout est synchronisé » / « 12 saisies en attente ».
5. Safari peut effacer les données d'un site non installé et peu utilisé : l'app **doit être installée** sur l'écran d'accueil et demander le stockage persistant ; elle avertit si des saisies attendent depuis plus de 24 h.

## 6. Capteurs et alertes

- **Shelly H&T Gen3** → webhook HTTPS vers l'Edge Function `sensor-ingest` (jeton secret propre à chaque capteur dans l'URL).
- **Capteur du congélateur** (NODE / Temp Stick, à choisir) → Edge Function `sensor-poll` appelée par pg_cron toutes les 5 min via l'API du fabricant.
- **Moteur d'alertes** (`alerts-evaluate`, pg_cron chaque minute) :
  - hors seuil depuis plus que la tolérance (ex. 20 min, réglable par enceinte) ;
  - **capteur muet** (aucune mesure depuis X min) ;
  - **pile faible** ;
  - tâches HACCP en retard, DLC dépassées.
- **Envoi** : notification push web sur l'iPhone et la tablette ; rappel toutes les 15 min tant que ce n'est pas acquitté ; l'acquittement + l'action corrective sont enregistrés dans `records`.
- **Garde‑fou quota gratuit** : les mesures capteurs maintiennent le projet actif ; en plus, une sauvegarde exportable (SQL + CSV + photos) est faite chaque nuit dans le dépôt privé `Randwic/haccp-sauvegardes`.

## 7. Impression des étiquettes

- L'app génère un **PDF à la taille exacte** du rouleau (62 mm de large, longueur réglable) : produit, date/heure, **DLC calculée**, opérateur, lot, allergènes en gras.
- Bouton « Imprimer » → menu de partage iOS → **AirPrint** vers la QL‑820NWB (même réseau Wi‑Fi : maison, partage de connexion ou Wi‑Fi Direct de l'imprimante — à tester).
- Chaque impression crée un enregistrement `label_printed` (traçabilité aval).

## 8. Organisation du dépôt

```
haccp-foodtruck/
├─ app/                  Application PWA (React + TS)
│  ├─ src/features/      temperatures, reception, labels, cleaning, oils, pms, staff…
│  ├─ src/core/          registre, hachage, sync, auth PIN, db locale
│  └─ tests/
├─ supabase/
│  ├─ migrations/        schéma SQL, RLS, triggers
│  ├─ functions/         sensor-ingest, sensor-poll, alerts-evaluate, push-send, export
│  └─ tests/             tests SQL (immutabilité, RLS)
├─ docs/                 PROMPT.md, ARCHITECTURE.md, guides d'installation
└─ .github/workflows/    CI : tests + déploiement
```

## 9. Découpage en lots

| Lot | Contenu | Livrable testable sur l'iPad |
|---|---|---|
| 1 | Socle : PWA installable, base locale, registre append‑only + hachage, PIN, synchro, Supabase, CI/déploiement | Installer l'app, se connecter par PIN, saisie test synchronisée |
| 2 | Températures manuelles, refroidissement, remise en T°, maintien chaud, cuisson + actions correctives + tableau de bord | Faire ses relevés du jour |
| 3 | Réception, photos, scan, OCR, traçabilité, retrait/rappel | Réceptionner une livraison |
| 4 | Produits, recettes, allergènes, étiquettes DLC PDF + AirPrint | Imprimer une vraie étiquette |
| 5 | Plan de nettoyage, checklists, huiles de friture | Checklist d'ouverture / fermeture |
| 6 | Capteurs, moteur d'alertes, push, capteur muet, pile faible | Recevoir une alerte sur l'iPhone |
| 7 | PMS assisté, documents, export « contrôle sanitaire » PDF/CSV | Dossier DDPP en 1 clic |
| 8 | RGPD, sauvegardes, durcissement, guide d'installation | Version 1.0 |

## 10. Ce que vous devrez faire (gratuit)

1. Créer un compte **Supabase** (gratuit) et un projet en région **UE** — je vous guiderai pas à pas au lot 1.
2. Créer un compte **Cloudflare** (gratuit) pour héberger l'app — idem, au lot 1.
3. Plus tard : installer l'app sur l'iPad/iPhone depuis Safari, et configurer les capteurs (guide fourni au lot 6).

## 11. Décisions validées

- **Enceintes** : 2 frigos, 1 congélateur, 1 friteuse double bac (contrôle d'huile suivi par bac).
- **Équipe** : 2 personnes avec un PIN.
- **Alertes par email** : oui, en plus des notifications push (service d'envoi gratuit à configurer).
- **Durée de conservation** : 3 ans.
- **Architecture** : en attente de validation.
