-- =============================================================================
-- Aides de test + jeu de données commun (appliqué au modèle après le seed).
-- Chaque assertion réussie émet « NOTICE: ok - … » ; un échec lève une exception
-- (psql ON_ERROR_STOP => code de sortie ≠ 0).
-- =============================================================================
create schema tests;

-- Identités fixes
--   gérant      : 0000000a-0000-4000-8000-00000000000a
--   non-gérant  : 0000000b-0000-4000-8000-00000000000b
create function tests.manager_uid() returns uuid language sql immutable as $$ select '0000000a-0000-4000-8000-00000000000a'::uuid $$;
create function tests.user_uid()    returns uuid language sql immutable as $$ select '0000000b-0000-4000-8000-00000000000b'::uuid $$;
create function tests.staff1()      returns uuid language sql immutable as $$ select '0000005a-0000-4000-8000-000000000001'::uuid $$;
create function tests.device1()     returns uuid language sql immutable as $$ select '000000d1-0000-4000-8000-000000000001'::uuid $$;
create function tests.device2()     returns uuid language sql immutable as $$ select '000000d2-0000-4000-8000-000000000002'::uuid $$;
create function tests.genesis()     returns text language sql immutable as $$ select repeat('0', 64) $$;

create function tests.hex(p text) returns text
language sql immutable as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function tests.b64(p text, p_len int) returns text
language sql immutable as $$ select encode(substring(sha256(convert_to(p, 'UTF8')) from 1 for p_len), 'base64') $$;

create function tests.assert(p_cond boolean, p_desc text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'ÉCHEC : %', p_desc;
  end if;
  raise notice 'ok - %', p_desc;
end $$;

create function tests.assert_eq(p_actual anyelement, p_expected anyelement, p_desc text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ÉCHEC : % (obtenu %, attendu %)', p_desc, p_actual, p_expected;
  end if;
  raise notice 'ok - %', p_desc;
end $$;

-- Exécute p_sql sous le rôle p_role (et l'utilisateur JWT p_uid) et exige une erreur
-- dont le message correspond à p_pattern (ILIKE). Les effets sont toujours annulés.
create function tests.throws(p_desc text, p_role text, p_uid uuid, p_sql text, p_pattern text default '%')
returns void
language plpgsql as $$
declare
  v_msg   text;
  v_state text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    execute format('set local role %I', p_role);
    execute p_sql;
    raise exception 'tests: aucune erreur' using errcode = 'XT000';
  exception when others then
    v_msg := sqlerrm; v_state := sqlstate;
  end;
  if v_state = 'XT000' then
    raise exception 'ÉCHEC : % — aucune erreur levée [% : %]', p_desc, p_role, p_sql;
  end if;
  if v_msg not ilike p_pattern then
    raise exception 'ÉCHEC : % — erreur inattendue « % » (attendu %) [% : %]', p_desc, v_msg, p_pattern, p_role, p_sql;
  end if;
  raise notice 'ok - % [%] → %', p_desc, p_role, left(v_msg, 90);
end $$;

-- Évalue une requête scalaire sous un rôle ; effets annulés ; une erreur fait échouer le test.
create function tests.value_as(p_role text, p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare
  v text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    execute format('set local role %I', p_role);
    execute p_sql into v;
    raise exception 'tests: rollback' using errcode = 'XT001';
  exception when sqlstate 'XT001' then
    null;
  end;
  return v;
end $$;

-- Exécute une instruction sous un rôle et CONSERVE ses effets.
create function tests.exec_as(p_role text, p_uid uuid, p_sql text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  execute p_sql;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- Ajoute le maillon suivant de la chaîne d'un appareil (en tant que propriétaire).
create function tests.add_record(
  p_device uuid, p_type text default 'system_test', p_supersedes uuid default null,
  p_payload jsonb default '{"note":"test"}'
) returns uuid
language plpgsql as $$
declare
  v_seq  bigint;
  v_prev text;
  v_id   uuid := gen_random_uuid();
begin
  select h.device_seq, h.hash into v_seq, v_prev from public.device_chain_head(p_device) h;
  v_seq  := coalesce(v_seq, 0) + 1;
  v_prev := coalesce(v_prev, tests.genesis());
  insert into public.records (id, type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash, supersedes_id)
  values (v_id, p_type, p_payload, tests.staff1(), p_device, v_seq, now(), v_prev, tests.hex(v_id::text), p_supersedes);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Jeu de données commun
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  (tests.manager_uid(), 'gerant@example.test'),
  (tests.user_uid(),    'intrus@example.test');
insert into public.managers (user_id) values (tests.manager_uid());

insert into public.staff (id, display_name, role, pin_salt, pin_hash)
values (tests.staff1(), 'Alice', 'staff', tests.b64('sel-alice', 16), tests.b64('pin-alice', 32));

insert into public.devices (id, name, token_hash, enrolled_by) values
  (tests.device1(), 'Tablette',  tests.hex('jeton-1'), tests.manager_uid()),
  (tests.device2(), 'iPhone',    tests.hex('jeton-2'), tests.manager_uid());

select tests.add_record(tests.device1());
select tests.add_record(tests.device1(), 'temperature_check',
  null, '{"equipment_id":"00000000-0000-4000-8000-000000000101","temperature_c":3.5}');
