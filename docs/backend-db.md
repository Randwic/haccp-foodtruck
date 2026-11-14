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

## Tables

- **Références** (modifiables par le gérant, journalisées) : `establishment` (une seule ligne), `managers`, `staff`, `devices`, `equipment`, `thresholds`, `settings` (une seule ligne, `id = 1`).
- **Registre** `records` : insertion seule. `audit_log` : insertion seule.
- `settings.daily_check_times` (`text[]`, défaut `{08:00,18:00}`) : heures des relevés d'enceintes, heure locale. Contrainte `haccp_valid_check_times()` : 1 à 6 heures `HH:MM` distinctes, sans null, tableau à une dimension.
- Seuils génériques (`equipment_id` null) posés par `…0800` et le seed (idempotents, `on conflict do nothing`, à confirmer selon le PMS) : `hot_holding` min 63, `cooking_check` min 70, `cooling` max 10 / `tolerance_minutes` 120, `reheating` min 63 / 60. Pour les procédés, `tolerance_minutes` = durée maximale. Le « départ ≥ 63 °C » du refroidissement n'a pas de ligne (une ligne par type).
- `staff.user_id` (null, unique, → `auth.users`, `on delete set null`) : relie le compte Supabase du gérant à sa fiche équipier.
- `bootstrap_attempts` (table interne) : échecs d'inscription du gérant (horodatage + raison courte, aucune donnée personnelle). RLS sans politique, aucun privilège : accès seulement par les fonctions ci-dessous.
- `record_chain_anchors` (table interne) : dernier maillon supprimé par la purge pour chaque appareil, pour que la chaîne puisse continuer et rester vérifiable.
- `suppliers` (lot 3) : `name` 1–80 (non blanc), `phone` 1–30 ou null, `email` plausible ou null, `active`. Référence comme les autres (RLS gérant, audit, `updated_at` forcé, `service_role` en lecture seule). **Aucune suppression**, pour personne, propriétaire compris (trigger, TRUNCATE aussi) : les réceptions référencent `supplier_id` dans leur payload jsonb, sans clé étrangère possible → désactiver. Index `records_supplier_idx` pour la traçabilité amont.

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
- applique les migrations (celle du lot 3 deux fois) et le seed (deux fois), pour vérifier l'idempotence, puis `helpers.sql` ;
- exécute chaque `supabase/tests/sql/*.sql` dans une base clonée neuve ;
- vérifie la concurrence de `bootstrap_manager()` avec deux sessions `psql` simultanées (une seule réussit) ;
- détruit le cluster.

Tout échec arrête le script avec un code ≠ 0.
