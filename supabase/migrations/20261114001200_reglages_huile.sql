-- Réglages huile de friture (composés polaires, décret 2008-184 : 25 % maximum).
alter table public.settings
  add column if not exists oil_polar_max numeric(4,1) not null default 25,
  add column if not exists oil_polar_warn numeric(4,1) not null default 22;
do $$ begin
  alter table public.settings add constraint settings_oil_polar_range
    check (oil_polar_max between 10 and 30 and oil_polar_warn > 0 and oil_polar_warn < oil_polar_max);
exception when duplicate_object then null; end $$;
