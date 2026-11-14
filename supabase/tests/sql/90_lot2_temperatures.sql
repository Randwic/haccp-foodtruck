-- Lot 2 (températures) : heures de relevé, seuils génériques, types du lot 2,
-- horloge suspecte calculée sur device_now (horloge de l'appareil à l'envoi).

-- ---------------------------------------------------------------------------
-- settings.daily_check_times
-- ---------------------------------------------------------------------------
select tests.assert_eq((select daily_check_times from public.settings), '{08:00,18:00}'::text[], 'daily_check_times : défaut {08:00,18:00}');
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  'with u as (update public.settings set daily_check_times = ''{07:30,12:00,23:59,00:00}'' where id = 1 returning daily_check_times) select array_to_string(daily_check_times, '','') from u'),
  '07:30,12:00,23:59,00:00', 'gérant : modifie daily_check_times');
select tests.assert_eq(tests.value_as('service_role', null,
  'with u as (update public.settings set daily_check_times = ''{01:00,02:00,03:00,04:00,05:00,06:00}'' returning 1) select count(*) from u'),
  '1', 'daily_check_times : 6 heures acceptées');
do $$
declare
  v text;
begin
  foreach v in array array['''{}''', '''{25:00}''', '''{8:00}''', '''{08:60}''', '''{08:00,08:00}''',
                           '''{01:00,02:00,03:00,04:00,05:00,06:00,07:00}''', 'array[''08:00'', null]',
                           '''{{08:00},{09:00}}''', '''{"08:00,09:00"}''', '''{" 08:00"}'''] loop
    perform tests.throws('daily_check_times invalide : ' || v, 'service_role', null,
      'update public.settings set daily_check_times = ' || v, '%settings_daily_check_times_check%');
  end loop;
end $$;
select tests.throws('daily_check_times null', 'service_role', null,
  'update public.settings set daily_check_times = null', '%null value%daily_check_times%');
select tests.assert_eq(tests.value_as('authenticated', tests.user_uid(),
  'with u as (update public.settings set daily_check_times = ''{09:00}'' returning 1) select count(*) from u'),
  '0', 'non-gérant : daily_check_times non modifiable');

-- ---------------------------------------------------------------------------
-- Seuils génériques par défaut (migration …0800 + seed, idempotents)
-- ---------------------------------------------------------------------------
select tests.assert_eq((select min_c from public.thresholds where equipment_id is null and check_type = 'hot_holding'), 63.0, 'seuil générique hot_holding ≥ 63');
select tests.assert_eq((select min_c from public.thresholds where equipment_id is null and check_type = 'cooking_check'), 70.0, 'seuil générique cooking_check ≥ 70');
select tests.assert((select max_c = 10 and min_c is null and tolerance_minutes = 120 from public.thresholds where equipment_id is null and check_type = 'cooling'),
  'seuil générique cooling ≤ 10 en 120 min');
select tests.assert((select min_c = 63 and max_c is null and tolerance_minutes = 60 from public.thresholds where equipment_id is null and check_type = 'reheating'),
  'seuil générique reheating ≥ 63 en 60 min');
select tests.assert_eq((select count(*) from public.thresholds where equipment_id is null), 4::bigint, 'exactement 4 seuils génériques (seed rejoué sans doublon)');

-- ---------------------------------------------------------------------------
-- Types du lot 2 acceptés par la base
-- ---------------------------------------------------------------------------
select tests.assert((select bool_and(public.haccp_known_record_type(t))
  from unnest(array['cooling', 'reheating', 'thawing', 'hot_holding', 'cooking_check', 'temperature_check', 'corrective_action']) t),
  'haccp_known_record_type : types du lot 2 connus');
do $$
declare
  t text;
begin
  foreach t in array array['cooling', 'reheating', 'thawing', 'hot_holding', 'cooking_check'] loop
    perform tests.exec_as('service_role', null, format(
      'insert into public.records (type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash) values (%L, %L, %L, %L, %s, now(), %L, %L)',
      t, '{"product":"Chili"}', tests.staff1(), tests.device1(),
      (select device_seq + 1 from public.device_chain_head(tests.device1())),
      (select hash from public.device_chain_head(tests.device1())), tests.hex('lot2-' || t)));
  end loop;
end $$;
select tests.assert_eq((select count(*) from public.records where type in ('cooling', 'reheating', 'thawing', 'hot_holding', 'cooking_check') and quarantine_reason is null),
  5::bigint, 'service_role insère les 5 types du lot 2 hors quarantaine');

