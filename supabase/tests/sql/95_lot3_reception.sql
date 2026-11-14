-- Lot 3 : fournisseurs (RLS, audit, pas de suppression), bucket privé `photos`
-- (politiques storage.objects) et désignation des photos à purger.

-- ---------------------------------------------------------------------------
-- Fournisseurs
-- ---------------------------------------------------------------------------
insert into public.suppliers (id, name, phone) values ('5b000000-0000-4000-8000-000000000001', 'Boucherie Martin', '01 02 03 04 05');

select tests.assert((select relrowsecurity from pg_class where oid = 'public.suppliers'::regclass), 'suppliers : RLS activé');
select tests.throws('anon ne lit pas suppliers', 'anon', null, 'select count(*) from public.suppliers', '%permission denied%');
select tests.throws('anon n''écrit pas suppliers', 'anon', null, 'insert into public.suppliers (name) values (''X'')', '%permission denied%');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from public.suppliers'), '0', 'non-gérant ne voit aucun fournisseur');
select tests.assert_eq(tests.value_as('authenticated', null, 'select count(*) from public.suppliers'), '0', 'authentifié sans sub ne voit aucun fournisseur');
select tests.throws('non-gérant n''ajoute pas de fournisseur', 'authenticated', tests.user_uid(),
  'insert into public.suppliers (name) values (''Intrus'')', '%row-level security%');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(),
  'with u as (update public.suppliers set name = ''Pirate'' returning 1) select count(*) from u'), '0', 'non-gérant ne modifie aucun fournisseur');

select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from public.suppliers'), '1', 'gérant lit les fournisseurs');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.suppliers (name, email) values (''Primeur Durand'', ''contact@primeur.example'') returning 1) select count(*) from u'), '1',
  'gérant ajoute un fournisseur (REST : insert)');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.suppliers set active = false where name = ''Boucherie Martin'' returning 1) select count(*) from u'), '1',
  'gérant désactive un fournisseur');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (insert into public.suppliers (id, name) values (''5b000000-0000-4000-8000-000000000001'', ''Boucherie M.'') on conflict (id) do update set name = excluded.name returning 1) select count(*) from u'), '1',
  'gérant : upsert d''un fournisseur');
select tests.throws('gérant ne supprime pas (aucun privilège DELETE)', 'authenticated', tests.manager_uid(),
  'delete from public.suppliers', '%permission denied%');
select tests.throws('propriétaire : suppression bloquée par trigger', 'postgres', null,
  'delete from public.suppliers', 'HACCP: suppression interdite, fournisseur%');
select tests.throws('propriétaire : TRUNCATE bloqué', 'postgres', null,
  'truncate public.suppliers', 'HACCP: suppression interdite%');

select tests.assert_eq(tests.value_as('service_role', null, 'select count(*) from public.suppliers'), '1', 'service_role lit les fournisseurs (sync-pull, sync-push)');
select tests.throws('service_role n''écrit pas les fournisseurs', 'service_role', null,
  'insert into public.suppliers (name) values (''X'')', '%permission denied%');

-- Contraintes
select tests.throws('nom vide refusé', 'postgres', null, 'insert into public.suppliers (name) values (''   '')', '%suppliers_name_check%');
select tests.throws('nom de 81 caractères refusé', 'postgres', null, format('insert into public.suppliers (name) values (%L)', repeat('x', 81)), '%suppliers_name_check%');
select tests.throws('e-mail invalide refusé', 'postgres', null, 'insert into public.suppliers (name, email) values (''A'', ''pas-un-email'')', '%suppliers_email_check%');
select tests.throws('téléphone vide refusé', 'postgres', null, 'insert into public.suppliers (name, phone) values (''A'', '''')', '%suppliers_phone_check%');
insert into public.suppliers (name) values (repeat('é', 80));
select tests.assert(true, 'nom de 80 caractères accepté');

-- updated_at imposé, audit
insert into public.suppliers (id, name, updated_at) values ('5b000000-0000-4000-8000-000000000002', 'Daté', '2000-01-01');
select tests.assert((select updated_at > '2001-01-01' from public.suppliers where id = '5b000000-0000-4000-8000-000000000002'), 'updated_at imposé par le serveur');
select tests.assert(exists (select 1 from public.audit_log where table_name = 'suppliers' and action = 'INSERT'
                             and row_id = '5b000000-0000-4000-8000-000000000002'), 'audit : insertion d''un fournisseur journalisée');
select tests.exec_as('authenticated', tests.manager_uid(), 'update public.suppliers set phone = ''0600000000'' where id = ''5b000000-0000-4000-8000-000000000002''');
select tests.assert(exists (select 1 from public.audit_log where table_name = 'suppliers' and action = 'UPDATE'
                             and row_id = '5b000000-0000-4000-8000-000000000002' and actor = tests.manager_uid()::text),
  'audit : modification par le gérant journalisée (acteur = gérant)');

