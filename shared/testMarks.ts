// Saisies marquées « saisie de test » : une correction `{ test: true }` vise la saisie (ou sa dernière
// correction). Le registre reste append-only : rien n'est effacé, la saisie et sa chaîne de corrections
// sont seulement écartées des écrans et du dossier de contrôle (comptées à part comme essais).
import type { HaccpRecord } from './types.ts'

type Rec = Pick<HaccpRecord, 'id' | 'type' | 'supersedes_id' | 'payload'>

function isTestCorrection(r: Rec): boolean {
  return r.type === 'correction' && r.supersedes_id !== null && typeof r.payload === 'object' && r.payload !== null && (r.payload as Record<string, unknown>).test === true
}

/** Racine (saisie d'origine) de chaque enregistrement : une correction est rattachée à l'origine de sa chaîne. */
function rootsOf(records: readonly Rec[]): Map<string, string> {
  const byId = new Map(records.map((r) => [r.id, r]))
  const memo = new Map<string, string>()
  const rootOf = (id: string): string => {
    const known = memo.get(id)
    if (known) return known
    const seen: string[] = []
    let cur = id
    for (let i = 0; i < 1000; i++) {
      seen.push(cur)
      const r = byId.get(cur)
      if (!r || r.type !== 'correction' || !r.supersedes_id) break
      cur = r.supersedes_id
    }
    for (const s of seen) memo.set(s, cur)
    return cur
  }
  for (const r of records) rootOf(r.id)
  return memo
}

/** Ids des saisies d'origine marquées « test ». */
export function testMarkedRoots(records: readonly Rec[]): Set<string> {
  if (!records.some(isTestCorrection)) return new Set()
  const roots = rootsOf(records)
  return new Set(records.filter(isTestCorrection).map((r) => roots.get(r.id)!))
}

/** Les enregistrements sans les saisies marquées « test » ni leurs corrections et actions correctives. */
export function withoutTestMarked<R extends Rec>(records: readonly R[]): R[] {
  const marked = testMarkedRoots(records)
  if (marked.size === 0) return [...records]
  const roots = rootsOf(records)
  return records.filter((r) => {
    if (marked.has(roots.get(r.id)!)) return false
    if (r.type === 'corrective_action' && typeof r.payload === 'object' && r.payload !== null) {
      const rel = (r.payload as Record<string, unknown>).related_record_id
      if (typeof rel === 'string' && marked.has(roots.get(rel) ?? rel)) return false
    }
    return true
  })
}

/** Dernier enregistrement de la chaîne d'une saisie (celui que vise une nouvelle correction) et sa valeur en vigueur. */
export function chainHead(records: readonly Rec[], rootId: string): { id: string; type: string; payload: Record<string, unknown> } | null {
  const root = records.find((r) => r.id === rootId)
  if (!root) return null
  let head: Rec = root
  for (let i = 0; i < 1000; i++) {
    const next = records.find((r) => r.type === 'correction' && r.supersedes_id === head.id)
    if (!next) break
    head = next
  }
  const payload = head === root ? root.payload : (head.payload as Record<string, unknown>).replacement
  return typeof payload === 'object' && payload !== null ? { id: head.id, type: root.type, payload: payload as Record<string, unknown> } : null
}
