# Backend — logique serveur (Edge Functions)

Lots 1 à 3. Supabase offre gratuite (UE), Edge Functions Deno. Contrat : `shared/types.ts` et `shared/payloads.ts` (payloads des lots 2 et 3).

## Organisation

```
shared/validation.ts            Validation pure (app + serveur) : forme d'un enregistrement, payloads par type
supabase/functions/
  _shared/*.ts                  Logique PURE (aucun import Deno/npm), testée par Vitest
    http.ts                     CORS, JSON, lecture du corps bornée, erreurs, journal JSON
    auth.ts / crypto.ts         Jeton appareil (SHA-256), Bearer JWT, aléa
    repo.ts                     Interfaces Repo injectées + traduction des erreurs `HACCP: …`
    sync_push.ts sync_pull.ts device_enroll.ts health.ts bootstrap.ts photo_upload.ts purge_photos.ts
    memory_repo.ts test_helpers.ts *.test.ts   (tests uniquement)
  _adapters/supabase_repo.ts    Implémentation Repo avec supabase-js (service_role) — Deno
  _adapters/supabase_storage.ts Bucket `photos` (API Storage) + RPC de purge des photos — Deno
  <fonction>/index.ts           Point d'entrée : câblage seulement (Deno.serve)
  tsconfig.json                 Vérif. de type de _shared hors Deno
```

## Fonctions

| Fonction | Auth | Rôle |
|---|---|---|
| `sync-push` (POST) | `x-device-token` | Reçoit `SyncPushRequest`, vérifie et ajoute au registre, répond `SyncPushResponse` |
| `sync-pull` (GET `?since=`) | `x-device-token` | Références modifiées depuis `since` (tout si vide) → `SyncPullResponse` |
| `device-enroll` (POST `{name}`) | JWT gérant | Crée un appareil, renvoie une seule fois son jeton → `DeviceEnrollResponse` |
| `health` (GET/HEAD) | aucune | `{ok:true,time}` après un `select` minimal en base ; 503 `db_unavailable` sinon |
| `bootstrap-status` (GET) | aucune | `{needs_bootstrap, establishment_name}` : `needs_bootstrap` = aucune ligne dans `managers` |
| `bootstrap-manager` (POST) | aucune (une seule fois) | Inscription du gérant → 201 `{ok:true, staff_id}` |
| `photo-upload` (PUT `?path=`) | `x-device-token` | Envoi d'une photo WebP dans le bucket privé `photos` |
| `purge-photos` (POST) | `x-purge-secret` | Supprime les photos expirées non référencées (planifiée, quotidienne) |

### sync-push — contrôles, dans l'ordre, pour chaque enregistrement
1. **Structure** stockable (`validateRecordStructure`) : uuid v4 minuscule, `device_time` = `toISOString()` exact (sinon le hash ne survit pas au timestamptz), hash/prev_hash hex 64, seq entier ≥ 1, payload JSON stockable en jsonb (pas de `\u0000`, ≤ 16 ko, profondeur ≤ 6) ; `device_id` = appareil du jeton.
2. **Hash** recalculé (`computeRecordHash`) → `invalid_hash`.
3. **Idempotence** : id connu + même hash → même réponse qu'au premier envoi ; hash différent → `id_conflict`.
4. **Chaîne** : `device_seq = tête+1` (`seq_gap`), `prev_hash = hash de tête` (`broken_chain`) ; tête = `device_chain_head()` (ancre de purge comprise), `GENESIS_HASH` au premier.
5. **Contenu** : type du contrat et défini (`unknown_type`), auteur existant **et actif** (`unknown_author`), correction : cible existante (`supersedes_not_found`) et remplacement valide pour le type d'origine (remonte les corrections successives), payload (`invalid_payload`), équipement référencé existant (`temperature_check`, `thawing`, `hot_holding` s'il est déclaré ; aussi dans le remplacement d'une correction), fournisseur existant (`reception.supplier_id`, même désactivé), chaque photo (`photo_paths`, `items[].photo_paths`) dans le dossier `<device_id>/` de l'appareil — une correction peut aussi reprendre les photos de l'enregistrement qu'elle corrige (chaîne de corrections comprise). La présence du fichier dans Storage n'est **pas** exigée (photo envoyée plus tard, hors réseau). Tout échec → quarantaine `invalid_payload`.
6. **Insertion** ; `server_time` est imposé par le trigger, `clock_suspect` calculé par le trigger ; les deux sont **relus**.

