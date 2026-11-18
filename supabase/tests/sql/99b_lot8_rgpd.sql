-- Lot 8 : RGPD de l'équipe (date de départ, note d'information, effacement manuel et automatique).

create function tests.staff2() returns uuid language sql immutable as $$ select '0000005a-0000-4000-8000-000000000002'::uuid $$;
create function tests.staff3() returns uuid language sql immutable as $$ select '0000005a-0000-4000-8000-000000000003'::uuid $$;
create function tests.boss()   returns uuid language sql immutable as $$ select '0000005a-0000-4000-8000-0000000000bb'::uuid $$;

insert into public.staff (id, display_name, role, pin_salt, pin_hash) values
  (tests.staff2(), 'Bruno Martin', 'staff',   tests.b64('sel-bruno', 16), tests.b64('pin-bruno', 32)),
  (tests.staff3(), 'Chloé Durand', 'staff',   tests.b64('sel-chloe', 16), tests.b64('pin-chloe', 32)),
  (tests.boss(),   'Le Patron',    'manager', tests.b64('sel-boss', 16),  tests.b64('pin-boss', 32));

-- ---------------------------------------------------------------------------
-- Date de départ tenue par le trigger
-- ---------------------------------------------------------------------------
select tests.assert((select deactivated_at is null from public.staff where id = tests.staff2()), 'membre actif : pas de date de départ');
select tests.exec_as('authenticated', tests.manager_uid(), format('update public.staff set active = false where id = %L', tests.staff2()));
select tests.assert((select deactivated_at is not null from public.staff where id = tests.staff2()), 'désactivation : date de départ posée');
select tests.exec_as('authenticated', tests.manager_uid(), format('update public.staff set active = true where id = %L', tests.staff2()));
select tests.assert((select deactivated_at is null from public.staff where id = tests.staff2()), 'réactivation : date de départ retirée');
select tests.exec_as('authenticated', tests.manager_uid(), format('update public.staff set active = false where id = %L', tests.staff2()));

-- ---------------------------------------------------------------------------
-- Note d'information
-- ---------------------------------------------------------------------------
select tests.exec_as('authenticated', tests.manager_uid(), format('update public.staff set privacy_notice_on = current_date where id = %L', tests.staff1()));
select tests.assert_eq((select privacy_notice_on from public.staff where id = tests.staff1()), current_date, 'gérant note la remise de la note d''information');
select tests.throws('date de remise dans le futur refusée', 'authenticated', tests.manager_uid(),
  format('update public.staff set privacy_notice_on = current_date + 10 where id = %L', tests.staff1()), '%privacy_notice_future%');

-- ---------------------------------------------------------------------------
-- forgotten_at n'est posé que par staff_forget()
-- ---------------------------------------------------------------------------
select tests.throws('gérant ne pose pas forgotten_at directement', 'authenticated', tests.manager_uid(),
  format('update public.staff set forgotten_at = now() where id = %L', tests.staff2()), '%staff_forget_direct%');
select tests.throws('drapeau posé par un rôle applicatif : refusé', 'authenticated', tests.manager_uid(),
  format('select set_config(''haccp.staff_forget'', %L, true); update public.staff set forgotten_at = now() where id = %L', tests.staff2(), tests.staff2()),
  '%staff_forget_direct%');
select tests.throws('membre créé effacé refusé', 'authenticated', tests.manager_uid(),
  format('insert into public.staff (display_name, pin_salt, pin_hash, forgotten_at) values (''X'', %L, %L, now())', tests.b64('x', 16), tests.b64('y', 32)),
  '%staff_forgotten%');

