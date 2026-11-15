// Adaptateur Deno (lot 7) : lecture du registre pour verify-integrity via supabase-js (service_role).
// Non couvert par Vitest (logique dans _shared/verify_integrity.ts, testée en mémoire).
import type { ChainAnchor, IntegrityRecordRow, IntegrityRepo } from '../_shared/verify_integrity.ts'
import { DbError, SupabaseRepo } from './supabase_repo.ts'

/** PostgREST plafonne chaque réponse (max_rows = 1000) : lecture par pages. */
const PAGE = 1000

export class SupabaseIntegrityRepo extends SupabaseRepo implements IntegrityRepo {
  async listDevicesForIntegrity(): Promise<{ id: string; name: string }[]> {
    const out: { id: string; name: string }[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db.from('devices').select('id, name').order('id').range(from, from + PAGE - 1)
      if (error) throw new DbError('devices.select', error)
      const rows = (data ?? []) as { id: string; name: string }[]
      out.push(...rows)
      if (rows.length < PAGE) return out
    }
  }

  async listChainAnchors(): Promise<ChainAnchor[]> {
    const out: ChainAnchor[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db
        .from('record_chain_anchors')
        .select('device_id, device_seq, hash')
        .order('device_id')
        .range(from, from + PAGE - 1)
      if (error) throw new DbError('record_chain_anchors.select', error)
      const rows = (data ?? []) as { device_id: string; device_seq: number | string; hash: string }[]
      out.push(...rows.map((a) => ({ device_id: a.device_id, device_seq: Number(a.device_seq), hash: a.hash })))
      if (rows.length < PAGE) return out
    }
  }

  /** Pagination par clé (device_seq > afterSeq), stable même si des enregistrements arrivent pendant la lecture. */
  async listDeviceRecords(deviceId: string, afterSeq: number, limit: number): Promise<IntegrityRecordRow[]> {
    const { data, error } = await this.db
      .from('records')
      .select('id, type, payload, author_id, device_id, device_seq, device_time, prev_hash, hash, supersedes_id')
      .eq('device_id', deviceId)
      .gt('device_seq', afterSeq)
      .order('device_seq', { ascending: true })
      .limit(Math.min(limit, PAGE))
    if (error) throw new DbError('records.select', error)
    return ((data ?? []) as (Omit<IntegrityRecordRow, 'device_seq'> & { device_seq: number | string })[]).map((r) => ({
      ...r,
      device_seq: Number(r.device_seq),
    }))
  }

  async recordIntegrityCheck(userId: string, summary: Record<string, unknown>): Promise<void> {
    const { error } = await this.db.rpc('record_integrity_check', { p_user_id: userId, p_summary: summary })
    if (error) throw new DbError('record_integrity_check', error)
  }
}