-- ---------------------------------------------------------------------------
-- Bucket photos
-- ---------------------------------------------------------------------------
select tests.assert((select public = false and file_size_limit = 1000000 and allowed_mime_types = array['image/webp']
                       from storage.buckets where id = 'photos'), 'bucket photos : privé, 1 Mo max, image/webp');

insert into storage.buckets (id, name, public) values ('autre', 'autre', true);
insert into storage.objects (bucket_id, name, created_at) values
  ('photos', '000000d1-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000f1.webp', now()),
  ('autre',  'logo.png', now());

select tests.assert_eq(tests.value_as('anon', null, 'select count(*) from storage.objects where bucket_id = ''photos'''), '0', 'anon ne voit aucune photo');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from storage.objects where bucket_id = ''photos'''), '0', 'non-gérant ne voit aucune photo');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from storage.objects where bucket_id = ''photos'''), '1', 'gérant lit les photos');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from storage.buckets where id = ''photos'''), '1', 'gérant voit le bucket photos');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from storage.buckets where id = ''photos'''), '0', 'non-gérant ne voit pas le bucket photos');

-- Écritures : refusées même si une politique permissive large est ajoutée plus tard.
create policy test_tout_permis on storage.objects for all to anon, authenticated using (true) with check (true);
select tests.assert_eq(tests.value_as('anon', null, 'select count(*) from storage.objects where bucket_id = ''photos'''), '0',
  'politique large ajoutée : anon ne voit toujours aucune photo');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from storage.objects where bucket_id = ''photos'''), '0',
  'politique large ajoutée : non-gérant ne voit toujours aucune photo');
select tests.assert_eq(tests.value_as('anon', null, 'select count(*) from storage.objects where bucket_id = ''autre'''), '1',
  'les autres buckets ne sont pas concernés par les restrictions');
select tests.throws('anon n''envoie pas de photo', 'anon', null,
  'insert into storage.objects (bucket_id, name) values (''photos'', ''x/y.webp'')', '%row-level security%');
select tests.throws('gérant n''envoie pas de photo directement', 'authenticated', tests.manager_uid(),
  'insert into storage.objects (bucket_id, name) values (''photos'', ''x/y.webp'')', '%row-level security%');
select tests.throws('non-gérant n''envoie pas de photo', 'authenticated', tests.user_uid(),
  'insert into storage.objects (bucket_id, name) values (''photos'', ''x/y.webp'')', '%row-level security%');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update storage.objects set name = ''remplacee.webp'' where bucket_id = ''photos'' returning 1) select count(*) from u'), '0',
  'gérant ne modifie aucune photo');
select tests.throws('gérant ne déplace pas une photo vers le bucket photos', 'authenticated', tests.manager_uid(),
  'update storage.objects set bucket_id = ''photos'' where bucket_id = ''autre''', '%row-level security%');
-- Contourne le trigger « Use the Storage API » du stub pour tester la seule politique.
select set_config('storage.allow_delete_query', 'true', false);
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with d as (delete from storage.objects where bucket_id = ''photos'' returning 1) select count(*) from d'), '0', 'gérant ne supprime aucune photo');
select tests.assert_eq(tests.value_as('anon', null,
  'with d as (delete from storage.objects where bucket_id = ''photos'' returning 1) select count(*) from d'), '0', 'anon ne supprime aucune photo');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with d as (delete from storage.objects where bucket_id = ''autre'' returning 1) select count(*) from d'), '1', '(contrôle : la suppression marche hors bucket photos)');
