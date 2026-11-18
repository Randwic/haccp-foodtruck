-- Lot 9 : vérification des thermomètres (type connu, réglages bornés, migration rejouable).

select tests.assert(public.haccp_known_record_type('thermometer_check'), 'type thermometer_check connu');
select tests.assert(public.haccp_known_record_type('oil_check') and public.haccp_known_record_type('correction'), 'types existants toujours connus');
select tests.assert(not public.haccp_known_record_type('futur_type'), 'type inconnu toujours refusé');

-- Seuil générique possible sur le nouveau type (domaine record_type)
insert into public.thresholds (check_type, max_c) values ('thermometer_check', 1);
select tests.assert_eq((select count(*) from public.thresholds where check_type = 'thermometer_check')::int, 1, 'domaine record_type : thermometer_check accepté');

-- Réglages par défaut
select tests.assert_eq((select thermometer_tolerance_c::text from public.settings where id = 1), '1.0', 'réglage : écart admis 1 °C par défaut');
select tests.assert_eq((select thermometer_check_days from public.settings where id = 1), 30, 'réglage : vérification tous les 30 jours par défaut');

-- Bornes
select tests.throws('écart admis > 2 °C refusé', 'postgres', null, 'update public.settings set thermometer_tolerance_c = 2.5 where id = 1', '%settings_thermometer_ranges%');
select tests.throws('écart admis 0 refusé', 'postgres', null, 'update public.settings set thermometer_tolerance_c = 0 where id = 1', '%settings_thermometer_ranges%');
select tests.throws('fréquence 0 jour refusée', 'postgres', null, 'update public.settings set thermometer_check_days = 0 where id = 1', '%settings_thermometer_ranges%');
select tests.throws('fréquence > 365 jours refusée', 'postgres', null, 'update public.settings set thermometer_check_days = 400 where id = 1', '%settings_thermometer_ranges%');

-- Le gérant peut régler, un équipier non (RLS settings)
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.settings set thermometer_tolerance_c = 0.5, thermometer_check_days = 7 where id = 1 returning 1) select count(*) from u'), '1', 'gérant règle la vérification des thermomètres');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(),
  'with u as (update public.settings set thermometer_check_days = 365 where id = 1 returning 1) select count(*) from u'), '0', 'non-gérant ne modifie pas les réglages');
update public.settings set thermometer_check_days = 7 where id = 1; -- réglage « du gérant » (value_as ne conserve rien)

-- Migration rejouable, réglage du gérant non écrasé
\ir ../../migrations/20261118000200_lot9_thermometre.sql
select tests.assert_eq((select thermometer_check_days from public.settings where id = 1), 7, 'migration rejouée : réglage du gérant conservé');
select tests.assert(public.haccp_known_record_type('thermometer_check'), 'migration rejouée : type toujours connu');
