-- Lot 7 : documents (table, bucket privé `documents`, échéances), vue staff_public,
-- lecture de l'export « contrôle sanitaire » par le gérant, journal VERIFY_INTEGRITY.

-- ---------------------------------------------------------------------------
-- Table documents : RLS et privilèges
-- ---------------------------------------------------------------------------
select tests.assert((select relrowsecurity from pg_class where oid = 'public.documents'::regclass), 'documents : RLS activé');
select tests.throws('anon ne lit pas documents', 'anon', null, 'select count(*) from public.documents', '%permission denied%');
select tests.throws('anon n''écrit pas documents', 'anon', null,
  'insert into public.documents (title, category, file_path, mime_type, size_bytes) values (''X'', ''pms'', ''00000000-0000-4000-8000-000000000701.pdf'', ''application/pdf'', 10)',
  '%permission denied%');
select tests.throws('service_role ne lit pas documents (pas dans sync-pull)', 'service_role', null, 'select count(*) from public.documents', '%permission denied%');
select tests.throws('non-gérant n''ajoute pas de document', 'authenticated', tests.user_uid(),
  'insert into public.documents (title, category, file_path, mime_type, size_bytes) values (''X'', ''pms'', ''00000000-0000-4000-8000-000000000701.pdf'', ''application/pdf'', 10)',
  '%row-level security%');

select tests.exec_as('authenticated', tests.manager_uid(), $q$
  insert into public.documents (id, title, category, file_path, mime_type, size_bytes, issued_on, valid_until, notes) values
    ('00000000-0000-4000-8000-000000000701', 'PMS v1', 'pms', '00000000-0000-4000-8000-000000000701.pdf', 'application/pdf', 123456, '2026-01-10', null, null),
    ('00000000-0000-4000-8000-000000000702', 'Formation hygiène Alice', 'training', '00000000-0000-4000-8000-000000000702.jpg', 'image/jpeg', 2000000, '2024-01-01', (current_date + 10), 'Attestation'),
    ('00000000-0000-4000-8000-000000000703', 'Contrat dératisation', 'pest_control', '00000000-0000-4000-8000-000000000703.png', 'image/png', 10000000, null, (current_date - 3), ''),
    ('00000000-0000-4000-8000-000000000704', 'Analyse labo', 'lab_analysis', '00000000-0000-4000-8000-000000000704.webp', 'image/webp', 1, null, (current_date + 400), null)
$q$);
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from public.documents'), '4', 'gérant ajoute et lit les documents (4 formats)');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from public.documents'), '0', 'non-gérant ne voit aucun document');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(),
  'with u as (update public.documents set title = ''pirate'' returning 1) select count(*) from u'), '0', 'non-gérant ne modifie aucun document');

-- ---------------------------------------------------------------------------
-- Contraintes (formats, mime ↔ extension, taille ≤ DOCUMENT_MAX_BYTES)
-- ---------------------------------------------------------------------------
create function tests.doc_insert(p_title text, p_category text, p_path text, p_mime text, p_size int,
                                 p_issued date default null, p_valid date default null, p_notes text default null)
returns text language sql as $$
  select format('insert into public.documents (title, category, file_path, mime_type, size_bytes, issued_on, valid_until, notes) values (%L, %L, %L, %L, %s, %L, %L, %L)',
                p_title, p_category, p_path, p_mime, p_size, p_issued, p_valid, p_notes)
$$;

select tests.throws('titre vide refusé', 'authenticated', tests.manager_uid(),
  tests.doc_insert('   ', 'pms', '00000000-0000-4000-8000-000000000799.pdf', 'application/pdf', 10), '%documents_title_check%');
select tests.throws('titre de 121 caractères refusé', 'authenticated', tests.manager_uid(),
  tests.doc_insert(repeat('a', 121), 'pms', '00000000-0000-4000-8000-000000000799.pdf', 'application/pdf', 10), '%documents_title_check%');
select tests.throws('catégorie inconnue refusée', 'authenticated', tests.manager_uid(),
  tests.doc_insert('X', 'medical', '00000000-0000-4000-8000-000000000799.pdf', 'application/pdf', 10), '%documents_category_check%');
select tests.throws('chemin dans un dossier refusé', 'authenticated', tests.manager_uid(),
  tests.doc_insert('X', 'pms', 'a/00000000-0000-4000-8000-000000000799.pdf', 'application/pdf', 10), '%documents_file_path_check%');
