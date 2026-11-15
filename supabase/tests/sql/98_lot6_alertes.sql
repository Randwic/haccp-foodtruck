-- Lot 6 : capteurs (jeton jamais lisible), mesures en insertion seule + purge, alertes
-- (mises à jour contrôlées, jamais supprimées), prise en compte par alert_ack, abonnements push.

-- ---------------------------------------------------------------------------
-- Réglages
-- ---------------------------------------------------------------------------
select tests.assert_eq((select sensor_silent_minutes from public.settings where id = 1), 60, 'settings.sensor_silent_minutes : 60 par défaut');
select tests.assert_eq((select alert_repeat_minutes from public.settings where id = 1), 15, 'settings.alert_repeat_minutes : 15 par défaut');
select tests.throws('sensor_silent_minutes < 15 refusé', 'postgres', null, 'update public.settings set sensor_silent_minutes = 10', '%settings_alert_ranges%');
select tests.throws('alert_repeat_minutes > 1440 refusé', 'postgres', null, 'update public.settings set alert_repeat_minutes = 1441', '%settings_alert_ranges%');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.settings set sensor_silent_minutes = 180, alert_repeat_minutes = 30 returning 1) select count(*) from u'), '1',
  'gérant modifie les réglages d''alerte');

-- ---------------------------------------------------------------------------
-- Capteurs : création par le gérant, jeton affiché une fois, jamais relisible
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', tests.manager_uid()::text, false);
create temp table t_sensor as select * from public.sensor_create('Sonde frigo 1', '00000000-0000-4000-8000-000000000101', 'shelly_ht');
select set_config('request.jwt.claim.sub', '', false);
grant select on t_sensor to public;

select tests.assert((select sensor_token ~ '^[A-Za-z0-9_-]{43}$' from t_sensor), 'sensor_create : jeton de 43 caractères base64url');
select tests.assert_eq((select s.token_hash from public.sensors s join t_sensor t on t.sensor_id = s.id),
                       (select encode(sha256(convert_to(sensor_token, 'UTF8')), 'hex') from t_sensor),
  'sensor_create : seul le SHA-256 du jeton est stocké');
select tests.assert((select s.vendor = 'shelly_ht' and s.active and s.last_seen_at is null from public.sensors s join t_sensor t on t.sensor_id = s.id),
  'capteur créé actif, jamais vu');
select tests.throws('non-gérant : sensor_create refusé', 'authenticated', tests.user_uid(),
  'select * from public.sensor_create(''X'', ''00000000-0000-4000-8000-000000000101'')', 'HACCP: forbidden%');
select tests.throws('anon : sensor_create refusé', 'anon', null,
  'select * from public.sensor_create(''X'', ''00000000-0000-4000-8000-000000000101'')', '%permission denied%');
select tests.throws('service_role : sensor_create refusé', 'service_role', null,
  'select * from public.sensor_create(''X'', ''00000000-0000-4000-8000-000000000101'')', '%permission denied%');
select tests.throws('capteur : équipement inconnu refusé', 'postgres', null,
  'insert into public.sensors (name, equipment_id, token_hash) values (''X'', ''00000000-0000-4000-8000-0000000009ff'', repeat(''a'', 64))', '%foreign key%');
select tests.throws('capteur : fournisseur de capteur inconnu refusé', 'postgres', null,
  'insert into public.sensors (name, equipment_id, vendor, token_hash) values (''X'', ''00000000-0000-4000-8000-000000000101'', ''acme'', repeat(''a'', 64))', '%sensors_vendor_check%');
select tests.throws('capteur : nom vide refusé', 'postgres', null,
  'insert into public.sensors (name, equipment_id, token_hash) values ('' '', ''00000000-0000-4000-8000-000000000101'', repeat(''a'', 64))', '%sensors_name_check%');

