-- Audit des références (secrets masqués), updated_at, protection des suppressions.

-- Les secrets du jeu commun n'apparaissent jamais en clair dans audit_log
select tests.assert(
  position(tests.b64('pin-alice', 32) in (select string_agg(coalesce(old::text, '') || coalesce(new::text, ''), '') from public.audit_log)) = 0
  and position(tests.b64('sel-alice', 16) in (select string_agg(coalesce(old::text, '') || coalesce(new::text, ''), '') from public.audit_log)) = 0,
  'pin_hash / pin_salt jamais en clair dans audit_log');
select tests.assert(
  position(tests.hex('jeton-1') in (select string_agg(coalesce(old::text, '') || coalesce(new::text, ''), '') from public.audit_log)) = 0,
  'token_hash jamais en clair dans audit_log');
select tests.assert((select new ->> 'pin_hash' = '***' and new ->> 'pin_salt' = '***' and new ->> 'display_name' = 'Alice'
                       from public.audit_log where table_name = 'staff' and action = 'INSERT' and row_id = tests.staff1()::text),
  'insert staff journalisé, secrets masqués');
select tests.assert((select new ->> 'token_hash' = '***' from public.audit_log where table_name = 'devices' and action = 'INSERT' and row_id = tests.device1()::text),
  'insert device journalisé, token_hash masqué');
select tests.assert_eq((select actor from public.audit_log where table_name = 'staff' and action = 'INSERT' and row_id = tests.staff1()::text),
  'service', 'acteur = service hors session gérant');

-- Modification par le gérant : acteur = auth.uid(), secrets masqués mais changement signalé
select tests.exec_as('authenticated', tests.manager_uid(),
  format('update public.staff set pin_hash = %L, pin_salt = %L, display_name = ''Alice B.'' where id = %L',
    tests.b64('nouveau-pin', 32), tests.b64('nouveau-sel', 16), tests.staff1()));
select tests.assert((select actor = tests.manager_uid()::text
                        and old ->> 'pin_hash' = '***' and new ->> 'pin_hash' = '***'
                        and new -> '_secrets_changed' = '["pin_hash", "pin_salt"]'::jsonb
                        and old ->> 'display_name' = 'Alice' and new ->> 'display_name' = 'Alice B.'
                       from public.audit_log where table_name = 'staff' and action = 'UPDATE' order by id desc limit 1),
  'update staff : acteur gérant, old/new, secrets masqués, _secrets_changed');
select tests.assert(position(tests.b64('nouveau-pin', 32) in (select string_agg(coalesce(old::text, '') || coalesce(new::text, ''), '') from public.audit_log)) = 0,
  'nouveau PIN jamais en clair');

-- Synchro : last_seen_at seul n'est pas journalisé ; la révocation l'est
select count(*) as n into temporary _before from public.audit_log;
select tests.exec_as('service_role', null, format('update public.devices set last_seen_at = now() where id = %L', tests.device1()));
select tests.assert_eq((select count(*) from public.audit_log), (select n from _before), 'last_seen_at seul non journalisé');
select tests.exec_as('authenticated', tests.manager_uid(), format('update public.devices set revoked_at = now() where id = %L', tests.device2()));
select tests.assert((select actor = tests.manager_uid()::text and old ->> 'revoked_at' is null and new ->> 'revoked_at' is not null
                       and new ->> 'token_hash' = '***'
                       from public.audit_log where table_name = 'devices' and action = 'UPDATE' order by id desc limit 1),
  'révocation journalisée');

-- Autres tables journalisées
select tests.assert(exists (select 1 from public.audit_log where table_name = 'equipment' and action = 'INSERT'), 'equipment journalisé');
select tests.assert(exists (select 1 from public.audit_log where table_name = 'thresholds' and action = 'INSERT'), 'thresholds journalisé');
select tests.assert(exists (select 1 from public.audit_log where table_name = 'settings' and action = 'INSERT'), 'settings journalisé');
select tests.assert(exists (select 1 from public.audit_log where table_name = 'establishment' and action = 'INSERT'), 'establishment journalisé');
select tests.assert(exists (select 1 from public.audit_log where table_name = 'managers' and action = 'INSERT' and row_id = tests.manager_uid()::text), 'managers journalisé');

-- updated_at maintenu par le serveur (valeur client ignorée)
update public.equipment set updated_at = '2000-01-01', name = 'Frigo 1 bis' where id = '00000000-0000-4000-8000-000000000101';
select tests.assert((select updated_at > now() - interval '1 minute' from public.equipment where id = '00000000-0000-4000-8000-000000000101'),
  'updated_at forcé à now() (equipment)');
update public.thresholds set updated_at = '2000-01-01' where equipment_id = '00000000-0000-4000-8000-000000000101';
select tests.assert((select updated_at > '2001-01-01' from public.thresholds where equipment_id = '00000000-0000-4000-8000-000000000101'),
  'updated_at forcé à now() (thresholds)');
update public.settings set updated_at = '2000-01-01';
select tests.assert((select updated_at > '2001-01-01' from public.settings), 'updated_at forcé à now() (settings)');
update public.staff set updated_at = '2000-01-01' where id = tests.staff1();
select tests.assert((select updated_at > '2001-01-01' from public.staff where id = tests.staff1()), 'updated_at forcé à now() (staff)');

-- Suppression physique de références référencées : interdite même au propriétaire
select tests.throws('membre référencé non supprimable', 'postgres', null,
  format('delete from public.staff where id = %L', tests.staff1()), '%HACCP: suppression interdite%active = false%');
select tests.throws('équipement avec seuil non supprimable', 'postgres', null,
  'delete from public.equipment where id = ''00000000-0000-4000-8000-000000000103''', '%HACCP: suppression interdite%');
select tests.throws('équipement cité par le registre non supprimable', 'postgres', null,
  'delete from public.thresholds where equipment_id = ''00000000-0000-4000-8000-000000000101''; delete from public.equipment where id = ''00000000-0000-4000-8000-000000000101''',
  '%HACCP: suppression interdite%');
-- Équipement jamais utilisé : supprimable par le propriétaire (correction de saisie), et journalisé
delete from public.equipment where id = '00000000-0000-4000-8000-000000000105';
select tests.assert(exists (select 1 from public.audit_log where table_name = 'equipment' and action = 'DELETE'
                             and row_id = '00000000-0000-4000-8000-000000000105'), 'suppression d''équipement inutilisé journalisée');
-- Désactivation = mise à jour journalisée
select tests.exec_as('authenticated', tests.manager_uid(), format('update public.staff set active = false where id = %L', tests.staff1()));
select tests.assert((select (old ->> 'active')::boolean and not (new ->> 'active')::boolean
                       from public.audit_log where table_name = 'staff' and action = 'UPDATE' order by id desc limit 1),
  'désactivation d''un membre journalisée');