select tests.throws('extension .jpeg refusée (contrat : .jpg)', 'authenticated', tests.manager_uid(),
  tests.doc_insert('X', 'pms', '00000000-0000-4000-8000-000000000799.jpeg', 'image/jpeg', 10), '%documents_file_path_check%');
select tests.throws('majuscules refusées dans le chemin', 'authenticated', tests.manager_uid(),
  tests.doc_insert('X', 'pms', '00000000-0000-4000-8000-00000000079A.pdf', 'application/pdf', 10), '%documents_file_path_check%');
select tests.throws('mime pdf sur un .png refusé', 'authenticated', tests.manager_uid(),
  tests.doc_insert('X', 'pms', '00000000-0000-4000-8000-000000000799.png', 'application/pdf', 10), '%documents_mime_check%');
select tests.throws('mime inconnu refusé', 'authenticated', tests.manager_uid(),
  tests.doc_insert('X', 'pms', '00000000-0000-4000-8000-000000000799.pdf', 'text/html', 10), '%documents_mime_check%');
select tests.throws('taille > 10 000 000 refusée', 'authenticated', tests.manager_uid(),
  tests.doc_insert('X', 'pms', '00000000-0000-4000-8000-000000000799.pdf', 'application/pdf', 10000001), '%documents_size_check%');
select tests.throws('taille 0 refusée', 'authenticated', tests.manager_uid(),
  tests.doc_insert('X', 'pms', '00000000-0000-4000-8000-000000000799.pdf', 'application/pdf', 0), '%documents_size_check%');
select tests.throws('validité antérieure à l''émission refusée', 'authenticated', tests.manager_uid(),
  tests.doc_insert('X', 'pms', '00000000-0000-4000-8000-000000000799.pdf', 'application/pdf', 10, '2026-02-01', '2026-01-01'), '%documents_dates_check%');
select tests.throws('notes > 500 caractères refusées', 'authenticated', tests.manager_uid(),
  tests.doc_insert('X', 'pms', '00000000-0000-4000-8000-000000000799.pdf', 'application/pdf', 10, null, null, repeat('n', 501)), '%documents_notes_check%');
select tests.throws('même fichier pour deux fiches refusé', 'authenticated', tests.manager_uid(),
  tests.doc_insert('X', 'pms', '00000000-0000-4000-8000-000000000701.pdf', 'application/pdf', 10), '%duplicate key%');

-- ---------------------------------------------------------------------------
-- Mises à jour : métadonnées oui, fichier jamais ; updated_at forcé ; audit
-- ---------------------------------------------------------------------------
update public.documents set updated_at = '2000-01-01' where id = '00000000-0000-4000-8000-000000000701';
select tests.assert((select updated_at > now() - interval '1 minute' from public.documents where id = '00000000-0000-4000-8000-000000000701'),
  'updated_at forcé par trigger');
select tests.exec_as('authenticated', tests.manager_uid(),
  'update public.documents set title = ''PMS v1 (remplacé)'', active = false, valid_until = ''2026-12-31'' where id = ''00000000-0000-4000-8000-000000000701''');
select tests.assert_eq((select title || '|' || active from public.documents where id = '00000000-0000-4000-8000-000000000701'),
  'PMS v1 (remplacé)|false', 'gérant modifie les métadonnées et désactive');
select tests.throws('fichier d''une fiche non modifiable (file_path)', 'authenticated', tests.manager_uid(),
  'update public.documents set file_path = ''00000000-0000-4000-8000-000000000799.pdf'' where id = ''00000000-0000-4000-8000-000000000701''',
  'HACCP: document_file_immutable%');
select tests.throws('fichier d''une fiche non modifiable (size_bytes)', 'authenticated', tests.manager_uid(),
  'update public.documents set size_bytes = 99 where id = ''00000000-0000-4000-8000-000000000701''', 'HACCP: document_file_immutable%');
select tests.throws('fichier d''une fiche non modifiable, même pour le propriétaire', 'postgres', null,
  'update public.documents set mime_type = ''image/png'', file_path = ''00000000-0000-4000-8000-000000000701.png'' where id = ''00000000-0000-4000-8000-000000000701''',
  'HACCP: document_file_immutable%');
select tests.assert(exists (select 1 from public.audit_log where table_name = 'documents' and action = 'INSERT' and row_id = '00000000-0000-4000-8000-000000000702'),
  'audit : ajout d''un document journalisé');
select tests.assert(exists (select 1 from public.audit_log where table_name = 'documents' and action = 'UPDATE'
                              and row_id = '00000000-0000-4000-8000-000000000701' and actor = tests.manager_uid()::text),
  'audit : modification par le gérant journalisée (acteur = gérant)');
