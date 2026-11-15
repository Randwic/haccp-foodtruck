// Point d'entrée Deno de « sensor-ingest » : câblage uniquement (logique : _shared/sensor_ingest.ts).
// Webhooks des capteurs (Shelly H&T Gen3…) : jeton du capteur dans l'URL (?token=) ou l'en-tête x-sensor-token.
import { SupabaseLot6Repo } from '../_adapters/supabase_alerts.ts'
import { httpEnvFromDeno, serviceClient } from '../_adapters/supabase_repo.ts'
import { createSensorIngestHandler } from '../_shared/sensor_ingest.ts'

const handler = createSensorIngestHandler({ ...httpEnvFromDeno(), repo: new SupabaseLot6Repo(serviceClient()) })

Deno.serve(handler)