select tests.assert((select relrowsecurity from pg_class where oid = 'public.sensors'::regclass), 'sensors : RLS activé');
select tests.throws('anon ne lit pas sensors', 'anon', null, 'select count(*) from public.sensors', '%permission denied%');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(id) from public.sensors'), '0', 'non-gérant ne voit aucun capteur');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(id) from public.sensors'), '1', 'gérant voit les capteurs (colonnes autorisées)');
select tests.throws('gérant : token_hash illisible', 'authenticated', tests.manager_uid(), 'select token_hash from public.sensors', '%permission denied%');
select tests.throws('gérant : select * refusé (token_hash)', 'authenticated', tests.manager_uid(), 'select * from public.sensors', '%permission denied%');
select tests.throws('gérant : token_hash non modifiable', 'authenticated', tests.manager_uid(), 'update public.sensors set token_hash = repeat(''b'', 64)', '%permission denied%');
select tests.throws('gérant : télémétrie non modifiable', 'authenticated', tests.manager_uid(), 'update public.sensors set last_value_c = 3', '%permission denied%');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.sensors set name = ''Sonde Frigo 1'' returning 1) select count(*) from u'), '1', 'gérant renomme un capteur');
select tests.throws('gérant ne supprime pas de capteur', 'authenticated', tests.manager_uid(), 'delete from public.sensors', '%permission denied%');
select tests.throws('propriétaire : suppression d''un capteur bloquée', 'postgres', null, 'delete from public.sensors', 'HACCP: suppression interdite, sensors%');
select tests.throws('propriétaire : TRUNCATE sensors bloqué', 'postgres', null, 'truncate public.sensors cascade', 'HACCP: %interdit%');
select tests.throws('service_role : pas d''écriture directe dans sensors', 'service_role', null, 'update public.sensors set last_value_c = 3', '%permission denied%');
select tests.assert_eq(tests.value_as('service_role', null, 'select count(token_hash) from public.sensors'), '1', 'service_role lit token_hash (sensor-ingest)');

select tests.assert((select new ->> 'token_hash' = '***' from public.audit_log where table_name = 'sensors' and action = 'INSERT' limit 1),
  'audit : création du capteur journalisée, token_hash masqué');

-- Renouvellement du jeton
select set_config('request.jwt.claim.sub', tests.manager_uid()::text, false);
create temp table t_rot as select public.sensor_rotate_token((select sensor_id from t_sensor)) as token, (select token_hash from public.sensors) as old_hash;
select set_config('request.jwt.claim.sub', '', false);
select tests.assert((select s.token_hash = encode(sha256(convert_to(r.token, 'UTF8')), 'hex') and s.token_hash <> r.old_hash from public.sensors s, t_rot r),
  'sensor_rotate_token : nouveau jeton, ancien invalidé');
select tests.assert(exists (select 1 from public.audit_log where table_name = 'sensors' and action = 'UPDATE' and new -> '_secrets_changed' ? 'token_hash'),
  'audit : renouvellement du jeton signalé (_secrets_changed) sans valeur');
select tests.throws('non-gérant : sensor_rotate_token refusé', 'authenticated', tests.user_uid(),
  format('select public.sensor_rotate_token(%L)', (select sensor_id from t_sensor)), 'HACCP: forbidden%');

-- ---------------------------------------------------------------------------
-- Mesures : sensor_record_reading(), limite de débit, insertion seule
-- ---------------------------------------------------------------------------
create temp table t_audit_before as select count(*) as n from public.audit_log where table_name = 'sensors';
grant select on t_audit_before to public;
select tests.assert_eq(tests.value_as('service_role', null,
  format('select public.sensor_record_reading(%L, now(), 3.46, 87)', (select sensor_id from t_sensor))), 'stored', 'service_role : mesure enregistrée');