select tests.throws('gérant : pas de DELETE', 'authenticated', tests.manager_uid(),
  'delete from public.documents', '%permission denied%');
select tests.throws('propriétaire : DELETE bloqué', 'postgres', null,
  'delete from public.documents where id = ''00000000-0000-4000-8000-000000000704''', 'HACCP: suppression interdite%');
select tests.throws('propriétaire : TRUNCATE bloqué', 'postgres', null, 'truncate public.documents', 'HACCP: suppression interdite%');

-- ---------------------------------------------------------------------------
-- documents_expiring(p_days)
-- ---------------------------------------------------------------------------
select tests.assert_eq(
  tests.value_as('authenticated', tests.manager_uid(),
    'select string_agg(title || '':'' || days_left, '','' order by valid_until) from public.documents_expiring(30)'),
  'Contrat dératisation:-3,Formation hygiène Alice:10',
  'documents_expiring(30) : échus et proches, inactifs et sans date exclus, days_left');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from public.documents_expiring(0)'), '1',
  'documents_expiring(0) : seulement les échus (et le jour même)');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from public.documents_expiring(500)'), '3',
  'documents_expiring(500) : document à 400 jours inclus');
select tests.throws('documents_expiring : non-gérant refusé', 'authenticated', tests.user_uid(), 'select * from public.documents_expiring(30)', 'HACCP: forbidden%');
select tests.throws('documents_expiring : anon refusé', 'anon', null, 'select * from public.documents_expiring(30)', '%permission denied%');
select tests.throws('documents_expiring : service_role refusé', 'service_role', null, 'select * from public.documents_expiring(30)', '%permission denied%');
select tests.throws('documents_expiring : p_days négatif refusé', 'authenticated', tests.manager_uid(), 'select * from public.documents_expiring(-1)', 'HACCP: invalid_days%');
select tests.throws('documents_expiring : p_days null refusé', 'authenticated', tests.manager_uid(), 'select * from public.documents_expiring(null)', 'HACCP: invalid_days%');

-- ---------------------------------------------------------------------------
-- Bucket documents
-- ---------------------------------------------------------------------------
select tests.assert((select public = false and file_size_limit = 10000000
                            and allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
                       from storage.buckets where id = 'documents'), 'bucket documents : privé, 10 Mo, PDF/JPEG/PNG/WebP');
select tests.assert((select public = false and file_size_limit = 1000000 and allowed_mime_types = array['image/webp']
                       from storage.buckets where id = 'photos'), 'bucket photos inchangé');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from storage.buckets where id = ''documents'''), '1', 'gérant voit le bucket documents');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from storage.buckets where id = ''documents'''), '0', 'non-gérant ne voit pas le bucket documents');

insert into storage.buckets (id, name, public) values ('autre', 'autre', true);
insert into storage.objects (bucket_id, name) values ('autre', 'logo.png');
insert into storage.objects (bucket_id, name, created_at) values
  ('photos', '000000d1-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000f1.webp', now());

-- Dépôt par le gérant (comme supabase-js .upload(path, file, { upsert: false })).
select tests.exec_as('authenticated', tests.manager_uid(),
  'insert into storage.objects (bucket_id, name, owner) values (''documents'', ''00000000-0000-4000-8000-000000000701.pdf'', auth.uid())');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from storage.objects where bucket_id = ''documents'''), '1',
  'gérant dépose puis lit un document');
select tests.throws('gérant : nom hors format refusé', 'authenticated', tests.manager_uid(),
  'insert into storage.objects (bucket_id, name) values (''documents'', ''pms.pdf'')', '%row-level security%');
select tests.throws('gérant : pas de sous-dossier', 'authenticated', tests.manager_uid(),
  'insert into storage.objects (bucket_id, name) values (''documents'', ''x/00000000-0000-4000-8000-000000000702.jpg'')', '%row-level security%');
select tests.throws('non-gérant ne dépose pas de document', 'authenticated', tests.user_uid(),
  'insert into storage.objects (bucket_id, name) values (''documents'', ''00000000-0000-4000-8000-000000000702.jpg'')', '%row-level security%');
select tests.throws('anon ne dépose pas de document', 'anon', null,
  'insert into storage.objects (bucket_id, name) values (''documents'', ''00000000-0000-4000-8000-000000000702.jpg'')', '%row-level security%');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from storage.objects where bucket_id = ''documents'''), '0', 'non-gérant ne lit aucun document');
