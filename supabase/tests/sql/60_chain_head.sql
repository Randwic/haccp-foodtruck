-- device_chain_head(p_device_id) : dernier maillon de la chaîne d'un appareil.

select tests.assert_eq((select count(*) from public.device_chain_head(tests.device2())), 0::bigint,
  'appareil sans enregistrement : résultat vide');
select tests.assert_eq((select count(*) from public.device_chain_head(gen_random_uuid())), 0::bigint,
  'appareil inconnu : résultat vide');

select tests.assert_eq((select device_seq from public.device_chain_head(tests.device1())), 2::bigint, 'tête appareil 1 = seq 2');
select tests.assert_eq((select hash from public.device_chain_head(tests.device1())),
  (select hash from public.records where device_id = tests.device1() and device_seq = 2), 'tête appareil 1 = hash du seq 2');

select tests.add_record(tests.device2());
select tests.add_record(tests.device1());
select tests.add_record(tests.device1());
select tests.assert_eq((select device_seq from public.device_chain_head(tests.device1())), 4::bigint, 'tête appareil 1 = seq 4 après ajouts');
select tests.assert_eq((select device_seq from public.device_chain_head(tests.device2())), 1::bigint, 'tête appareil 2 indépendante');
select tests.assert_eq((select count(*) from public.device_chain_head(tests.device1())), 1::bigint, 'une seule ligne renvoyée');

-- Chaîne complète cohérente : chaque prev_hash = hash du précédent
select tests.assert(not exists (
  select 1 from public.records r
   left join public.records p on p.device_id = r.device_id and p.device_seq = r.device_seq - 1
   where (r.device_seq = 1 and r.prev_hash <> tests.genesis())
      or (r.device_seq > 1 and r.prev_hash is distinct from p.hash)), 'chaînes de hachage continues');

-- Visible par le gérant (RLS), vide pour un non-gérant
select tests.assert_eq(tests.value_as('authenticated', tests.manager_uid(),
  format('select device_seq from public.device_chain_head(%L)', tests.device1())), '4', 'gérant : device_chain_head');
select tests.assert(tests.value_as('authenticated', tests.user_uid(),
  format('select device_seq from public.device_chain_head(%L)', tests.device1())) is null, 'non-gérant : device_chain_head vide');