-- ---------------------------------------------------------------------------
-- staff_forget : droits et refus
-- ---------------------------------------------------------------------------
select tests.throws('anon n''efface pas', 'anon', null, format('select public.staff_forget(%L)', tests.staff2()), '%permission denied%');
select tests.throws('non-gérant n''efface pas', 'authenticated', tests.user_uid(), format('select public.staff_forget(%L)', tests.staff2()), '%réservé au gérant%');
select tests.throws('service_role n''appelle pas staff_forget', 'service_role', null, format('select public.staff_forget(%L)', tests.staff2()), '%permission denied%');
select tests.throws('fonction interne fermée au gérant', 'authenticated', tests.manager_uid(),
  format('select public.haccp_staff_forget(%L, ''manager'')', tests.staff2()), '%permission denied%');
select tests.throws('membre actif : désactiver d''abord', 'authenticated', tests.manager_uid(), format('select public.staff_forget(%L)', tests.staff1()), '%staff_forget_active%');
select tests.exec_as('authenticated', tests.manager_uid(), format('update public.staff set active = false where id = %L', tests.boss()));
select tests.throws('gérant jamais effacé', 'authenticated', tests.manager_uid(), format('select public.staff_forget(%L)', tests.boss()), '%staff_forget_manager%');
select tests.throws('membre inconnu', 'authenticated', tests.manager_uid(), format('select public.staff_forget(%L)', gen_random_uuid()), '%staff_not_found%');

-- ---------------------------------------------------------------------------
-- Effacement de Bruno, qui a des saisies
-- ---------------------------------------------------------------------------
insert into public.records (id, type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash)
select v_id, 'system_test', '{"note":"saisie de Bruno"}', tests.staff2(), tests.device2(), coalesce(h.device_seq, 0) + 1, now(),
       coalesce(h.hash, tests.genesis()), tests.hex(v_id::text)
  from (select gen_random_uuid() as v_id) x left join public.device_chain_head(tests.device2()) h on true;
select tests.assert((select count(*) from public.audit_log where table_name = 'staff' and row_id = tests.staff2()::text
                      and (old ->> 'display_name' = 'Bruno Martin' or new ->> 'display_name' = 'Bruno Martin')) >= 3,
  'avant effacement : le nom figure dans le journal d''audit');

select tests.exec_as('authenticated', tests.manager_uid(),
  format('create temporary table _forget as select public.staff_forget(%L) as r', tests.staff2()));
select tests.assert_eq((select r ->> 'display_name' from _forget), 'Ancien équipier n° 1', 'pseudonyme renvoyé');
select tests.assert_eq((select r ->> 'records_kept' from _forget), '1', 'saisies conservées comptées');
select tests.assert_eq((select display_name from public.staff where id = tests.staff2()), 'Ancien équipier n° 1', 'nom remplacé par le pseudonyme');
select tests.assert((select forgotten_at is not null and not active from public.staff where id = tests.staff2()), 'fiche marquée effacée');
select tests.assert((select pin_hash <> tests.b64('pin-bruno', 32) and pin_salt <> tests.b64('sel-bruno', 16) from public.staff where id = tests.staff2()), 'PIN rendu inutilisable');
select tests.assert_eq((select count(*) from public.records where author_id = tests.staff2())::int, 1, 'saisies HACCP conservées');
select tests.assert_eq((select count(*) from public.audit_log where (old::text || coalesce(new::text, '')) like '%Bruno%')::int, 0,
  'plus aucune trace du nom dans le journal d''audit');
select tests.assert_eq((select count(*) from public.audit_log where (coalesce(old::text, '') || coalesce(new::text, '')) like '%Bruno%')::int, 0,
  'ni dans les lignes sans « old »');
select tests.assert((select count(*) from public.audit_log where table_name = 'staff' and row_id = tests.staff2()::text and action = 'RGPD_FORGET') = 1,
  'effacement journalisé (sans le nom)');
select tests.assert((select count(*) from public.audit_log where table_name = 'staff' and row_id = tests.staff2()::text) >= 4, 'historique du compte gardé (dates, actions)');
select tests.exec_as('authenticated', tests.manager_uid(),
  format('create temporary table _again as select public.staff_forget(%L) as r', tests.staff2()));