select tests.assert_eq(tests.value_as('anon', null, 'select count(*) from storage.objects where bucket_id = ''documents'''), '0', 'anon ne lit aucun document');
select tests.throws('gérant : toujours pas d''envoi direct dans photos', 'authenticated', tests.manager_uid(),
  'insert into storage.objects (bucket_id, name) values (''photos'', ''x/y.webp'')', '%row-level security%');

-- Jamais de modification / suppression, même si une politique large est ajoutée plus tard.
create policy test_tout_permis on storage.objects for all to anon, authenticated using (true) with check (true);
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update storage.objects set metadata = ''{"size": 1}'' where bucket_id = ''documents'' returning 1) select count(*) from u'), '0',
  'gérant ne modifie aucun document (upsert / métadonnées)');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update storage.objects set bucket_id = ''autre'' where bucket_id = ''documents'' returning 1) select count(*) from u'), '0',
  'gérant ne déplace aucun document hors du bucket');
select tests.throws('gérant ne déplace pas un objet vers le bucket documents', 'authenticated', tests.manager_uid(),
  'update storage.objects set bucket_id = ''documents'', name = ''00000000-0000-4000-8000-000000000703.png'' where bucket_id = ''autre''', '%row-level security%');
select tests.throws('politique large : non-gérant ne dépose toujours pas', 'authenticated', tests.user_uid(),
  'insert into storage.objects (bucket_id, name) values (''documents'', ''00000000-0000-4000-8000-000000000702.jpg'')', '%row-level security%');
select tests.throws('politique large : anon ne dépose toujours pas', 'anon', null,
  'insert into storage.objects (bucket_id, name) values (''documents'', ''00000000-0000-4000-8000-000000000702.jpg'')', '%row-level security%');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from storage.objects where bucket_id = ''documents'''), '0',
  'politique large : non-gérant ne lit toujours aucun document');
select tests.assert_eq(tests.value_as('anon', null, 'select count(*) from storage.objects where bucket_id = ''documents'''), '0',
  'politique large : anon ne lit toujours aucun document');
select set_config('storage.allow_delete_query', 'true', false);
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with d as (delete from storage.objects where bucket_id = ''documents'' returning 1) select count(*) from d'), '0', 'gérant ne supprime aucun document');
select tests.assert_eq(tests.value_as('anon', null,
  'with d as (delete from storage.objects where bucket_id = ''documents'' returning 1) select count(*) from d'), '0', 'anon ne supprime aucun document');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with d as (delete from storage.objects where bucket_id = ''photos'' returning 1) select count(*) from d'), '0', 'photos : toujours protégées (lot 3)');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with d as (delete from storage.objects where bucket_id = ''autre'' returning 1) select count(*) from d'), '1', '(contrôle : la suppression marche hors buckets protégés)');
select set_config('storage.allow_delete_query', 'false', false);
drop policy test_tout_permis on storage.objects;

-- La purge des photos ne désigne jamais un document, même très ancien et non référencé.
insert into storage.objects (bucket_id, name, created_at) values
  ('documents', '00000000-0000-4000-8000-000000000702.jpg', now() - interval '20 years'),
  ('documents', '000000d1-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000f9.webp', now() - interval '20 years');
insert into storage.objects (bucket_id, name, created_at) values
  ('photos', '000000d1-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000f8.webp', now() - interval '20 years');
select tests.assert_eq(tests.value_as('service_role', null, 'select string_agg(name, '','') from public.photos_to_purge(1000)'),
  '000000d1-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000f8.webp',
  'photos_to_purge : jamais d''objet du bucket documents');

-- ---------------------------------------------------------------------------
-- Vue staff_public (export) : sans pin_hash / pin_salt
-- ---------------------------------------------------------------------------
select tests.assert_eq((select string_agg(attname::text, ',' order by attnum) from pg_attribute
                         where attrelid = 'public.staff_public'::regclass and attnum > 0 and not attisdropped),
  'id,display_name,role,active,created_at,updated_at', 'staff_public : colonnes sans secret');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(), 'select string_agg(display_name, '','') from public.staff_public where id = ''0000005a-0000-4000-8000-000000000001''' ),
  'Alice', 'staff_public : lisible par le gérant');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from public.staff_public'), '0', 'staff_public : vide pour un non-gérant (RLS de staff)');
