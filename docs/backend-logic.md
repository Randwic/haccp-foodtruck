# Backend — logique serveur (Edge Functions)

Lots 1 à 6. Supabase offre gratuite (UE), Edge Functions Deno. Contrat : `shared/types.ts` et `shared/payloads.ts` (payloads des lots 2 à 6). Configuration des capteurs : [`backend-shelly.md`](backend-shelly.md).

## Organisation

```
shared/validation.ts            Validation pure (app + serveur) : forme d'un enregistrement, payloads par type
supabase/functions/
  _shared/*.ts                  Logique PURE (aucun import Deno/npm), testée par Vitest
    http.ts                     CORS, JSON, lecture du corps bornée, erreurs, journal JSON
    auth.ts / crypto.ts         Jeton appareil (SHA-256), Bearer JWT, aléa
    repo.ts                     Interfaces Repo injectées + traduction des erreurs `HACCP: …`
    sync_push.ts sync_pull.ts device_enroll.ts health.ts bootstrap.ts photo_upload.ts purge_photos.ts
    sensor_ingest.ts            Lot 6 : webhooks des capteurs (formats Shelly / simples)
    alerts_engine.ts            Lot 6 : moteur d'alertes PUR (horloge injectée)
    alerts_evaluate.ts          Lot 6 : application des décisions + notifications
    webpush.ts                  Lot 6 : Web Push RFC 8291 (aes128gcm) + VAPID RFC 8292, WebCrypto seul
    email.ts                    Lot 6 : EmailSender (Resend, désactivé sans configuration)
    push_subscribe.ts           Lot 6 : push-subscribe et push-config
    schedule.ts                 Lot 6 : créneaux de relevé (copie de app/…/temperatures/schedule.ts, test de parité)
    memory_repo.ts test_helpers.ts *.test.ts   (tests uniquement)
  _adapters/supabase_repo.ts    Implémentation Repo avec supabase-js (service_role) — Deno
  _adapters/supabase_storage.ts Bucket `photos` (API Storage) + RPC de purge des photos — Deno
  _adapters/supabase_alerts.ts  Lot 6 : capteurs, alertes, abonnements push (supabase-js) — Deno
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
| `sensor-ingest` (GET/POST) | jeton du capteur (`?token=` ou `x-sensor-token`) | Mesure d'un capteur fixe (webhook Shelly…) |
| `alerts-evaluate` (POST) | `x-alerts-secret` | Ouvre / résout les alertes, envoie Web Push et e-mail (planifiée, toutes les 5 min) |
| `push-subscribe` (POST/DELETE) | `x-device-token` | Abonnement Web Push de l'appareil (`PushSubscribeRequest`) / désabonnement |
| `push-config` (GET) | aucune | `{ enabled, vapid_public_key }` pour `pushManager.subscribe()` |

### sync-push — contrôles, dans l'ordre, pour chaque enregistrement
1. **Structure** stockable (`validateRecordStructure`) : uuid v4 minuscule, `device_time` = `toISOString()` exact (sinon le hash ne survit pas au timestamptz), hash/prev_hash hex 64, seq entier ≥ 1, payload JSON stockable en jsonb (pas de `\u0000`, ≤ 16 ko, profondeur ≤ 6) ; `device_id` = appareil du jeton.
2. **Hash** recalculé (`computeRecordHash`) → `invalid_hash`.
3. **Idempotence** : id connu + même hash → même réponse qu'au premier envoi ; hash différent → `id_conflict`.
4. **Chaîne** : `device_seq = tête+1` (`seq_gap`), `prev_hash = hash de tête` (`broken_chain`) ; tête = `device_chain_head()` (ancre de purge comprise), `GENESIS_HASH` au premier.
5. **Contenu** : type du contrat et défini (`unknown_type`), auteur existant **et actif** (`unknown_author`), correction : cible existante (`supersedes_not_found`) et remplacement valide pour le type d'origine (remonte les corrections successives), payload (`invalid_payload`), équipement référencé existant (`temperature_check`, `thawing`, `hot_holding` s'il est déclaré ; aussi dans le remplacement d'une correction), fournisseur existant (`reception.supplier_id`, même désactivé), produit / recette existants (`label_printed.product_id` / `recipe_id`, même désactivés), chaque photo (`photo_paths`, `items[].photo_paths`) dans le dossier `<device_id>/` de l'appareil — une correction peut aussi reprendre les photos de l'enregistrement qu'elle corrige (chaîne de corrections comprise). La présence du fichier dans Storage n'est **pas** exigée (photo envoyée plus tard, hors réseau). Tout échec → quarantaine `invalid_payload`.
6. **Insertion** ; `server_time` est imposé par le trigger, `clock_suspect` calculé par le trigger ; les deux sont **relus**.

**Payloads du lot 2** (`shared/validation.ts`, selon `shared/payloads.ts`) : champs inconnus refusés ; `product` 1–80 caractères non blanc ; `value_c` −50..300, 1 décimale ; `step` `start|check|end` (`thawing` : `start|end`) ; `cooling`/`reheating` à `end` : `in_range` et `duration_min` (entier 0–1440) obligatoires (facultatifs avant) ; `thawing` à `end` : `dlc` date réelle `AAAA-MM-JJ` ; uuid en minuscules.
**Payloads du lot 3** : `reception` (`supplier_id`, `delivery_note` 1–40, `vehicle_ok`, `packaging_ok`, `items` 1–50, `photo_paths` 0–5, `comment` 0–500) ; ligne : `product` 1–80, `lot` 1–40, `dlc`/`ddm` dates réelles, `gtin` 8–14 chiffres (texte), `temperature_c` −50..300 à 1 décimale, `storage` `fridge|freezer|ambient`, `accepted`, `refusal_reason` 1–200 **obligatoire si `accepted` faux**, `photo_paths`. `waste` : `product`, `lot` 1–40, `quantity` 1–40, `reason` (liste fermée), `comment` 0–500 **obligatoire et non blanc si `reason = 'other'`**, `related_record_id`, `photo_paths`. Chemins de photo : `PHOTO_PATH_RE`, 5 au plus par tableau. Champs inconnus refusés partout ; une `correction` valide son `replacement` selon ces règles.
**Payload du lot 4** : `label_printed` (aussi en `replacement` de correction) — `kind` `opened|prepared|thawed` ; `product_id` obligatoire pour `opened`/`thawed` et `recipe_id` interdit, l'inverse pour `prepared` ; `name` 1–80 ; `made_at`, `dlc_at` ISO UTC canoniques, `dlc_at` strictement après `made_at` et au plus 90 jours après ; `allergens` ⊂ 14 codes sans doublon ; `storage` ; `lot` 1–40 ; `source_record_ids` 0–20 uuid ; `copies` entier 1–20.
**Payloads du lot 5** (aussi en `replacement` de correction) : `cleaning_done` — `task_id`, `comment` 0–300, `photo_paths` 0–3 (`PHOTO_PATH_RE`) ; `checklist_done` — `checklist_id`, `answers` 1–40 (`item_id` `[a-z0-9_-]{1,40}` unique, `ok`, `comment` 0–300 **obligatoire et non blanc si `ok` faux**), `all_ok` qui doit valoir « tous les `ok` vrais » (cohérence interne du payload) ; `oil_check` — `equipment_id`, `polar_percent` 0–50 à 1 décimale, `method` `tester|strip`, `in_range` (non rejugé contre `oil_polar_max`) ; `oil_change` — `equipment_id`, `comment` 0–300. Côté serveur : tâche / checklist existantes (même désactivées), équipement existant **et de type `fryer_vat`** pour les huiles, photos du nettoyage dans le dossier de l'appareil (même règle qu'au lot 3). Sinon quarantaine `invalid_payload`.
**Payload du lot 6** (aussi en `replacement` de correction) : `alert_ack` — `alert_id` uuid, `comment` 0–300, `corrective_action_id` uuid facultatif ; champs inconnus refusés. Côté serveur : l'alerte doit exister (résolue ou non), sinon quarantaine `invalid_payload`. `corrective_action_id` n'est pas vérifié (l'action corrective est un enregistrement du registre, éventuellement envoyé dans le même lot). La prise en compte (`alerts.acknowledged_at`) est posée **par la base** à l'insertion (trigger `records_alert_ack`, voir `backend-db.md`) ; un `alert_ack` en quarantaine ou une correction d'`alert_ack` n'ont pas d'effet.
**Choix : les `answers[].item_id` ne sont pas comparés aux points actuels de la checklist.** Elle a pu changer pendant une tournée hors réseau ; l'enregistrement atteste les réponses données.
**Choix : aucun contrôle que les allergènes imprimés correspondent au produit / à la recette.** La fiche a pu changer depuis l'impression (souvent hors réseau) ; l'enregistrement atteste ce qui a été imprimé. Un écart se repère a posteriori (fiche vs étiquette).
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
`products` / `recipes` (lot 4) : **actifs**, champs exacts de `Product` / `Recipe` ; désactivés depuis `since` dans `deleted` avec `table: 'products'` / `'recipes'`. Une recette active peut citer un produit désactivé (absent de `products`, déjà connu de l'app ou signalé dans `deleted`).
`cleaning_tasks` / `checklists` (lot 5) : **actifs**, champs exacts de `CleaningTask` / `Checklist` (points réduits à `id, label, required`) ; désactivés dans `deleted` avec `table: 'cleaning_tasks'` / `'checklists'`. Réglages `oil_polar_max` / `oil_polar_warn` dans `settings`.

**Lot 6** : `settings.sensor_silent_minutes` / `alert_repeat_minutes` (défauts `DEFAULT_ALERT_SETTINGS`). `sensors` : capteurs **actifs**, champs exacts de `Sensor` (jamais `token_hash`, colonnes explicites) ; désactivés depuis `since` dans `deleted` avec `table: 'sensors'`. Un capteur dont la télémétrie change (`last_seen_at`…) a un `updated_at` nouveau : il revient à chaque synchro où il a émis. `alerts` : **toutes les alertes ouvertes** (sans ou avec `since`) **+ celles modifiées depuis `since`** (résolues, prises en compte, notifiées), champs exacts de `Alert` (1000 au plus par requête).

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

### sensor-ingest (lot 6)
`GET|POST /functions/v1/sensor-ingest?token=<jeton>[&tC=4.2&batt=87]`. Configuration pas à pas : [`backend-shelly.md`](backend-shelly.md).
- **Jeton** : `?token=` (les webhooks Shelly n'envoient pas d'en-tête personnalisé) ou en-tête `x-sensor-token` (prioritaire). SHA-256 comparé à `sensors.token_hash` ; inconnu / absent / mal formé → 401 `unauthorized` (sans distinguer) ; capteur désactivé → 403 `sensor_inactive`. Le jeton n'est jamais journalisé par la fonction ; **attention**, comme toute URL, il peut figurer dans les journaux d'accès de la plateforme : il ne donne que le droit d'envoyer des mesures pour CE capteur et se renouvelle par `sensor_rotate_token()`.
- **Mesure** (paramètres d'URL prioritaires sur le corps, lecture tolérante) :
  - URL ou formulaire : `tC` / `temp` / `temperature` / `t` (ou `tF`, converti), `batt` / `battery` / `battery_percent`, `ts` (secondes Unix) ; virgule décimale acceptée ;
  - JSON Shelly Gen2/Gen3 : notification `{ method: 'NotifyFullStatus'|'NotifyStatus'|'NotifyEvent', params: { ts, 'temperature:0': { tC }, 'devicepower:0': { battery: { percent } }, events: [{ tC }] } }` ou objet d'état seul (`Shelly.GetStatus`) ;
  - JSON simple : `{ temp | temperature | tC | value_c, battery | battery_percent, ts | measured_at }`, `{ temperature: { tC } }`, ou un nombre seul.
  - Absente / illisible (ex. « `${ev.tC}` » non substitué) → 400 `invalid_measurement` ; hors −60..+100 °C → 422 `out_of_range` ; arrondi à 0,1 °C. Pile hors 0..100 ignorée. Horodatage du capteur retenu seulement dans [now − 24 h, now + 5 min], sinon heure de réception. Corps ≤ 16 ko (413).
- **Limite de débit** : au moins 30 s entre deux mesures stockées d'un capteur, sinon 429 `rate_limited` (`Retry-After: 30`) et rien n'est écrit. Pré-contrôle sur `last_seen_at`, puis la base tranche sous verrou (`sensor_record_reading()`, tout ou rien, voir `backend-db.md`). Réponse 200 `{ ok, stored: true, sensor_id, value_c, battery_percent }`.

### alerts-evaluate (lot 6)
`POST`, en-tête `x-alerts-secret` = `ALERTS_EVALUATE_SECRET` (≥ 32 caractères ; absent → 503 `not_configured` ; mauvais → 401). Réponse `{ ok, opened, resolved, open, notified, push: { enabled, sent, failed, removed }, email: 'disabled'|'skipped'|'sent'|'failed' }`.

**Moteur** (`alerts_engine.ts`, pur, testé avec horloge injectée en Europe/Paris). Il lit : réglages, fuseau `establishment.timezone` (invalide → Europe/Paris), équipements, seuils, capteurs, mesures depuis 24 h + la plus grande tolérance, enregistrements **hors quarantaine** reçus depuis 8 jours (`temperature_check`, `correction`, `corrective_action`, `cooling`, `reheating`, `hot_holding`, `cooking_check`), alertes ouvertes. Les **corrections** (même successives) sont appliquées à leur original : payload en vigueur, heure = `device_time` de l'original (comme l'app).

| Nature | Ouverte quand | Résolue quand |
|---|---|---|
| `sensor_out_of_range` | dernière mesure hors du seuil `temperature_check` de l'enceinte (le sien, sinon le générique, sinon le défaut du type : frigo ≤ 4 °C / 20 min, congélateur ≤ −18 °C / 30 min, comme l'app) ET toutes les mesures depuis la dernière bonne le sont depuis ≥ `tolerance_minutes` | dernière mesure dans le seuil. Aucune mesure récente : laissée en l'état |
| `sensor_silent` | aucune mesure depuis plus de `sensor_silent_minutes` (depuis la création si jamais vu) | une mesure arrive |
| `sensor_battery_low` | pile < 20 % | pile ≥ 25 % (hystérésis contre le va-et-vient 19/20 %) ou inconnue |
| `check_overdue` | enceinte froide active (frigo, congélateur) : créneau S = `currentSlot(now − 1 h)` (même fonction et même règle `missed_slot_carry_over` que l'app) et aucun `temperature_check` de cette enceinte avec `device_time ≥ S` | relevé reçu ; ou plus de créneau dû (sans report : après minuit + 1 h) |
| `process_overdue` | `cooling`/`reheating` : étape `start` sans `end` du même `batch_id` depuis plus que `tolerance_minutes` du seuil générique (sinon `DEFAULT_PROCESS_THRESHOLDS` : 120 / 60 min) | étape `end` reçue |
| `corrective_action_missing` | `in_range = false` en vigueur (`temperature_check`, `hot_holding`, `cooking_check`, `cooling`/`reheating` à `end`) depuis ≥ 30 min, sans `corrective_action` dont `related_record_id` vise l'original ou une de ses corrections | action corrective reçue, ou correction qui remet `in_range = true` |

Capteur ou enceinte désactivés : leurs alertes sont résolues. Sujet changé (capteur déplacé sur une autre enceinte) : ancienne alerte résolue, nouvelle ouverte. Alertes d'enregistrements sortis de la fenêtre de 8 jours : laissées en l'état (prise en compte manuelle). Les résolutions passent avant les ouvertures (index « une alerte ouverte par sujet ») ; une ouverture concurrente (23505) est ignorée.

**Notifications.** Pour les alertes ouvertes, **non prises en compte**, jamais notifiées ou notifiées depuis au moins `alert_repeat_minutes` (marge d'1 min pour la planification) :
- **Web Push** à chaque abonnement (`_shared/webpush.ts`, sans bibliothèque : WebCrypto seul, compatible Edge Functions ; chiffrement RFC 8291 « aes128gcm » vérifié sur le vecteur de la RFC, JWT VAPID ES256, en-têtes `TTL: 3600`, `Urgency: high`, `Topic` = id de l'alerte sans tirets : un rappel remplace la notification en attente). 2xx : `last_success_at`, `failures = 0` ; **404/410 : abonnement supprimé** ; autre statut ou erreur réseau : `failures + 1`, abonnement supprimé à 20. Contenu JSON lu par le service worker de l'app : `{ title, body, url: '/', tag: <alert_id>, alert_id, kind }` (titre court par nature : « Température hors seuil », « Capteur muet », « Pile faible », « Relevé en retard », « Procédé non clôturé », « Action corrective manquante » ; `body` = `message`).
- **E-mail** (`EmailSender`, implémentation Resend) : **activé seulement si `RESEND_API_KEY` et `ALERT_EMAIL_TO` sont définis ET si `settings.email_alerts` est vrai** ; sinon `email: 'disabled'`, sans erreur. Un seul message récapitulatif par passage, pour les alertes notifiées **pour la première fois** (pas à chaque rappel). `ALERT_EMAIL_FROM` facultatif (défaut `onboarding@resend.dev`, l'adresse de test de Resend, qui n'envoie qu'à l'adresse du compte Resend : vérifier un domaine pour un autre destinataire). Échec d'envoi : journalisé (`email_failed`), sans bloquer.
- `last_notified_at` n'est posé que si au moins un canal a remis le message (sinon nouvel essai au passage suivant).
- Limite : deux exécutions simultanées (planification + appel manuel) peuvent doubler une notification, jamais une alerte (index unique).

**Planification** (à faire une fois dans l'éditeur SQL de Supabase ; elle n'est pas posée par les migrations car il faut l'URL du projet et le secret) :
```sql
-- 1. Extensions (Database > Extensions) : pg_cron et pg_net.
-- 2. Secret dans Vault (même valeur que le secret de fonction ALERTS_EVALUATE_SECRET) :
select vault.create_secret('<32+ caractères aléatoires>', 'alerts_evaluate_secret', 'x-alerts-secret de alerts-evaluate');
-- 3. Toutes les 5 minutes :
select cron.schedule('haccp-alerts-evaluate', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/alerts-evaluate',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-alerts-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'alerts_evaluate_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000)
$$);
-- Contrôle : select * from cron.job_run_details order by start_time desc limit 5;
--            select status_code, content from net._http_response order by created desc limit 5;
-- Arrêt :    select cron.unschedule('haccp-alerts-evaluate');
```
Cet appel toutes les 5 minutes sert aussi de « keep-alive » du projet gratuit. Volume : environ 8 600 appels par mois, dans le quota gratuit des Edge Functions.

### push-subscribe / push-config (lot 6)
- `GET /functions/v1/push-config` (public) → `{ enabled, vapid_public_key }` (`enabled: false` et clé `null` si `VAPID_PUBLIC_KEY` est absente ou mal formée). L'app passe la clé à `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
- `POST /functions/v1/push-subscribe` (`x-device-token`), corps `PushSubscribeRequest`. `PushSubscription.toJSON()` est accepté tel quel (`expirationTime` ignoré, tout autre champ refusé). `endpoint` : https, ≤ 2048 caractères, **service push connu** (`*.push.apple.com`, `fcm.googleapis.com`, `android.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`) : le serveur n'envoie jamais vers une URL arbitraire. `keys.p256dh` : point P-256 non compressé (65 octets) ; `keys.auth` : 16 octets ; base64url ou base64, normalisés en base64url sans « = ». Réponse 201 `{ ok, status: 'created' }` ou 200 `'updated'` (même endpoint : clés et appareil remplacés, échecs remis à zéro) ; 400 `invalid_request` sinon.
- `DELETE /functions/v1/push-subscribe` (`x-device-token`), corps `{ endpoint }` ou `?endpoint=` → 200 `{ ok, deleted }`. Seuls les abonnements de l'appareil authentifié sont supprimés.
- iPhone / iPad : le Web Push ne marche que pour la PWA **ajoutée à l'écran d'accueil** (iOS/iPadOS 16.4+), et la permission doit être demandée après un geste de l'utilisateur.
- **Clés VAPID** : `node scripts/generate-vapid.mjs mailto:<adresse>` affiche `VAPID_PUBLIC_KEY` (65 octets base64url), `VAPID_PRIVATE_KEY` (scalaire d, 32 octets base64url, format de la bibliothèque `web-push`) et `VAPID_SUBJECT`. Changer de paire invalide tous les abonnements (il faut se réabonner).

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
[functions.sensor-ingest]
verify_jwt = false   # auth par jeton de capteur
[functions.alerts-evaluate]
verify_jwt = false   # auth par x-alerts-secret
[functions.push-subscribe]
verify_jwt = false   # auth par jeton appareil
[functions.push-config]
verify_jwt = false   # public
```
```bash
supabase secrets set ALLOWED_ORIGIN=https://<app>.pages.dev PURGE_PHOTOS_SECRET=<32+ caractères aléatoires>
# Lot 6
supabase secrets set ALERTS_EVALUATE_SECRET=<32+ caractères aléatoires>
node scripts/generate-vapid.mjs mailto:<adresse>   # puis :
supabase secrets set VAPID_PUBLIC_KEY=<…> VAPID_PRIVATE_KEY=<…> VAPID_SUBJECT=mailto:<adresse>
# Facultatif (e-mail, plus tard) : supabase secrets set RESEND_API_KEY=re_… ALERT_EMAIL_TO=<adresse> [ALERT_EMAIL_FROM='HACCP <alertes@domaine-vérifié>']
supabase functions deploy sync-push sync-pull device-enroll health bootstrap-status bootstrap-manager photo-upload purge-photos sensor-ingest alerts-evaluate push-subscribe push-config
```
Puis planifier `alerts-evaluate` (SQL ci-dessus). Sans les secrets VAPID, `alerts-evaluate` fonctionne quand même (alertes calculées et visibles dans l'app), sans Web Push (`push_not_configured` au démarrage).
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
