// JSON canonique : clés triées (ordre des points de code UTF-16, comme Array.prototype.sort),
// aucun espace, nombres au format JSON standard, `undefined` interdit.
import type { RecordCore } from './types.ts'

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalJson: nombre non fini')
    return JSON.stringify(value)
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return (
      '{' +
      keys
        .map((k) => {
          if (obj[k] === undefined) throw new Error(`canonicalJson: valeur undefined pour "${k}"`)
          return JSON.stringify(k) + ':' + canonicalJson(obj[k])
        })
        .join(',') +
      '}'
    )
  }
  throw new Error(`canonicalJson: type non supporté (${typeof value})`)
}

export function recordCoreOf(r: RecordCore): RecordCore {
  return {
    id: r.id,
    type: r.type,
    payload: r.payload,
    author_id: r.author_id,
    device_id: r.device_id,
    device_seq: r.device_seq,
    device_time: r.device_time,
    prev_hash: r.prev_hash,
    supersedes_id: r.supersedes_id,
  }
}

/** SHA-256 hex minuscules de canonicalJson(RecordCore). WebCrypto : dispo navigateur, Deno, Node 20+. */
export async function computeRecordHash(r: RecordCore): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(recordCoreOf(r)))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