**Payloads du lot 2** (`shared/validation.ts`, selon `shared/payloads.ts`) : champs inconnus refusés ; `product` 1–80 caractères non blanc ; `value_c` −50..300, 1 décimale ; `step` `start|check|end` (`thawing` : `start|end`) ; `cooling`/`reheating` à `end` : `in_range` et `duration_min` (entier 0–1440) obligatoires (facultatifs avant) ; `thawing` à `end` : `dlc` date réelle `AAAA-MM-JJ` ; uuid en minuscules.
**Payloads du lot 3** : `reception` (`supplier_id`, `delivery_note` 1–40, `vehicle_ok`, `packaging_ok`, `items` 1–50, `photo_paths` 0–5, `comment` 0–500) ; ligne : `product` 1–80, `lot` 1–40, `dlc`/`ddm` dates réelles, `gtin` 8–14 chiffres (texte), `temperature_c` −50..300 à 1 décimale, `storage` `fridge|freezer|ambient`, `accepted`, `refusal_reason` 1–200 **obligatoire si `accepted` faux**, `photo_paths`. `waste` : `product`, `lot` 1–40, `quantity` 1–40, `reason` (liste fermée), `comment` 0–500 **obligatoire et non blanc si `reason = 'other'`**, `related_record_id`, `photo_paths`. Chemins de photo : `PHOTO_PATH_RE`, 5 au plus par tableau. Champs inconnus refusés partout ; une `correction` valide son `replacement` selon ces règles.
**Choix : aucun contrôle `in_range` / seuils côté serveur.** `in_range` est calculé par l'app avec le seuil en vigueur au moment de la saisie, souvent hors réseau ; le gérant a pu changer le seuil entre-temps, le serveur ne peut donc pas rejuger sans faux refus. Les seuils restent consultables pour un contrôle a posteriori.

**Horloge suspecte.** L'app envoie `device_now` (ISO canonique, sinon 400 `invalid_request` ; `null` = absent). Le lot est jugé **une fois** : |heure de la fonction − `device_now`| > `settings.clock_suspect_minutes`. Chaque ligne insérée porte `device_now` (le trigger calcule sur lui, plus sur `device_time`) et, si le lot est suspect, `clock_suspect: true` : tout le lot est signalé (événement `clock_suspect_batch` avec l'écart). Une saisie hors réseau envoyée des heures plus tard avec une horloge juste n'est donc plus signalée. Sans `device_now` (ancienne app) : ancienne règle par enregistrement sur `device_time`. Le trigger reste l'autorité (OU logique, `device_now` accepté de `service_role` seulement) ; un écart à la limite du seuil peut, au pire, signaler quelques lignes de plus, jamais en masquer.

**Deux familles de refus**
- *Intégrité* (1 à 4, `device_revoked`) : rien n'est stocké, la chaîne n'avance pas, les suivants du lot sont refusés en `broken_chain` (« bloqué par … »).
- *Contenu* (5) sur chaîne intègre : **quarantaine**. L'enregistrement est inséré avec `quarantine_reason`, la chaîne avance (`last_device_seq` l'inclut) et il figure dans `rejected` : raison = celle de la quarantaine, sauf `supersedes_not_found` renvoyé en `invalid_payload` (absent du contrat). `detail` commence par `quarantaine[<raison>] (enregistré, chaîne avancée)`. L'app ne doit pas le renvoyer (un renvoi donne la même réponse) ; le gérant traitera la quarantaine.

**Filet de sécurité de la base** (exceptions `HACCP: …`), jamais en 500 :
`seq_gap` / `broken_chain` / `device_revoked` → refus d'intégrité (tête relue) ; `unknown_author` / `supersedes_not_found` (auteur ou cible disparus entre contrôle et insertion) → nouvelle insertion en quarantaine ; violation d'unicité 23505 (envois concurrents) → relecture puis réponse de rejeu, `id_conflict` ou `broken_chain` ; autre refus 22xxx/23xxx → `invalid_payload` « refusé par la base de données ».

Limites : 500 enregistrements (413 `too_many_records`), 1 Mo (413 `payload_too_large`, vérifié aussi sur flux sans Content-Length). Met à jour `devices.last_seen_at`.