select tests.exec_as('service_role', null, format('select public.sensor_record_reading(%L, now(), 3.46, 87)', (select sensor_id from t_sensor)));
select tests.assert_eq((select count(*)::int from public.sensor_readings), 1, 'une mesure stockée');
select tests.assert((select value_c = 3.5 and battery_percent = 87 and received_at > now() - interval '1 minute' from public.sensor_readings), 'valeur arrondie à 0,1 °C, pile, received_at serveur');
select tests.assert((select last_value_c = 3.5 and battery_percent = 87 and last_seen_at is not null from public.sensors), 'télémétrie du capteur mise à jour');
select tests.assert_eq((select count(*) from public.audit_log where table_name = 'sensors'), (select n from t_audit_before),
  'mise à jour de télémétrie non journalisée');
select tests.assert_eq(tests.value_as('service_role', null,
  format('select public.sensor_record_reading(%L, now(), 4.0, null)', (select sensor_id from t_sensor))), 'rate_limited', 'deuxième mesure < 30 s : rate_limited');
update public.sensors set last_seen_at = now() - interval '31 seconds';
select tests.exec_as('service_role', null, format('select public.sensor_record_reading(%L, now(), 4.0, null)', (select sensor_id from t_sensor)));
select tests.assert((select count(*) = 2 from public.sensor_readings) and (select battery_percent = 87 and last_value_c = 4.0 from public.sensors),
  'après 30 s : mesure stockée, pile conservée si absente');
select tests.assert_eq(tests.value_as('service_role', null,
  'select public.sensor_record_reading(''00000000-0000-4000-8000-0000000009ff'', now(), 4.0)'), 'unknown_sensor', 'capteur inconnu');
update public.sensors set active = false, last_seen_at = null;
select tests.assert_eq(tests.value_as('service_role', null,
  format('select public.sensor_record_reading(%L, now(), 4.0)', (select sensor_id from t_sensor))), 'inactive', 'capteur désactivé : mesure ignorée');
update public.sensors set active = true, last_seen_at = null;
select tests.throws('valeur absurde (150 °C) refusée', 'service_role', null,
  format('select public.sensor_record_reading(%L, now(), 150)', (select sensor_id from t_sensor)), '%sensor_readings_value_check%');
select tests.throws('valeur absurde (−61 °C) refusée', 'service_role', null,
  format('select public.sensor_record_reading(%L, now(), -61)', (select sensor_id from t_sensor)), '%sensor_readings_value_check%');
select tests.throws('heure de mesure à J−2 refusée', 'service_role', null,
  format('select public.sensor_record_reading(%L, now() - interval ''2 days'', 4)', (select sensor_id from t_sensor)), '%sensor_readings_measured_check%');
select tests.throws('heure de mesure dans 1 h refusée', 'service_role', null,
  format('select public.sensor_record_reading(%L, now() + interval ''1 hour'', 4)', (select sensor_id from t_sensor)), '%sensor_readings_measured_check%');
select tests.throws('pile 120 % refusée', 'service_role', null,
  format('select public.sensor_record_reading(%L, now(), 4, 120)', (select sensor_id from t_sensor)), '%sensor_readings_battery_check%');

select tests.throws('service_role : insertion directe refusée', 'service_role', null,
  format('insert into public.sensor_readings (sensor_id, measured_at, value_c) values (%L, now(), 4)', (select sensor_id from t_sensor)), '%permission denied%');
select tests.throws('anon : sensor_record_reading refusé', 'anon', null,
  format('select public.sensor_record_reading(%L, now(), 4)', (select sensor_id from t_sensor)), '%permission denied%');
select tests.throws('gérant : sensor_record_reading refusé', 'authenticated', tests.manager_uid(),
  format('select public.sensor_record_reading(%L, now(), 4)', (select sensor_id from t_sensor)), '%permission denied%');
