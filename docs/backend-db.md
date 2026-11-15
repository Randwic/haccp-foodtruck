# Backend — base de données et sécurité

Migrations : `supabase/migrations/` (appliquées dans l'ordre), données initiales : `supabase/seed.sql`.

| Migration | Contenu |
|---|---|
| `…0100_schema.sql` | Tables, contraintes, index |
| `…0200_integrity.sql` | Triggers d'immutabilité, chaîne de hachage, `updated_at`, audit, `is_manager()`, `device_chain_head()` |
| `…0300_rls_grants.sql` | Privilèges et Row Level Security |
| `…0400_purge.sql` | `purge_expired_records()` |
| `…0500_cron_purge.sql` | Planification pg_cron (quotidienne à 03:17 UTC). Si pg_cron est absent, la migration passe avec un avertissement |
| `…0600_quarantine.sql` | Quarantaine des enregistrements refusés pour leur contenu |
| `…0700_manager_bootstrap.sql` | `staff.user_id`, inscription unique du gérant (`bootstrap_manager()`), compteur anti-abus |
| `…0800_lot2_temperatures.sql` | `settings.daily_check_times`, seuils génériques des procédés, `records.device_now` et nouveau calcul de `clock_suspect` |
| `…0900_reglages_procedes.sql` | `settings.missed_slot_carry_over`, `settings.thaw_dlc_days` |
| `…1000_lot3_reception.sql` | Fournisseurs, bucket privé `photos` et ses politiques, `photos_to_purge()`, `record_photo_purge()` (idempotente, rejouée par les tests) |
| `…1100_lot4_produits.sql` | Produits, recettes, produits d'exemple, index de traçabilité aval, `trace_lot()` (idempotente, rejouée par les tests) |
| `…1200_reglages_huile.sql` | `settings.oil_polar_max` (25) / `oil_polar_warn` (22) |
| `…1300_lot5_nettoyage.sql` | Plan de nettoyage, checklists, données d'exemple (idempotente, rejouée par les tests) |
| `…1400_lot6_alertes.sql` | Capteurs, mesures (insertion seule + purge), alertes (mises à jour contrôlées), prise en compte `alert_ack`, abonnements Web Push, réglages d'alerte (idempotente, rejouée par les tests) |

## Tables

- **Références** (modifiables par le gérant, journalisées) : `establishment` (une seule ligne), `managers`, `staff`, `devices`, `equipment`, `thresholds`, `settings` (une seule ligne, `id = 1`).
- **Registre** `records` : insertion seule. `audit_log` : insertion seule.
- `settings.daily_check_times` (`text[]`, défaut `{08:00,18:00}`) : heures des relevés d'enceintes, heure locale. Contrainte `haccp_valid_check_times()` : 1 à 6 heures `HH:MM` distinctes, sans null, tableau à une dimension.
- Seuils génériques (`equipment_id` null) posés par `…0800` et le seed (idempotents, `on conflict do nothing`, à confirmer selon le PMS) : `hot_holding` min 63, `cooking_check` min 70, `cooling` max 10 / `tolerance_minutes` 120, `reheating` min 63 / 60. Pour les procédés, `tolerance_minutes` = durée maximale. Le « départ ≥ 63 °C » du refroidissement n'a pas de ligne (une ligne par type).
- `staff.user_id` (null, unique, → `auth.users`, `on delete set null`) : relie le compte Supabase du gérant à sa fiche équipier.
- `bootstrap_attempts` (table interne) : échecs d'inscription du gérant (horodatage + raison courte, aucune donnée personnelle). RLS sans politique, aucun privilège : accès seulement par les fonctions ci-dessous.
- `record_chain_anchors` (table interne) : dernier maillon supprimé par la purge pour chaque appareil, pour que la chaîne puisse continuer et rester vérifiable.
- `suppliers` (lot 3) : `name` 1–80 (non blanc), `phone` 1–30 ou null, `email` plausible ou null, `active`. Référence comme les autres (RLS gérant, audit, `updated_at` forcé, `service_role` en lecture seule). **Aucune suppression**, pour personne, propriétaire compris (trigger, TRUNCATE aussi) : les réceptions référencent `supplier_id` dans leur payload jsonb, sans clé étrangère possible → désactiver. Index `records_supplier_idx` pour la traçabilité amont.

- `products` (lot 4) : `name` 1–80 (non blanc), `allergens text[]` ⊂ les 14 codes de `ALLERGENS` (sans null ni doublon, une dimension : `haccp_valid_allergens()`), `storage` `fridge|freezer|ambient`, `shelf_life_opened_hours` / `shelf_life_thawed_hours` 1–2160 ou null.
- `recipes` (lot 4) : `name` 1–80, `ingredient_product_ids uuid[]` 0–50 sans null, `extra_allergens` (même contrôle), `storage`, `shelf_life_hours` 1–2160 (obligatoire). Chaque ingrédient doit exister dans `products` (trigger, `HACCP: unknown_product` ; produit désactivé accepté). Pas de clé étrangère sur un tableau, mais un produit n'est jamais supprimé, donc le contrôle à l'écriture suffit.
- Produits et recettes : **même régime que `suppliers`** (RLS gérant en lecture/écriture, `service_role` en lecture seule, audit, `updated_at` forcé, DELETE et TRUNCATE bloqués pour tous par `haccp_reference_no_delete()` → désactiver). La migration pose 8 produits d'un food truck burger/frites et une recette d'exemple (uuid fixes `…0401`–`…0408`, `…0451`, `on conflict do nothing` : une fiche modifiée par le gérant n'est jamais écrasée). **Allergènes à vérifier sur les fiches fournisseurs, durées de vie à confirmer selon le PMS.**
- Traçabilité aval (lot 4) :
  - `haccp_norm_lot(text)` : minuscules, sans espaces. `haccp_record_lots(payload)` : lots normalisés cités par `lot`, `items[].lot` et les mêmes sous `replacement` (corrections) ; mode jsonpath *lax*, jamais d'erreur sur un payload en quarantaine ; valeurs > 100 caractères ignorées (taille d'entrée d'index).
  - Index : `records_lots_idx` (GIN sur `haccp_record_lots(payload)`, types `reception|waste|label_printed|correction`), `records_label_sources_idx` (GIN `jsonb_path_ops` sur `payload->'source_record_ids'`, étiquettes : `… @> jsonb_build_array('<uuid>')`), `records_correction_sources_idx` (idem sous `replacement`), `records_waste_related_idx` (`payload->>'related_record_id'` des pertes).
  - `trace_lot(p_lot)` (SECURITY DEFINER, **gérant seulement** : `HACCP: forbidden` sinon ; EXECUTE accordé à `authenticated` uniquement ; lot vide → `HACCP: invalid_lot`). Renvoie `kind` (`reception|label_printed|waste`, type d'origine pour une correction), `matched_by` (`lot` | `source_record` | `related_record`), `record_id`, `record_type`, `supersedes_id`, `corrected` (corrigé depuis), `quarantine_reason`, `device_time`, `server_time`, `author_id`, `device_id`, `payload`. Contenu : réceptions dont une ligne porte le lot (et toute leur chaîne de corrections), étiquettes portant le lot ou citant une de ces réceptions dans `source_record_ids`, pertes portant le lot ou liées (`related_record_id`) à une de ces réceptions / étiquettes. La quarantaine est incluse et signalée (pour un rappel, mieux vaut trop que pas assez). Un seul niveau : une étiquette faite à partir d'une autre étiquette n'est pas suivie.
  - Appel depuis l'app gérant : `supabase.rpc('trace_lot', { p_lot })`.
- `cleaning_tasks` (lot 5) : `name` 1–80 (non blanc), `frequency` `after_service|daily|weekly|monthly`, `product` ≤ 80 ou null, `method` ≤ 500 ou null.
- `checklists` (lot 5) : `name` 1–80, `kind` `opening|closing|pest_control|other`, `items jsonb` contrôlé par `haccp_valid_checklist_items()` : tableau de 1 à 40 objets ayant exactement `id` (`[a-z0-9_-]{1,40}`, unique dans la checklist), `label` (1–120, non blanc), `required` (booléen).
- Tâches et checklists : **même régime que `products`** (RLS gérant, `service_role` en lecture seule, audit, `updated_at` forcé, DELETE/TRUNCATE bloqués → désactiver). Données d'exemple (uuid fixes `…0501`–`…0511` pour 11 tâches, `…0551`–`…0553` pour les checklists Ouverture / Fermeture / Contrôle nuisibles, `on conflict do nothing`). **Produits et modes opératoires génériques, à adapter selon le PMS.** La vidange du bac de friteuse est en `weekly` par défaut (en pratique : à chaque changement d'huile).

- **Lot 6 — capteurs et alertes** (`…1400`) :
  - `settings.sensor_silent_minutes` (défaut 60, 15..1440) et `settings.alert_repeat_minutes` (défaut 15, 5..1440), contrainte `settings_alert_ranges`, exposés par sync-pull.
  - `sensors` (`Sensor` + `token_hash`, `created_at`) : `name` 1–80, `equipment_id` → `equipment` (`on delete restrict`), `vendor` `shelly_ht|thermoworks_node|tempstick|generic`, `last_value_c` −60..100, `battery_percent` 0..100. **Même régime que `suppliers`** (RLS gérant, audit, `updated_at` forcé, DELETE/TRUNCATE bloqués pour tous), avec en plus des **privilèges de colonne** : le gérant lit et écrit tout sauf `token_hash` (ni lecture ni écriture — un `select *` est refusé : lister les colonnes) et sauf la télémétrie (`last_seen_at`, `last_value_c`, `battery_percent`, en lecture seule). `service_role` : lecture seule (dont `token_hash`). Les mises à jour de télémétrie seules ne sont pas journalisées (trigger d'audit avec clause `WHEN`) ; `token_hash` est masqué (`***`) dans l'audit.
  - `sensor_create(p_name, p_equipment_id, p_vendor default 'shelly_ht')` → `(sensor_id, sensor_token)` et `sensor_rotate_token(p_sensor_id)` → nouveau jeton : SECURITY DEFINER, **gérant seulement** (`HACCP: forbidden`), EXECUTE à `authenticated` uniquement. Jeton = 2 × `gen_random_uuid()` (générateur fort de PostgreSQL, 244 bits aléatoires) → 32 octets → **43 caractères base64url**, renvoyé une seule fois ; seul son SHA-256 hex est stocké. Appel depuis l'app gérant : `supabase.rpc('sensor_create', { p_name, p_equipment_id, p_vendor })`.
  - `sensor_readings(id bigserial, sensor_id, measured_at, value_c numeric(4,1) −60..100, battery_percent null 0..100, received_at)` : **insertion seule** (UPDATE/DELETE/TRUNCATE refusés pour tous, propriétaire compris ; `received_at` forcé à `now()` ; `measured_at` ∈ [`received_at` − 24 h, `received_at` + 5 min]). Index `(sensor_id, measured_at desc)` et `(received_at)`. Aucun privilège d'écriture : seule `sensor_record_reading(p_sensor_id, p_measured_at, p_value_c, p_battery_percent, p_min_interval_seconds default 30)` (SECURITY DEFINER, **`service_role` seulement**) écrit, tout ou rien : verrou par capteur, limite de débit (≥ 30 s depuis `last_seen_at`), insertion, mise à jour de `last_seen_at` (heure serveur), `last_value_c`, `battery_percent` (conservée si absente). Résultat : `stored|rate_limited|inactive|unknown_sensor`. Lecture : gérant (RLS) et `service_role`.
  - Purge des mesures : `purge_sensor_readings()` (SECURITY DEFINER, `service_role` et pg_cron) supprime les mesures reçues avant `now() − retention_years` (même indicateur `haccp.purge_in_progress` que la purge du registre, reconnu seulement pour le propriétaire et une ligne réellement expirée) et écrit un résumé `PURGE` (`table_name = 'sensor_readings'`) dans `audit_log`. Planifiée par la migration (`haccp-purge-sensor-readings`, 03:27 UTC) si pg_cron est présent ; sinon avertissement et commande à relancer en tête de section.
  - `alerts` (`Alert` + `acknowledged_by_record_id`, `updated_at`) : `kind` ∈ `AlertKind`, sujet exigé selon la nature (`sensor_*` → `sensor_id`, `check_overdue` → `equipment_id`, sinon `related_record_id`, sans clé étrangère : le registre peut être purgé), `message` 1–300. **Une seule alerte ouverte par sujet** : index unique partiel `alerts_one_open_idx (kind, equipment_id, sensor_id, related_record_id) nulls not distinct where resolved_at is null`. Trigger `haccp_alerts_guard` (tous rôles) : création forcément ouverte / non prise en compte / non notifiée, `opened_at = now()` ; en mise à jour, **seules** `resolved_at` (une fois, jamais rouverte), `acknowledged_at` + `acknowledged_by_record_id` (une fois, définitif) et `last_notified_at` (jamais effacée) changent, et leurs valeurs sont **remplacées par `now()`** ; DELETE et TRUNCATE interdits. Privilèges : `service_role` lit, insère (`kind, equipment_id, sensor_id, related_record_id, message`) et met à jour `resolved_at, last_notified_at` seulement ; le gérant lit (RLS). Index `alerts_updated_idx` pour sync-pull.
  - **Prise en compte** : trigger `records_alert_ack` (AFTER INSERT sur `records`, SECURITY DEFINER) — un record `alert_ack` **hors quarantaine** pose `acknowledged_at = now()` et `acknowledged_by_record_id` sur l'alerte `payload.alert_id` si elle n'est pas déjà prise en compte. **Choix** : fait par la base, dans la transaction d'insertion du registre, plutôt que par une Edge Function : impossible de perdre la prise en compte (pas de seconde écriture qui pourrait échouer), et c'est la seule voie (`service_role` n'a pas le droit d'écrire `acknowledged_at`). Une correction d'`alert_ack` n'a pas d'effet ; un `alert_ack` en quarantaine non plus.
  - `push_subscriptions(id, device_id → devices, endpoint unique https ≤ 2048, p256dh base64url 87 car., auth base64url 22 car., created_at, updated_at, last_success_at, failures)` : pas une donnée HACCP — `service_role` lit, crée, met à jour et **supprime** (désabonnement, 404/410) ; le gérant ne voit que l'état (`id, device_id, created_at, updated_at, last_success_at, failures`), ni l'URL ni les clés.

## Règles de sécurité

1. **Registre infalsifiable.** Des triggers BEFORE UPDATE, DELETE et TRUNCATE bloquent ces opérations sur `records`, `audit_log` et `record_chain_anchors`, pour tous les rôles, propriétaire compris. Par-dessus, aucun privilège UPDATE/DELETE/TRUNCATE n'est accordé.
   - Seule exception : `purge_expired_records()` (SECURITY DEFINER). Elle pose l'indicateur local `haccp.purge_in_progress`. Les triggers n'en tiennent compte que si `current_user` est le propriétaire de la table, et seulement pour des lignes réellement expirées. Un rôle applicatif qui pose lui-même cet indicateur reste bloqué.
2. **Contrôles à l'insertion dans `records`**, en filet de sécurité sous les Edge Functions :
   - `server_time` est imposé à `now()` ;
   - `clock_suspect` = valeur fournie **OU** |`server_time` − horloge appareil| > `settings.clock_suspect_minutes`. Horloge appareil = `device_now` (horloge à l'envoi, posée par `sync-push`) si présente, sinon `device_time` (ancienne app). `device_now` n'est pris en compte que pour le rôle `service_role` (`current_setting('role')`) ; pour tout autre rôle il est remis à null. Une valeur fournie ne peut qu'ajouter le signalement, jamais l'effacer ;
   - un appareil révoqué est refusé ;
   - la chaîne est vérifiée : `prev_hash` doit être le hash du maillon `device_seq - 1` (ou celui de l'ancre de purge), sans trou, et la genèse doit être `GENESIS_HASH`.
   - Les erreurs commencent par `HACCP: seq_gap`, `HACCP: broken_chain` ou `HACCP: device_revoked`.
   - Hors quarantaine, l'auteur doit exister (`HACCP: unknown_author`) et l'enregistrement corrigé aussi (`HACCP: supersedes_not_found`).
   - Le hash lui-même est recalculé par la logique serveur (JSON canonique), pas en SQL.
3. **Contraintes.**
   - Toujours appliquées : `device_seq >= 1` ; `hash`/`prev_hash` au format `^[0-9a-f]{64}$` ; genèse = `GENESIS_HASH` ; unicité `(device_id, device_seq)` ; l'appareil existe.
   - Hors quarantaine seulement : type connu (`haccp_known_record_type()`, même liste que `RecordType`, partagée avec le domaine `record_type` des seuils) ; `type = 'correction'` ⇔ `supersedes_id` non nul ; `payload` est un objet.
3 bis. **Quarantaine** (`records.quarantine_reason` : `unknown_author`, `unknown_type`, `invalid_payload`, `supersedes_not_found`).
   - Un enregistrement dont la chaîne est valide mais dont le contenu est refusé est stocké avec sa raison de quarantaine. Il est immuable et fait avancer la chaîne : `device_chain_head` l'inclut, donc l'appareil n'est jamais bloqué.
   - Les erreurs de chaîne (hash, `broken_chain`, `seq_gap`, `id_conflict`) ne sont jamais stockées.
   - Un index partiel (`records_quarantine_idx`) permet au gérant d'examiner la quarantaine.
   - **Choix** : les colonnes gardent les valeurs d'origine, ce qui est indispensable pour recalculer le hash. Les clés étrangères `author_id → staff` et `supersedes_id → records` ont donc été retirées. Elles sont remplacées par une vérification dans le trigger d'insertion, faite hors quarantaine seulement. Cette vérification à l'insertion suffit, parce que le registre est immuable et que la purge conserve toujours un original référencé.
4. **RLS sur toutes les tables.**
   - `anon` n'a aucun accès.
   - `authenticated` : un gérant (`is_manager()`) lit tout et écrit les références. Sur `devices`, il peut seulement renommer ou révoquer, et une révocation est définitive. Il n'écrit jamais dans `records`, `audit_log` ni `managers`.
   - Un utilisateur connecté qui n'est pas gérant ne voit rien.
   - `service_role` (Edge Functions) : insère dans `records`, lit et met à jour les références. Il ne fait aucun DELETE.
   - Les privilèges larges que Supabase accorde par défaut sont révoqués, y compris pour les objets créés plus tard.
5. **Audit** : toute insertion, modification ou suppression sur une table de référence est écrite dans `audit_log` (old/new, acteur = `auth.uid()` ou `'service'`).
   - `pin_hash`, `pin_salt` et `token_hash` sont remplacés par `***`. `_secrets_changed` indique lesquels ont changé.
   - Une mise à jour de `last_seen_at` seul n'est pas journalisée.
6. **Références** : `updated_at` est forcé par trigger. On ne supprime pas : on désactive avec `active = false`. Un membre ou un équipement référencé ne peut pas être supprimé, même par le propriétaire.
7. **Purge** : est expiré ce dont `server_time < now() - retention_years`.
   - Un enregistrement expiré est conservé tant qu'une correction encore conservée le référence (directement ou en chaîne).
   - Les enregistrements en quarantaine suivent la même règle.
   - Un résumé `PURGE` est écrit dans `audit_log`.
   - L'exécution est réservée au propriétaire (pg_cron) et à `service_role`.

8. **Inscription du gérant** (`…0700`), fonctions SECURITY DEFINER exécutables **par `service_role` seulement** :
   - `bootstrap_manager(user_id, display_name, pin_salt, pin_hash, establishment_name)` → `staff.id`. Verrou `pg_advisory_xact_lock`, puis revérifie qu'aucun gérant n'existe (sinon `HACCP: already_bootstrapped`), insère `managers`, la fiche `staff` (role `manager`, PIN fourni, `user_id`) et renomme l'établissement (le crée s'il manque). Tout ou rien. Deux appels simultanés : le second attend le verrou puis échoue. Audit habituel (acteur `service`, PIN masqué).
   - `bootstrap_failure_count(minutes)` et `bootstrap_record_failure(reason)` : compteur anti-abus (lignes de plus de 24 h supprimées à chaque nouvel échec).
9. **Paramétrage par le gérant via l'API REST** (supabase-js + JWT) : `select`/`insert`/`update` (donc aussi `upsert`) sur `equipment`, `thresholds`, `staff` (PIN compris), `settings`, `establishment`. Vérifié par `85_manager_rest.sql` ; aucun changement de RLS n'a été nécessaire. Non-gérant : refus RLS ; anon : `permission denied`. Pas de DELETE (désactiver avec `active = false`).

10. **Photos (lot 3)** : bucket Storage `photos` créé par migration (`public = false`, 1 Mo, `image/webp`).
   - Politiques `storage.objects` : lecture par le gérant (`is_manager()`) ; politiques **restrictives** qui, même si une politique large est ajoutée plus tard, interdisent toute écriture/suppression du bucket à `anon` et `authenticated` et sa lecture à tout autre que le gérant. Seule l'Edge Function `photo-upload` (clé `service_role`) écrit.
   - **Purge — choix** : `purge_expired_records()` n'est pas modifiée. Sur Supabase un `DELETE` SQL dans `storage.objects` est bloqué (`storage.protect_delete()`) et laisserait le fichier en place ; la suppression passe donc par l'API Storage dans l'Edge Function `purge-photos`. La base désigne les objets : `photos_to_purge(limit)` renvoie les photos **plus vieilles que `retention_years` ET référencées par aucun enregistrement présent** (toute chaîne `<uuid>/<uuid>.webp` du payload : `photo_paths`, `items[].photo_paths`, remplacements des corrections, quarantaine comprise). Une correction conservée garde son original, donc ses photos ; une photo orpheline part après la durée de conservation. `record_photo_purge(deleted, failed)` écrit un résumé `PURGE_PHOTOS` dans `audit_log`. Les deux fonctions : `service_role` seulement.

Limite connue : le propriétaire de la base (rôle `postgres` de Supabase) peut toujours désactiver un trigger par une commande DDL. La protection vise l'API et les rôles applicatifs. Il faut protéger l'accès au tableau de bord Supabase (mot de passe fort et 2FA).

## Mise en place sur Supabase

1. Lier le projet et pousser les migrations : `supabase link` puis `supabase db push`. Appliquer ensuite `seed.sql` une seule fois.
2. Activer pg_cron (Database > Extensions). Si pg_cron a été activé après la migration, relancer la commande de planification indiquée en tête de `…0500_cron_purge.sql`.
3. Photos : planifier `purge-photos` une fois par jour (voir `backend-logic.md`).
3 bis. Lot 6 : activer aussi **pg_net**, mettre le secret d'`alerts-evaluate` dans Vault et planifier l'appel toutes les 5 minutes (SQL fourni dans `backend-logic.md` § alerts-evaluate). La purge des mesures (`haccp-purge-sensor-readings`) est planifiée par la migration si pg_cron est déjà actif ; sinon relancer la commande indiquée dans `…1400_lot6_alertes.sql`. Capteurs : [`backend-shelly.md`](backend-shelly.md).
4. Laisser l'inscription libre désactivée. Le gérant crée son compte depuis l'app au premier lancement (Edge Function `bootstrap-manager`, une seule fois). En secours : créer l'utilisateur dans Auth puis `insert into public.managers (user_id) values ('<uuid>');`.

Les types du lot 2 (`cooling`, `reheating`, `thawing`, `hot_holding`, `cooking_check`) figuraient déjà dans `haccp_known_record_type()` : aucune modification.

## Tests

```bash
bash supabase/tests/run.sh
```

Prérequis : PostgreSQL 16 (`/usr/lib/postgresql/16/bin`, modifiable avec `PGBIN`) et `python3`.

Le script :
- crée un cluster jetable sur un port libre ;
- installe les stubs Supabase (`supabase/tests/supabase_stubs.sql` : rôles, `auth.users`, `auth.uid()`, privilèges par défaut, schéma `storage` minimal avec RLS et le blocage du `DELETE` direct) ;
- applique les migrations (celles des lots 3, 4, 5 et 6 deux fois) et le seed (deux fois), pour vérifier l'idempotence, puis `helpers.sql` ;
- exécute chaque `supabase/tests/sql/*.sql` dans une base clonée neuve ;
- vérifie la concurrence de `bootstrap_manager()` avec deux sessions `psql` simultanées (une seule réussit) ;
- détruit le cluster.

Tout échec arrête le script avec un code ≠ 0.
