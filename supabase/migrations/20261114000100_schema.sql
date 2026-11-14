-- =============================================================================
-- HACCP Food Truck — schéma de base (tables, contraintes, index)
-- Compatible Supabase : ne crée ni le schéma `auth` ni les rôles (fournis par Supabase).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Établissement (une seule ligne)
-- ---------------------------------------------------------------------------
create table public.establishment (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 200),
  timezone    text not null default 'Europe/Paris' check (length(timezone) between 1 and 64),
  created_at  timestamptz not null default now()
);
-- Singleton : au plus un établissement.
create unique index establishment_singleton on public.establishment ((true));

-- ---------------------------------------------------------------------------
-- Gérants = utilisateurs Supabase Auth listés ici (ajoutés par l'administrateur).
-- ---------------------------------------------------------------------------
create table public.managers (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Équipe (PIN : PBKDF2-SHA256, sel 16 octets, clé 32 octets, base64 standard)
-- ---------------------------------------------------------------------------
create table public.staff (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null check (length(btrim(display_name)) between 1 and 100),
  role          text not null default 'staff' check (role in ('manager', 'staff')),
  active        boolean not null default true,
  pin_salt      text not null check (pin_salt ~ '^[A-Za-z0-9+/]{22}==$'),
  pin_hash      text not null check (pin_hash ~ '^[A-Za-z0-9+/]{43}=$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Appareils enrôlés (seul le SHA-256 hex du jeton est stocké)
-- ---------------------------------------------------------------------------
create table public.devices (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 1 and 100),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  enrolled_by   uuid references auth.users (id) on delete set null,
  enrolled_at   timestamptz not null default now(),
  revoked_at    timestamptz null,
  last_seen_at  timestamptz null
);

-- ---------------------------------------------------------------------------
-- Équipements (enceintes froides, bacs de friteuse…)
-- ---------------------------------------------------------------------------
create table public.equipment (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 100),
  kind        text not null check (kind in ('fridge', 'freezer', 'fryer_vat', 'hot_holding', 'other')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Types d'enregistrement admis (miroir de RecordType dans shared/types.ts).
-- Ajouter un type = nouvelle migration qui modifie ce domaine.
-- ---------------------------------------------------------------------------
create domain public.record_type as text
  check (value in (
    'system_test', 'temperature_check', 'cooling', 'reheating', 'hot_holding',
    'cooking_check', 'thawing', 'oil_check', 'oil_change', 'reception',
    'label_printed', 'waste', 'cleaning_done', 'checklist_done',
    'corrective_action', 'alert_ack', 'correction'
  ));

-- ---------------------------------------------------------------------------
-- Seuils (equipment_id null = seuil générique pour le type de contrôle)
-- ---------------------------------------------------------------------------
create table public.thresholds (
  id                 uuid primary key default gen_random_uuid(),
  equipment_id       uuid null references public.equipment (id) on delete restrict,
  check_type         public.record_type not null,
  min_c              numeric(5, 1) null check (min_c between -80 and 300),
  max_c              numeric(5, 1) null check (max_c between -80 and 300),
  tolerance_minutes  integer not null default 0 check (tolerance_minutes between 0 and 1440),
  updated_at         timestamptz not null default now(),
  constraint thresholds_min_le_max check (min_c is null or max_c is null or min_c <= max_c),
  constraint thresholds_bound_present check (min_c is not null or max_c is not null),
  constraint thresholds_unique unique nulls not distinct (equipment_id, check_type)
);

-- ---------------------------------------------------------------------------
-- Paramètres (une seule ligne, id = 1)
-- ---------------------------------------------------------------------------
create table public.settings (
  id                     integer primary key default 1 check (id = 1),
  retention_years        integer not null default 3 check (retention_years between 1 and 30),
  auto_lock_minutes      integer not null default 5 check (auto_lock_minutes between 1 and 120),
  clock_suspect_minutes  integer not null default 5 check (clock_suspect_minutes between 1 and 1440),
  email_alerts           boolean not null default true,
  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Registre HACCP : insertion seule (voir migration d'immutabilité)
-- ---------------------------------------------------------------------------
create table public.records (
  id             uuid primary key default gen_random_uuid(),
  type           public.record_type not null,
  payload        jsonb not null,
  author_id      uuid not null references public.staff (id) on delete restrict,
  device_id      uuid not null references public.devices (id) on delete restrict,
  device_seq     bigint not null,
  device_time    timestamptz not null,
  prev_hash      text not null,
  hash           text not null,
  -- NO ACTION (et non RESTRICT) : la purge supprime original + corrections
  -- dans la même instruction ; la vérification se fait en fin d'instruction.
  supersedes_id  uuid null references public.records (id),
  server_time    timestamptz not null default now(),
  clock_suspect  boolean not null default false,
  constraint records_device_seq_unique unique (device_id, device_seq),
  constraint records_device_seq_positive check (device_seq >= 1),
  constraint records_hash_format check (hash ~ '^[0-9a-f]{64}$'),
  constraint records_prev_hash_format check (prev_hash ~ '^[0-9a-f]{64}$'),
  constraint records_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint records_correction_link check ((type = 'correction') = (supersedes_id is not null)),
  constraint records_no_self_supersede check (supersedes_id is distinct from id),
  constraint records_genesis check (device_seq > 1 or prev_hash = repeat('0', 64))
);

create index records_type_idx        on public.records (type);
create index records_server_time_idx on public.records (server_time);
create index records_device_time_idx on public.records (device_time);
create index records_author_idx      on public.records (author_id);
create index records_supersedes_idx  on public.records (supersedes_id) where supersedes_id is not null;
create index records_equipment_idx   on public.records ((payload ->> 'equipment_id')) where payload ? 'equipment_id';

-- Ancre de chaîne : dernier maillon supprimé par la purge, par appareil.
-- Permet de continuer à vérifier/prolonger la chaîne après une purge de fin de conservation.
create table public.record_chain_anchors (
  device_id   uuid primary key references public.devices (id) on delete restrict,
  device_seq  bigint not null check (device_seq >= 1),
  hash        text not null check (hash ~ '^[0-9a-f]{64}$'),
  purged_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Journal d'audit : insertion seule
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       text not null,
  table_name  text not null,
  row_id      text null,
  action      text not null,
  old         jsonb null,
  new         jsonb null
);
create index audit_log_table_at_idx on public.audit_log (table_name, at);

comment on table public.records is 'Registre HACCP append-only. UPDATE/DELETE/TRUNCATE interdits (triggers), sauf purge_expired_records().';
comment on table public.audit_log is 'Journal d''audit append-only des tables de référence et des purges.';
comment on table public.record_chain_anchors is 'Dernier maillon purgé par appareil (écrit uniquement par purge_expired_records()).';