select tests.throws('propriétaire : UPDATE d''une mesure interdit', 'postgres', null, 'update public.sensor_readings set value_c = 1', 'HACCP: UPDATE interdit%');
select tests.throws('propriétaire : DELETE d''une mesure interdit', 'postgres', null, 'delete from public.sensor_readings', 'HACCP: DELETE interdit%');
select tests.throws('propriétaire : TRUNCATE des mesures interdit', 'postgres', null, 'truncate public.sensor_readings', 'HACCP: TRUNCATE interdit%');
select tests.throws('indicateur de purge posé à la main : mesure non expirée protégée', 'postgres', null,
  'select set_config(''haccp.purge_in_progress'', ''on'', true); delete from public.sensor_readings', 'HACCP: purge refusée%');
select tests.throws('gérant : DELETE refusé', 'authenticated', tests.manager_uid(), 'delete from public.sensor_readings', '%permission denied%');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from public.sensor_readings'), '2', 'gérant lit les mesures');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from public.sensor_readings'), '0', 'non-gérant ne voit aucune mesure');
select tests.throws('anon ne lit pas les mesures', 'anon', null, 'select count(*) from public.sensor_readings', '%permission denied%');

-- Purge : mesure expirée (insérée triggers désactivés pour antidater received_at)
alter table public.sensor_readings disable trigger sensor_readings_before_insert;
insert into public.sensor_readings (sensor_id, measured_at, value_c, received_at)
values ((select sensor_id from t_sensor), now() - interval '4 years', 5, now() - interval '4 years');
alter table public.sensor_readings enable trigger sensor_readings_before_insert;
select tests.throws('purge : non exécutable par le gérant', 'authenticated', tests.manager_uid(), 'select public.purge_sensor_readings()', '%permission denied%');
select tests.assert_eq(tests.value_as('service_role', null, 'select public.purge_sensor_readings()'), '1', 'purge : une mesure expirée supprimée (service_role)');
select public.purge_sensor_readings();
select tests.assert_eq((select count(*)::int from public.sensor_readings), 2, 'purge : mesures récentes conservées');
select tests.assert(exists (select 1 from public.audit_log where table_name = 'sensor_readings' and action = 'PURGE' and (new ->> 'deleted')::int = 1),
  'purge : résumé PURGE dans audit_log');

-- ---------------------------------------------------------------------------
-- Alertes
-- ---------------------------------------------------------------------------
create temp table t_alert (id uuid);
grant all on t_alert to public;
select tests.exec_as('service_role', null, format(
  'with x as (insert into public.alerts (kind, sensor_id, equipment_id, message) values (''sensor_silent'', %L, ''00000000-0000-4000-8000-000000000101'', ''Sonde muette'') returning id) insert into t_alert select id from x',
  (select sensor_id from t_sensor)));
select tests.assert((select opened_at > now() - interval '1 minute' and resolved_at is null and acknowledged_at is null and last_notified_at is null from public.alerts),
  'service_role ouvre une alerte (opened_at serveur)');
select tests.throws('une seule alerte ouverte par sujet', 'service_role', null, format(
  'insert into public.alerts (kind, sensor_id, equipment_id, message) values (''sensor_silent'', %L, ''00000000-0000-4000-8000-000000000101'', ''Encore'')',
  (select sensor_id from t_sensor)), '%alerts_one_open_idx%');
select tests.throws('sujet exigé : check_overdue sans équipement', 'service_role', null,
  'insert into public.alerts (kind, message) values (''check_overdue'', ''X'')', '%alerts_subject_check%');
select tests.throws('sujet exigé : corrective_action_missing sans enregistrement', 'service_role', null,
  'insert into public.alerts (kind, equipment_id, message) values (''corrective_action_missing'', ''00000000-0000-4000-8000-000000000101'', ''X'')', '%alerts_subject_check%');
select tests.throws('nature inconnue refusée', 'service_role', null,
  'insert into public.alerts (kind, equipment_id, message) values (''fire'', ''00000000-0000-4000-8000-000000000101'', ''X'')', '%alerts_kind_check%');