select tests.throws('staff_public : anon refusé', 'anon', null, 'select count(*) from public.staff_public', '%permission denied%');
select tests.throws('staff_public : lecture seule', 'authenticated', tests.manager_uid(),
  'update public.staff_public set display_name = ''X''', '%permission denied%');

-- ---------------------------------------------------------------------------
-- Export « contrôle sanitaire » : tout ce que l'app gérant lit via REST (RLS)
-- ---------------------------------------------------------------------------
insert into public.records (type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash, quarantine_reason)
select 'mystere', '{"x":1}', tests.staff1(), tests.device1(), h.device_seq + 1, now(), h.hash, tests.hex('q-lot7'), 'unknown_type'
  from public.device_chain_head(tests.device1()) h;
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'select count(*) || ''|'' || count(quarantine_reason) || ''|'' || count(server_time) from (select id, type, payload, author_id, device_id, device_seq, device_time, device_now, prev_hash, hash, supersedes_id, server_time, clock_suspect, quarantine_reason from public.records) r'),
  '3|1|3', 'export : gérant lit records (quarantaine et server_time compris)');

do $$
declare
  q text;
begin
  foreach q in array array[
    'select id, name, timezone from public.establishment',
    'select id, display_name, role, active from public.staff_public',
    'select id, name, enrolled_at, revoked_at, last_seen_at from public.devices',
    'select id, name, kind, active, updated_at from public.equipment',
    'select id, equipment_id, check_type, min_c, max_c, tolerance_minutes, updated_at from public.thresholds',
    'select id, retention_years, clock_suspect_minutes from public.settings',
    'select id, name, phone, email, active, updated_at from public.suppliers',
    'select id, name, allergens, storage, shelf_life_opened_hours, shelf_life_thawed_hours, active, updated_at from public.products',
    'select id, name, ingredient_product_ids, extra_allergens, storage, shelf_life_hours, active, updated_at from public.recipes',
    'select id, name, frequency, product, method, active, updated_at from public.cleaning_tasks',
    'select id, name, kind, items, active, updated_at from public.checklists',
    'select id, kind, equipment_id, sensor_id, related_record_id, message, opened_at, resolved_at, acknowledged_at, acknowledged_by_record_id from public.alerts',
    'select id, name, equipment_id, vendor, active, last_seen_at, last_value_c, battery_percent from public.sensors',
    'select device_id, device_seq, hash, purged_at from public.record_chain_anchors',
    'select id, at, actor, table_name, action from public.audit_log',
    'select id, title, category, file_path, mime_type, size_bytes, issued_on, valid_until, notes, active, updated_at from public.documents'
  ] loop
    perform tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from (' || q || ') x');
    perform tests.assert_eq(tests.value_as('authenticated', tests.user_uid(), 'select count(*) from (' || q || ') x'), '0',
                            'export, non-gérant : rien — ' || split_part(q, ' from ', 2));
  end loop;
end $$;
select tests.assert(true, 'export : le gérant lit toutes les références utiles (16 requêtes sans erreur)');
select tests.assert(tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from public.equipment')::int > 0
                    and tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from public.thresholds')::int > 0
                    and tests.value_as('authenticated', tests.manager_uid(), 'select count(*) from public.checklists')::int > 0,
  'export : équipements, seuils et checklists visibles par le gérant');

-- ---------------------------------------------------------------------------
-- record_integrity_check() : journal VERIFY_INTEGRITY (service_role seulement)
-- ---------------------------------------------------------------------------
select tests.throws('record_integrity_check : gérant refusé (passe par verify-integrity)', 'authenticated', tests.manager_uid(),
  'select public.record_integrity_check(auth.uid(), ''{}'')', '%permission denied%');
select tests.throws('record_integrity_check : anon refusé', 'anon', null,
  'select public.record_integrity_check(null, ''{}'')', '%permission denied%');
select tests.throws('record_integrity_check : résumé non objet refusé', 'service_role', null,
  format('select public.record_integrity_check(%L, ''[1]'')', tests.manager_uid()), 'HACCP: invalid_request%');
select tests.exec_as('service_role', null,
  format('select public.record_integrity_check(%L, ''{"ok": true, "total_records": 3, "devices": 2, "problems": 0, "anchors_used": 0}'')', tests.manager_uid()));
select tests.assert((select actor = tests.manager_uid()::text and table_name = 'records' and (new ->> 'ok')::boolean and (new ->> 'total_records')::int = 3
                       from public.audit_log where action = 'VERIFY_INTEGRITY'), 'record_integrity_check : résumé VERIFY_INTEGRITY dans audit_log (acteur = gérant)');
