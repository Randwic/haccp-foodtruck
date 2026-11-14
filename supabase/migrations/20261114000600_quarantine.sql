-- =============================================================================
-- HACCP Food Truck — quarantaine des enregistrements refusés pour leur CONTENU
--
-- Un enregistrement dont la chaîne est valide (hash, prev_hash, device_seq) mais
-- dont le contenu est refusé est stocké avec quarantine_reason non nul :
--   'unknown_author' | 'unknown_type' | 'invalid_payload' | 'supersedes_not_found'
-- Il est immuable comme les autres et fait avancer la chaîne de l'appareil
-- (device_chain_head l'inclut) : l'appareil n'est jamais bloqué.
-- Les erreurs de chaîne (invalid_hash, broken_chain, seq_gap, id_conflict) ne
-- sont jamais stockées : les contrôles de format et de chaîne restent absolus.
--
-- Choix : les colonnes conservent les valeurs d'ORIGINE (indispensable pour
-- recalculer le hash à l'identique). Donc :
--  * les clés étrangères author_id -> staff et supersedes_id -> records sont
--    supprimées et remplacées par une vérification dans le trigger d'insertion,
--    appliquée uniquement hors quarantaine (les enregistrements étant immuables,
--    la vérification à l'insertion suffit ; la purge conserve toujours un
--    original référencé par une correction conservée) ;
--  * les contraintes type connu / correction ⇔ supersedes_id / payload objet ne
--    s'appliquent qu'aux enregistrements hors quarantaine.
-- =============================================================================

-- Liste unique des types connus (miroir de RecordType), partagée par le domaine
-- record_type (thresholds) et la contrainte de records.
create function public.haccp_known_record_type(p text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select p = any (array[
    'system_test', 'temperature_check', 'cooling', 'reheating', 'hot_holding',
    'cooking_check', 'thawing', 'oil_check', 'oil_change', 'reception',
    'label_printed', 'waste', 'cleaning_done', 'checklist_done',
    'corrective_action', 'alert_ack', 'correction'
  ]);
$$;
revoke all on function public.haccp_known_record_type(text) from public, anon;
-- EXECUTE requis par les contraintes CHECK pour les rôles qui écrivent.
grant execute on function public.haccp_known_record_type(text) to authenticated, service_role;

alter domain public.record_type drop constraint record_type_check;
alter domain public.record_type add constraint record_type_check check (public.haccp_known_record_type(value));

-- Colonne de quarantaine
alter table public.records add column quarantine_reason text null;
alter table public.records add constraint records_quarantine_reason_check
  check (quarantine_reason in ('unknown_author', 'unknown_type', 'invalid_payload', 'supersedes_not_found'));

-- type : texte libre (borné) en quarantaine, type connu sinon
alter table public.records alter column type type text;
alter table public.records add constraint records_type_length check (length(type) between 1 and 100);
alter table public.records add constraint records_type_check
  check (quarantine_reason is not null or public.haccp_known_record_type(type));

-- Contraintes de contenu : seulement hors quarantaine
alter table public.records drop constraint records_correction_link;
alter table public.records add constraint records_correction_link
  check (quarantine_reason is not null or ((type = 'correction') = (supersedes_id is not null)));
alter table public.records drop constraint records_payload_object;
alter table public.records add constraint records_payload_object
  check (quarantine_reason is not null or jsonb_typeof(payload) = 'object');

-- Clés étrangères de contenu remplacées par la vérification du trigger
alter table public.records drop constraint records_author_id_fkey;
alter table public.records drop constraint records_supersedes_id_fkey;

-- Examen par le gérant
create index records_quarantine_idx on public.records (server_time) where quarantine_reason is not null;

comment on column public.records.quarantine_reason is
  'Non nul = enregistrement stocké mais refusé pour son contenu (à examiner par le gérant). Valeurs d''origine conservées pour la vérification du hash.';

-- ---------------------------------------------------------------------------
-- Trigger d'insertion : ajout des contrôles référentiels hors quarantaine
-- ---------------------------------------------------------------------------
create or replace function public.haccp_records_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_revoked   timestamptz;
  v_prev_hash text;
  v_clock_min integer;
begin
  new.server_time := now();

  select s.clock_suspect_minutes into v_clock_min from public.settings s where s.id = 1;
  new.clock_suspect := coalesce(new.clock_suspect, false)
    or abs(extract(epoch from (new.server_time - new.device_time))) > coalesce(v_clock_min, 5) * 60;

  select d.revoked_at into v_revoked from public.devices d where d.id = new.device_id;
  if v_revoked is not null then
    raise exception 'HACCP: device_revoked — appareil % révoqué', new.device_id
      using errcode = 'check_violation';
  end if;

  -- Contrôles de contenu (remplacent les clés étrangères) : hors quarantaine seulement.
  if new.quarantine_reason is null then
    if not exists (select 1 from public.staff s where s.id = new.author_id) then
      raise exception 'HACCP: unknown_author — membre % inconnu', new.author_id
        using errcode = 'foreign_key_violation';
    end if;
    if new.supersedes_id is not null
       and not exists (select 1 from public.records r where r.id = new.supersedes_id) then
      raise exception 'HACCP: supersedes_not_found — enregistrement corrigé % introuvable', new.supersedes_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  -- Valeurs hors format : laisser les contraintes CHECK produire l'erreur explicite.
  if new.device_seq is null or new.device_seq < 1
     or new.prev_hash is null or new.prev_hash !~ '^[0-9a-f]{64}$' then
    return new;
  end if;

  -- Sérialise les insertions d'un même appareil (chaîne linéaire).
  perform pg_advisory_xact_lock(hashtextextended('haccp-chain:' || new.device_id::text, 0));

  if new.device_seq = 1 then
    -- Genèse : la contrainte records_genesis impose prev_hash = GENESIS_HASH.
    return new;
  end if;

  select r.hash into v_prev_hash
    from public.records r
   where r.device_id = new.device_id and r.device_seq = new.device_seq - 1;
  if v_prev_hash is null then
    select a.hash into v_prev_hash
      from public.record_chain_anchors a
     where a.device_id = new.device_id and a.device_seq = new.device_seq - 1;
  end if;
  if v_prev_hash is null then
    raise exception 'HACCP: seq_gap — maillon % absent pour l''appareil %', new.device_seq - 1, new.device_id
      using errcode = 'check_violation';
  end if;

  if new.prev_hash is distinct from v_prev_hash then
    raise exception 'HACCP: broken_chain — prev_hash ne correspond pas au maillon % de l''appareil %', new.device_seq - 1, new.device_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