select tests.throws('message vide refusé', 'service_role', null,
  'insert into public.alerts (kind, equipment_id, message) values (''check_overdue'', ''00000000-0000-4000-8000-000000000101'', '' '')', '%alerts_message_check%');
select tests.throws('service_role : création déjà résolue refusée (colonne)', 'service_role', null,
  'insert into public.alerts (kind, equipment_id, message, resolved_at) values (''check_overdue'', ''00000000-0000-4000-8000-000000000101'', ''X'', now())', '%permission denied%');
select tests.throws('propriétaire : création déjà résolue refusée (trigger)', 'postgres', null,
  'insert into public.alerts (kind, equipment_id, message, resolved_at) values (''check_overdue'', ''00000000-0000-4000-8000-000000000101'', ''X'', now())', 'HACCP: alert_insert%');
select tests.throws('service_role : message non modifiable', 'service_role', null, 'update public.alerts set message = ''Autre''', '%permission denied%');
select tests.throws('service_role : prise en compte directe refusée', 'service_role', null, 'update public.alerts set acknowledged_at = now()', '%permission denied%');
select tests.throws('propriétaire : message non modifiable (trigger)', 'postgres', null, 'update public.alerts set message = ''Autre''', 'HACCP: alert_immutable%');
select tests.throws('propriétaire : kind non modifiable (trigger)', 'postgres', null, 'update public.alerts set kind = ''sensor_battery_low''', 'HACCP: alert_immutable%');
select tests.throws('propriétaire : opened_at non modifiable (trigger)', 'postgres', null, 'update public.alerts set opened_at = now() - interval ''1 day''', 'HACCP: alert_immutable%');
select tests.throws('service_role : DELETE refusé', 'service_role', null, 'delete from public.alerts', '%permission denied%');
select tests.throws('propriétaire : DELETE interdit', 'postgres', null, 'delete from public.alerts', 'HACCP: DELETE interdit%');
select tests.throws('propriétaire : TRUNCATE interdit', 'postgres', null, 'truncate public.alerts', 'HACCP: TRUNCATE interdit%');

select tests.exec_as('service_role', null, 'update public.alerts set last_notified_at = ''2000-01-01''');
select tests.assert((select last_notified_at > '2001-01-01' from public.alerts), 'last_notified_at imposé par le serveur');
select tests.throws('last_notified_at ne peut pas être effacé', 'postgres', null, 'update public.alerts set last_notified_at = null', 'HACCP: alert_immutable%');