select tests.assert_eq((select r ->> 'already' from _again), 'true', 'deuxième effacement : sans effet');

select tests.throws('membre effacé : réactivation refusée', 'authenticated', tests.manager_uid(),
  format('update public.staff set active = true where id = %L', tests.staff2()), '%staff_forgotten%');
select tests.throws('membre effacé : renommage refusé', 'authenticated', tests.manager_uid(),
  format('update public.staff set display_name = ''Bruno'' where id = %L', tests.staff2()), '%staff_forgotten%');
select tests.throws('membre effacé : nouveau PIN refusé', 'authenticated', tests.manager_uid(),
  format('update public.staff set pin_hash = %L where id = %L', tests.b64('nouveau', 32), tests.staff2()), '%staff_forgotten%');

-- ---------------------------------------------------------------------------
-- Journal d'audit : toujours en insertion seule en dehors de l'effacement
-- ---------------------------------------------------------------------------
select tests.throws('audit_log : modification directe toujours refusée (propriétaire)', 'postgres', null,
  'update public.audit_log set actor = ''x'' where id = (select min(id) from public.audit_log)', '%interdit sur public.audit_log%');
select tests.throws('audit_log : drapeau sans changement limité au nom refusé', 'postgres', null,
  format('select set_config(''haccp.staff_forget'', %L, true); update public.audit_log set actor = ''x'' where table_name = ''staff'' and row_id = %L',
         tests.staff3(), tests.staff3()), '%interdit sur public.audit_log%');
select tests.throws('audit_log : drapeau d''un autre membre refusé', 'postgres', null,
  format('select set_config(''haccp.staff_forget'', %L, true); update public.audit_log set new = new || ''{"display_name":"x"}'' where table_name = ''staff'' and row_id = %L',
         tests.staff2(), tests.staff3()), '%interdit sur public.audit_log%');
select tests.throws('audit_log : suppression toujours refusée', 'postgres', null,
  'delete from public.audit_log where id = (select min(id) from public.audit_log)', '%interdit sur public.audit_log%');

-- ---------------------------------------------------------------------------
-- Effacement automatique : Chloé (désactivée depuis 31 jours, aucune saisie)
-- ---------------------------------------------------------------------------
select tests.exec_as('authenticated', tests.manager_uid(), format('update public.staff set active = false where id = %L', tests.staff3()));
select tests.assert_eq(public.forget_former_staff(), 0, 'départ récent : rien d''effacé (30 jours de délai)');
update public.staff set deactivated_at = now() - interval '31 days' where id = tests.staff3();
select tests.assert_eq((select deactivated_at < now() - interval '30 days' from public.staff where id = tests.staff3()), true, 'date de départ ancienne conservée');
-- Alice : désactivée depuis longtemps mais avec des saisies encore conservées → gardée.
update public.staff set active = false where id = tests.staff1();
update public.staff set deactivated_at = now() - interval '400 days' where id = tests.staff1();
select tests.assert_eq(public.forget_former_staff(), 1, 'effacement automatique : un ancien équipier sans saisie conservée');
select tests.assert_eq((select display_name from public.staff where id = tests.staff3()), 'Ancien équipier n° 2', 'Chloé pseudonymisée');
select tests.assert_eq((select display_name from public.staff where id = tests.staff1()), 'Alice', 'Alice gardée : ses saisies sont encore conservées');
select tests.assert_eq((select display_name from public.staff where id = tests.boss()), 'Le Patron', 'gérant jamais effacé automatiquement');
select tests.assert_eq((select new ->> 'reason' from public.audit_log where row_id = tests.staff3()::text and action = 'RGPD_FORGET'), 'auto', 'motif « auto » journalisé');
select tests.throws('forget_former_staff fermé au gérant', 'authenticated', tests.manager_uid(), 'select public.forget_former_staff()', '%permission denied%');
select tests.throws('forget_former_staff fermé à service_role', 'service_role', null, 'select public.forget_former_staff()', '%permission denied%');