select set_config('storage.allow_delete_query', 'false', false);
drop policy test_tout_permis on storage.objects;
select tests.assert_eq(tests.value_as('service_role', null, 'select count(*) from storage.objects where bucket_id = ''photos'''), '1',
  'service_role (photo-upload) voit les photos');

-- ---------------------------------------------------------------------------
-- Photos à purger : plus vieilles que la conservation ET non référencées
-- ---------------------------------------------------------------------------
-- Chemins (appareil 1) : p1 vieille non référencée → purgée ; p2 vieille, photo_paths d'une
-- réception → gardée ; p3 vieille, items[].photo_paths → gardée ; p4 vieille, dans le
-- remplacement d'une correction → gardée ; p5 récente non référencée → gardée ;
-- p6 vieille, photo_path d'une perte en quarantaine → gardée ; autre bucket : ignoré.
create temporary table p (k text primary key, path text);
insert into p select 'p' || i, '000000d1-0000-4000-8000-000000000001/00000000-0000-4000-8000-' || lpad(i::text, 12, '0') || '.webp'
  from generate_series(1, 6) i;
insert into storage.objects (bucket_id, name, created_at)
select 'photos', path, case when k = 'p5' then now() - interval '1 year' else now() - interval '4 years' end from p;
insert into storage.objects (bucket_id, name, created_at) values ('autre', (select path from p where k = 'p1'), now() - interval '9 years');

select tests.add_record(tests.device1(), 'reception', null,
  jsonb_build_object('supplier_id', '5b000000-0000-4000-8000-000000000001', 'photo_paths', jsonb_build_array((select path from p where k = 'p2')),
                     'items', jsonb_build_array(jsonb_build_object('product', 'Steak', 'photo_paths', jsonb_build_array((select path from p where k = 'p3'))))));
select tests.add_record(tests.device1(), 'correction', (select id from public.records where type = 'reception' limit 1),
  jsonb_build_object('reason', 'r', 'replacement', jsonb_build_object('photo_paths', jsonb_build_array((select path from p where k = 'p4')))));
insert into public.records (type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash, quarantine_reason)
select 'waste', jsonb_build_object('photo_paths', jsonb_build_array((select path from p where k = 'p6'))), tests.staff1(), tests.device1(),
       h.device_seq + 1, now(), h.hash, tests.hex('waste-q'), 'invalid_payload'
  from public.device_chain_head(tests.device1()) h;

select tests.assert_eq(
  tests.value_as('service_role', null, 'select string_agg(name, '','') from public.photos_to_purge(100)'),
  (select path from p where k = 'p1'),
  'photos_to_purge : seule la photo expirée non référencée (photo_paths, items, correction, quarantaine, récente, autre bucket exclus)');
select tests.assert_eq(tests.value_as('service_role', null, 'select count(*) from public.photos_to_purge(0)'), '1', 'photos_to_purge : limite bornée à 1 minimum');

update public.settings set retention_years = 10;
select tests.assert_eq(tests.value_as('service_role', null, 'select count(*) from public.photos_to_purge(100)'), '0', 'photos_to_purge suit settings.retention_years');
update public.settings set retention_years = 3;

select tests.throws('anon : photos_to_purge interdit', 'anon', null, 'select * from public.photos_to_purge(10)', '%permission denied%');
select tests.throws('gérant : photos_to_purge interdit', 'authenticated', tests.manager_uid(), 'select * from public.photos_to_purge(10)', '%permission denied%');
select tests.throws('gérant : record_photo_purge interdit', 'authenticated', tests.manager_uid(), 'select public.record_photo_purge(1, 0)', '%permission denied%');

select tests.exec_as('service_role', null, 'select public.record_photo_purge(3, 1)');
select tests.assert((select new = '{"deleted": 3, "failed": 1, "bucket": "photos"}'::jsonb and actor = 'system:purge-photos'
                       from public.audit_log where action = 'PURGE_PHOTOS'), 'record_photo_purge : résumé dans audit_log');

-- La suppression elle-même passe par l'API Storage (purge-photos) : un DELETE SQL est bloqué par Supabase.
select tests.throws('DELETE SQL direct dans storage.objects bloqué (API Storage obligatoire)', 'postgres', null,
  'delete from storage.objects where bucket_id = ''photos''', '%Storage API%');