### sync-pull
`server_now` est pris **avant** les lectures ; on relit avec un recouvrement de 5 min sous `since` (transactions validées en retard) — doublons sans effet (remplacement par id). Staff : actifs seulement, avec `pin_salt`/`pin_hash`. `deleted` : staff/équipements passés `active=false` depuis `since` (vide si `since` vide). `establishment` et `settings` (dont `daily_check_times`) toujours renvoyés (503 `not_configured` si absents). 400 si `since` n'est pas une date.

`suppliers` (lot 3) : fournisseurs **actifs** (`id, name, phone, email, active, updated_at`) ; désactivés depuis `since` dans `deleted` avec `table: 'suppliers'`.

### photo-upload
`PUT /functions/v1/photo-upload?path=<device_id>/<uuid>.webp`, en-tête `x-device-token`, corps = octets WebP.
- Chemin : `PHOTO_PATH_RE`, uuid en minuscules (400 `invalid_path`) ; dossier = appareil du jeton (403 `device_mismatch`).
- Corps ≤ `PHOTO_MAX_BYTES` (413 `payload_too_large`, aussi en flux), non vide (400 `invalid_photo`), signature `RIFF…WEBP` + bloc `VP8 `/`VP8L`/`VP8X` et taille RIFF = longueur reçue (fichier tronqué refusé) → sinon 415 `invalid_photo`. L'image n'est pas décodée.
- **Idempotent, jamais d'écrasement** : objet absent → upload `upsert: false` (`image/webp`) → **201** `{ok:true, path, status:'created', size}` ; objet présent de même taille → **200** `{…, status:'already_present'}` sans réécrire ; taille différente → **409 `photo_conflict`**. Course entre deux envois : l'upload refusé « déjà présent » est rejugé sur l'objet stocké.
- Limite : « même taille » vaut « même contenu » (Storage n'expose pas d'empreinte fiable) ; un uuid par photo rend une collision pratiquement impossible.

### purge-photos
`POST`, en-tête `x-purge-secret` = secret `PURGE_PHOTOS_SECRET` (≥ 32 caractères ; absent → 503 `not_configured` ; mauvais → 401). Boucle : `photos_to_purge(100)` → suppression par l'API Storage → … (20 lots au plus, s'arrête au premier échec partiel), puis `record_photo_purge(deleted, failed)`. Réponse `{ok, deleted, failed, more}`. Règle de sélection et justification : `backend-db.md` § 10.
Planification (une fois par jour), au choix :
- GitHub Actions : `curl -fsS -X POST -H "x-purge-secret: $PURGE_PHOTOS_SECRET" https://<ref>.supabase.co/functions/v1/purge-photos` (secret du dépôt) ;
- `pg_cron` + `pg_net` avec le secret dans Vault : `select cron.schedule('haccp-purge-photos', '47 3 * * *', $$select net.http_post(url := 'https://<ref>.supabase.co/functions/v1/purge-photos', headers := jsonb_build_object('x-purge-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'purge_photos_secret')))$$);`

### device-enroll
JWT → `auth.getUser()`, utilisateur présent dans `managers` (sinon 401/403). `name` : 1–60 caractères, espaces normalisés. Jeton = 32 octets aléatoires en base64url (43 car.) ; **seul son SHA-256** est stocké, le jeton n'est jamais journalisé. Réponse 201.

