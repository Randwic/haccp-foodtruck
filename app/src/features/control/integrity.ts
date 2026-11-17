// Vérification de la chaîne de hachage d'un ensemble d'enregistrements (fonction pure, côté appareil).
// Même règles que l'Edge Function `verify-integrity` (sans les ancres de purge) : hash recalculé,
// `prev_hash` = hash du maillon précédent (GENESIS_HASH pour le premier), numérotation sans trou.
// Sert au serveur simulé et à la vérification hors-ligne des saisies de cet appareil.
import { computeRecordHash } from '../../../../shared/canonical.ts'
import type { IntegrityReport } from '../../../../shared/payloads.ts'
import { GENESIS_HASH, type HaccpRecord } from '../../../../shared/types.ts'

type Problem = IntegrityReport['devices'][number]['problems'][number]

/**
 * `complete` : la chaîne doit commencer au maillon 1 (registre entier). Sinon (extrait), le premier
 * maillon présent sert de point de départ et seuls les liens internes sont vérifiés.
 */
export async function verifyChains(
  records: readonly HaccpRecord[],
  deviceName: (deviceId: string) => string,
  opts: { complete?: boolean; now?: Date } = {},
): Promise<IntegrityReport> {
  const complete = opts.complete ?? true
  const byDevice = new Map<string, HaccpRecord[]>()
  for (const r of records) byDevice.set(r.device_id, [...(byDevice.get(r.device_id) ?? []), r])
  const devices: IntegrityReport['devices'] = []
  for (const [device_id, list] of byDevice) {
    list.sort((a, b) => a.device_seq - b.device_seq)
    const problems: Problem[] = []
    let prev: HaccpRecord | null = null
    for (const r of list) {
      const hash = await computeRecordHash(r)
      if (hash !== r.hash) problems.push({ device_seq: r.device_seq, record_id: r.id, problem: 'hash_mismatch' })
      if (prev === null) {
        if (complete && r.device_seq !== 1) problems.push({ device_seq: r.device_seq, record_id: r.id, problem: 'seq_gap' })
        if (r.device_seq === 1 && r.prev_hash !== GENESIS_HASH) problems.push({ device_seq: r.device_seq, record_id: r.id, problem: 'broken_chain' })
      } else if (r.device_seq !== prev.device_seq + 1) {
        problems.push({ device_seq: r.device_seq, record_id: r.id, problem: 'seq_gap' })
      } else if (r.prev_hash !== prev.hash) {
        problems.push({ device_seq: r.device_seq, record_id: r.id, problem: 'broken_chain' })
      }
      prev = r
    }
    devices.push({
      device_id,
      device_name: deviceName(device_id),
      records: list.length,
      first_seq: list[0]?.device_seq ?? 0,
      last_seq: list[list.length - 1]?.device_seq ?? 0,
      ok: problems.length === 0,
      problems,
    })
  }
  devices.sort((a, b) => a.device_name.localeCompare(b.device_name, 'fr') || a.device_id.localeCompare(b.device_id))
  return {
    checked_at: (opts.now ?? new Date()).toISOString(),
    total_records: records.length,
    devices,
    anchors_used: 0,
    ok: devices.every((d) => d.ok),
  }
}