-- ---------------------------------------------------------------------------
-- Horloge suspecte
-- ---------------------------------------------------------------------------
-- Insère le maillon suivant de device2 sous p_role ; device_time / device_now relatifs à now().
create function tests.clock_ins(p_role text, p_label text, p_device_age interval, p_now_age interval, p_clock boolean default null)
returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform tests.exec_as(p_role, null, format(
    'insert into public.records (id, type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash, device_now%s) '
    'values (%L, ''system_test'', ''{"note":"x"}'', %L, %L, %s, now() - %L::interval, %L, %L, %s%s)',
    case when p_clock is null then '' else ', clock_suspect' end,
    v_id, tests.staff1(), tests.device2(),
    coalesce((select device_seq from public.device_chain_head(tests.device2())), 0) + 1,
    p_device_age,
    coalesce((select hash from public.device_chain_head(tests.device2())), tests.genesis()),
    tests.hex(p_label),
    case when p_now_age is null then 'null' else format('now() - %L::interval', p_now_age) end,
    case when p_clock is null then '' else format(', %L', p_clock) end));
  return v_id;
end $$;
-- Insère puis relit (clock_suspect, device_now non null).
create function tests.clock_row(p_role text, p_label text, p_device_age interval, p_now_age interval, p_clock boolean default null,
  out clock_suspect boolean, out has_device_now boolean)
language plpgsql as $$
declare
  v_id uuid := tests.clock_ins(p_role, p_label, p_device_age, p_now_age, p_clock);
begin
  select r.clock_suspect, r.device_now is not null into clock_suspect, has_device_now from public.records r where r.id = v_id;
end $$;

-- Saisie hors réseau envoyée 3 h plus tard, horloge juste : PAS suspecte.
select tests.assert((select not clock_suspect and has_device_now from tests.clock_row('service_role', 'c1', '3 hours', '0 minutes')),
  'service_role + device_now juste : saisie ancienne non signalée');
-- Ancienne app (pas de device_now) : ancienne règle par enregistrement.
select tests.assert((select clock_suspect and not has_device_now from tests.clock_row('service_role', 'c2', '3 hours', null)),
  'sans device_now : |server_time − device_time| (ancienne règle)');
-- Horloge déréglée à l'envoi : suspecte même si device_time = device_now.
select tests.assert((select clock_suspect from tests.clock_row('service_role', 'c3', '2 hours', '2 hours')),
  'device_now décalé de 2 h : signalé');
-- La valeur fournie ne peut qu'ajouter le signalement (lot jugé suspect par la fonction)…
select tests.assert((select clock_suspect from tests.clock_row('service_role', 'c4', '0 minutes', '0 minutes', true)),
  'clock_suspect = true fourni (lot suspect) : conservé');
-- … jamais l'effacer.
select tests.assert((select clock_suspect from tests.clock_row('service_role', 'c5', '2 hours', '2 hours', false)),
  'clock_suspect = false fourni : n''efface pas un écart réel');
-- device_now ignoré hors service_role (propriétaire ici) : ancienne règle, colonne remise à null.
select tests.assert((select clock_suspect and not has_device_now from tests.clock_row('postgres', 'c6', '3 hours', '0 minutes', false)),
  'device_now ignoré pour un autre rôle (propriétaire) : signalé, device_now null');
-- Rôle applicatif hypothétique ayant reçu INSERT (et contournant RLS) : idem.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'haccp_test_writer') then
    create role haccp_test_writer nologin bypassrls;
  end if;
end $$;
grant usage on schema public, tests to haccp_test_writer;
grant insert on public.records to haccp_test_writer;
grant execute on all functions in schema tests to haccp_test_writer;
grant execute on function public.haccp_known_record_type(text) to haccp_test_writer; -- contrainte records_type_check
select tests.assert((select clock_suspect and not has_device_now from tests.clock_row('haccp_test_writer', 'c7', '3 hours', '0 minutes', false)),
  'device_now ignoré pour un rôle autre que service_role : signalé');
-- Le paramètre clock_suspect_minutes s'applique à device_now.
update public.settings set clock_suspect_minutes = 180;
select tests.assert((select not clock_suspect from tests.clock_row('service_role', 'c8', '5 hours', '2 hours')),
  'clock_suspect_minutes = 180 : écart de 2 h toléré');
select tests.assert((select clock_suspect from tests.clock_row('service_role', 'c9', '5 hours', '4 hours')),
  'clock_suspect_minutes = 180 : écart de 4 h signalé');
-- device_now est immuable comme le reste du registre.
select tests.throws('device_now non modifiable', 'service_role', null,
  'update public.records set device_now = now()', '%permission denied%');