### bootstrap-manager
Corps : `{ email, password, display_name, pin_salt, pin_hash, establishment_name }` (8 ko max). L'inscription libre Supabase reste désactivée.
1. Un gérant existe déjà → **409 `already_bootstrapped`** (rien n'est créé).
2. Plus de 10 échecs sur 15 min → **429 `too_many_attempts`**.
3. Validation → 400 `invalid_request` (`detail` nomme le champ, jamais la valeur) : e-mail plausible (≤ 254, normalisé en minuscules), mot de passe 12 caractères à 72 octets (limite bcrypt d'Auth, jamais modifié), `display_name` 1–60 et `establishment_name` 1–80 (espaces normalisés, sans caractère de contrôle), `pin_salt` / `pin_hash` aux formats des contraintes `staff` (base64 de 16 / 32 octets).
4. `auth.admin.createUser({ email, password, email_confirm: true })`. Refus d'Auth : 422 `email_exists`, 422 `weak_password`, sinon 400 `invalid_request`.
5. `rpc('bootstrap_manager')` (transaction sous verrou, voir `backend-db.md`). `already_bootstrapped` (inscription concurrente) → 409 ; toute autre erreur → 500 générique. Dans les deux cas l'utilisateur Auth créé est **supprimé** (`auth.admin.deleteUser`) ; si cette suppression échoue, l'événement `bootstrap_orphan_user` (avec `user_id`) est journalisé pour nettoyage manuel.

**Anti-abus (choix)** : table `bootstrap_attempts` dédiée plutôt que `audit_log` (append-only, réservé aux références). On compte les échecs (400/413, refus d'Auth, 409 concurrent), pas les 409 du pré-contrôle ni les 500. Compteur **global**, pas par IP : il n'y a qu'une inscription dans la vie du projet et l'IP reçue n'est pas fiable. Un tiers peut donc retarder l'inscription de 15 min au plus, mais jamais s'inscrire à la place du gérant une fois celui-ci inscrit. Les limites propres à Supabase Auth s'ajoutent.

Journal : `user_id`, `staff_id`, raison d'échec ; jamais l'e-mail, le mot de passe ni le PIN. Les erreurs Auth ne journalisent que leur code et statut.

## Sécurité
- Clé `service_role` uniquement côté fonctions (variable `SUPABASE_SERVICE_ROLE_KEY`, injectée par Supabase) ; jamais dans l'app.
- Jeton appareil inconnu/absent → 401 `unauthorized` (sans distinguer) ; révoqué → 401 `device_revoked`.
- Erreurs : `HttpError` → `{error, detail?}` ; toute autre exception → 500 `{error:'internal_error', request_id}` sans message interne (le détail ne va que dans le journal).
- CORS : `ALLOWED_ORIGIN` = origine(s) de l'app séparées par des virgules (ex. `https://haccp.pages.dev`). Non défini → aucune origine autorisée (avertissement au démarrage). `*` possible en dev uniquement.
- Journal : une ligne JSON par événement (`fn`, `request_id`, `device_id`, compteurs, raisons) ; ni jeton, ni PIN, ni payload.
- En-têtes : `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Request-Id`.

## Déploiement
`supabase/config.toml` (géré par le collègue base de données) doit contenir :
```toml
[functions.sync-push]
verify_jwt = false   # auth par jeton appareil
[functions.sync-pull]
verify_jwt = false
[functions.health]
verify_jwt = false
[functions.device-enroll]
verify_jwt = true
[functions.bootstrap-status]
verify_jwt = false   # aucun gérant => pas encore de JWT
[functions.bootstrap-manager]
verify_jwt = false
[functions.photo-upload]
verify_jwt = false   # auth par jeton appareil
[functions.purge-photos]
verify_jwt = false   # auth par x-purge-secret
```
```bash
supabase secrets set ALLOWED_ORIGIN=https://<app>.pages.dev PURGE_PHOTOS_SECRET=<32+ caractères aléatoires>
supabase functions deploy sync-push sync-pull device-enroll health bootstrap-status bootstrap-manager photo-upload purge-photos
```
Les fonctions importent `../../../shared/*.ts` (hors `supabase/functions`) : vérifier au premier déploiement que le bundler l'accepte ; sinon, copier `shared/` dans `_shared/contract/` en CI avant le déploiement.

**Keep-alive (projet gratuit mis en pause après inactivité)** : appeler `health` une fois par jour, par exemple via une tâche GitHub Actions planifiée (`schedule: cron: '17 6 * * *'`, `curl -fsS https://<ref>.supabase.co/functions/v1/health`) ou via `pg_cron` + `pg_net` côté base. `health` fait une vraie requête en base, donc compte comme activité ; un 503 signale un incident.

## Tester
```bash
npm install                    # à la racine
cd app && npx vitest run       # inclut shared/ et supabase/functions/
npx tsc -b --noEmit            # app + shared
npx tsc -p ../supabase/functions   # logique pure des fonctions
deno check supabase/functions/*/index.ts   # entrées Deno (si deno installé)
```
Local avec la CLI : `supabase start && supabase functions serve --no-verify-jwt` puis
`curl -H "x-device-token: <jeton>" http://localhost:54321/functions/v1/sync-pull`.
Les tests utilisent `MemoryRepo`, qui reproduit le trigger d'insertion (messages `HACCP: …`, ancres de purge, `server_time`/`clock_suspect` imposés).