-- Prise en compte par un record alert_ack (trigger à l'insertion dans le registre)
create temp table t_ack as select tests.add_record(tests.device1(), 'alert_ack', null, jsonb_build_object('alert_id', (select id from t_alert))) as id;
select tests.assert((select a.acknowledged_at > now() - interval '1 minute' and a.acknowledged_by_record_id = (select id from t_ack) from public.alerts a),
  'alert_ack : alerte prise en compte (acknowledged_at, enregistrement lié)');
select tests.add_record(tests.device1(), 'alert_ack', null, jsonb_build_object('alert_id', (select id from t_alert), 'comment', 'encore'));
select tests.assert((select a.acknowledged_by_record_id = (select id from t_ack) from public.alerts a), 'second alert_ack : première prise en compte conservée');
select tests.throws('propriétaire : prise en compte définitive', 'postgres', null, 'update public.alerts set acknowledged_at = null', 'HACCP: alert_immutable%');

-- Résolution, puis nouvelle alerte possible sur le même sujet
select tests.exec_as('service_role', null, 'update public.alerts set resolved_at = ''2000-01-01''');
select tests.assert((select resolved_at > '2001-01-01' from public.alerts), 'resolved_at imposé par le serveur');
select tests.throws('une alerte résolue le reste', 'postgres', null, 'update public.alerts set resolved_at = null', 'HACCP: alert_immutable%');
select tests.exec_as('service_role', null, format(
  'insert into public.alerts (kind, sensor_id, equipment_id, message) values (''sensor_silent'', %L, ''00000000-0000-4000-8000-000000000101'', ''Sonde muette'')',
  (select sensor_id from t_sensor)));
select tests.assert_eq((select count(*)::int from public.alerts where resolved_at is null), 1, 'après résolution : nouvelle alerte ouverte sur le même sujet');

-- alert_ack en quarantaine : aucun effet
create temp table t_alert2 as select id from public.alerts where resolved_at is null;
insert into public.records (id, type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash, quarantine_reason)
select gen_random_uuid(), 'alert_ack', jsonb_build_object('alert_id', (select id from t_alert2)), tests.staff1(), tests.device1(),
       h.device_seq + 1, now(), h.hash, tests.hex('quarantaine-ack'), 'invalid_payload'
  from public.device_chain_head(tests.device1()) h;
select tests.assert((select acknowledged_at is null from public.alerts where id = (select id from t_alert2)), 'alert_ack en quarantaine : aucune prise en compte');

select tests.assert((select relrowsecurity from pg_class where oid = 'public.alerts'::regclass), 'alerts : RLS activé');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from public.alerts'), '2', 'gérant lit les alertes');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from public.alerts'), '0', 'non-gérant ne voit aucune alerte');
select tests.throws('anon ne lit pas les alertes', 'anon', null, 'select count(*) from public.alerts', '%permission denied%');
select tests.throws('gérant n''écrit pas les alertes', 'authenticated', tests.manager_uid(), 'update public.alerts set last_notified_at = now()', '%permission denied%');

-- ---------------------------------------------------------------------------
-- Abonnements Web Push
-- ---------------------------------------------------------------------------
create function pg_temp.sub_sql(p_endpoint text, p_p256dh text default repeat('A', 87), p_auth text default repeat('B', 22)) returns text
language sql as $$ select format('insert into public.push_subscriptions (device_id, endpoint, p256dh, auth) values (%L, %L, %L, %L)', tests.device1(), p_endpoint, p_p256dh, p_auth) $$;
select tests.exec_as('service_role', null, pg_temp.sub_sql('https://web.push.apple.com/abc'));
select tests.assert_eq((select failures from public.push_subscriptions), 0, 'service_role enregistre un abonnement');
select tests.throws('endpoint unique', 'service_role', null, pg_temp.sub_sql('https://web.push.apple.com/abc'), '%duplicate key%');
select tests.throws('endpoint http refusé', 'service_role', null, pg_temp.sub_sql('http://web.push.apple.com/x'), '%push_subscriptions_endpoint_check%');
select tests.throws('clé p256dh mal formée refusée', 'service_role', null, pg_temp.sub_sql('https://web.push.apple.com/y', 'abc'), '%push_subscriptions_p256dh_check%');
select tests.throws('secret auth mal formé refusé', 'service_role', null, pg_temp.sub_sql('https://web.push.apple.com/y', repeat('A', 87), 'a+b/'), '%push_subscriptions_auth_check%');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(failures) from public.push_subscriptions'), '1', 'gérant voit l''état des abonnements');
select tests.throws('gérant : clés illisibles', 'authenticated', tests.manager_uid(), 'select p256dh from public.push_subscriptions', '%permission denied%');
select tests.throws('gérant : endpoint illisible', 'authenticated', tests.manager_uid(), 'select endpoint from public.push_subscriptions', '%permission denied%');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(id) from public.push_subscriptions'), '0', 'non-gérant ne voit aucun abonnement');
select tests.throws('anon : aucun accès aux abonnements', 'anon', null, 'select count(*) from public.push_subscriptions', '%permission denied%');
select tests.assert_eq(tests.value_as('service_role', null,
  'with d as (delete from public.push_subscriptions returning 1) select count(*) from d'), '1', 'service_role supprime un abonnement (désabonnement, 404/410)');
