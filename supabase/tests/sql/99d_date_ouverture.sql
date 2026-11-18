-- Date d'ouverture : colonne facultative, bornée, réglable par le gérant seulement, migration rejouable.

select tests.assert((select opening_date is null from public.settings where id = 1), 'par défaut : pas de date d’ouverture (déjà ouvert)');
select tests.throws('date absurde refusée', 'postgres', null, 'update public.settings set opening_date = date ''1999-01-01'' where id = 1', '%settings_opening_date_range%');

select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.settings set opening_date = date ''2027-03-01'' where id = 1 returning 1) select count(*) from u'), '1', 'gérant règle la date d’ouverture');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(),
  'with u as (update public.settings set opening_date = null where id = 1 returning 1) select count(*) from u'), '0', 'non-gérant ne modifie pas la date d’ouverture');
update public.settings set opening_date = date '2027-03-01' where id = 1;

\ir ../../migrations/20261118000300_date_ouverture.sql
select tests.assert_eq((select opening_date::text from public.settings where id = 1), '2027-03-01', 'migration rejouée : date du gérant conservée');
