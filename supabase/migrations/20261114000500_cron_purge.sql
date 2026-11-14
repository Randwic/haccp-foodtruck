-- =============================================================================
-- HACCP Food Truck — planification de la purge via pg_cron (tolérante)
-- Si pg_cron n'est pas disponible (développement local, tests), la migration
-- réussit quand même : un simple avertissement est émis.
-- Sur Supabase : activer « pg_cron » (Database > Extensions) puis relancer
-- cette instruction si besoin :
--   select cron.schedule('haccp-purge-expired-records', '17 3 * * *',
--                        'select public.purge_expired_records()');
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
        create extension if not exists pg_cron;
      end if;
    exception when others then
      raise warning 'HACCP: pg_cron non activable (%), purge non planifiée', sqlerrm;
    end;
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      -- Tous les jours à 03:17 UTC ; cron.schedule(nom, …) remplace un job existant du même nom.
      perform cron.schedule('haccp-purge-expired-records', '17 3 * * *',
                            'select public.purge_expired_records()');
    exception when others then
      raise warning 'HACCP: planification pg_cron impossible (%)', sqlerrm;
    end;
  else
    raise warning 'HACCP: extension pg_cron absente, purge non planifiée';
  end if;
end;
$$;
