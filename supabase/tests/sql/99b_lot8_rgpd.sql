-- Lot 8 : RGPD — effacement du nom d'un ancien membre (staff_forget), saisies conservées.

-- Une saisie d'Alice au registre (elle doit rester après l'effacement).
select tests.add_record(tests.device1());
create temporary table _rgpd_before as select count(*)::int as n from public.records where author_id = tests.staff1();

select tests.throws('anon ne peut pas effacer', 'anon', null,
  format('select * from public.staff_forget(%L)', tests.staff1()), '%permission denied%');
select tests.throws('non-gérant ne peut pas effacer', 'authenticated', tests.user_uid(),
  format('select * from public.staff_forget(%L)', tests.staff1()), '%réservé au gérant%');
select tests.throws('membre encore actif : refus', 'authenticated', tests.manager_uid(),
  format('select * from public.staff_forget(%L)', tests.staff1()), '%désactivez d''abord%');
select tests.throws('membre inconnu : refus', 'authenticated', tests.manager_uid(),
  'select * from public.staff_forget(''00000000-0000-4000-8000-0000000000ff'')', '%introuvable%');

select tests.exec_as('authenticated', tests.manager_uid(), format('update public.staff set active = false where id = %L', tests.staff1()));
select tests.exec_as('authenticated', tests.manager_uid(), format('select * from public.staff_forget(%L)', tests.staff1()));

select tests.assert_eq((select display_name from public.staff where id = tests.staff1()), 'Ancien membre 0000', 'nom remplacé par un pseudonyme');
select tests.assert((select forgotten_at is not null and not active from public.staff where id = tests.staff1()), 'date d''effacement posée, membre désactivé');
select tests.assert((select pin_hash <> tests.b64('pin-alice', 32) and pin_salt <> tests.b64('sel-alice', 16) from public.staff where id = tests.staff1()), 'ancien PIN inutilisable');
select tests.assert((select pin_salt ~ '^[A-Za-z0-9+/]{22}==$' and pin_hash ~ '^[A-Za-z0-9+/]{43}=$' from public.staff where id = tests.staff1()), 'sel et empreinte au bon format');
select tests.assert_eq((select count(*) from public.records where author_id = tests.staff1())::int, (select n from _rgpd_before), 'saisies de l''ancien membre conservées');

-- Idempotent : un second appel ne change rien.
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  format('select display_name from public.staff_forget(%L)', tests.staff1())), 'Ancien membre 0000', 'second appel sans effet');

-- Plus de réactivation ni de changement de nom ou de PIN.
select tests.throws('réactivation refusée', 'authenticated', tests.manager_uid(),
  format('update public.staff set active = true where id = %L', tests.staff1()), '%membre effacé%');
select tests.throws('changement de nom refusé', 'authenticated', tests.manager_uid(),
  format('update public.staff set display_name = ''Alice'' where id = %L', tests.staff1()), '%membre effacé%');
select tests.throws('nouveau PIN refusé', 'authenticated', tests.manager_uid(),
  format('update public.staff set pin_hash = %L where id = %L', tests.b64('autre', 32), tests.staff1()), '%membre effacé%');
