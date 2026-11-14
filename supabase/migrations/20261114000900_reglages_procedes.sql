-- Réglages modifiables par le gérant (Gestion › Réglages), exposés par sync-pull.
alter table public.settings
  add column if not exists missed_slot_carry_over boolean not null default true,
  add column if not exists thaw_dlc_days integer not null default 3;

do $$ begin
  alter table public.settings add constraint settings_thaw_dlc_days_range check (thaw_dlc_days between 0 and 30);
exception when duplicate_object then null; end $$;

comment on column public.settings.missed_slot_carry_over is
  'Un créneau de relevé oublié la veille reste « à faire » avant le premier créneau du jour.';
comment on column public.settings.thaw_dlc_days is
  'DLC proposée après décongélation (jours après la fin) — à confirmer selon le PMS.';
