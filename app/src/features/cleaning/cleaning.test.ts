import { describe, expect, it } from 'vitest'
import type { Checklist, CleaningTask } from '../../../../shared/payloads.ts'
import type { HaccpRecord } from '../../../../shared/types.ts'
import { validatePayload } from '../../../../shared/validation.ts'
import { DEMO_CHECKLISTS } from '../../core/mockTransport.ts'
import { buildChecklistRuns, buildCleanings, checklistPayload, diffChecklist, diffCleaning } from './model.ts'
import { checklistStatus, localDaysBetween, serviceDaysOf, summarizeCleaning, taskStatus, taskStatuses } from './schedule.ts'

const TZ = 'Europe/Paris'
const T0 = '2026-01-01T00:00:00.000Z'
const task = (frequency: CleaningTask['frequency'], name = 'Tâche'): CleaningTask => ({ id: `t-${frequency}-${name}`, name, frequency, product: null, method: null, active: true, updated_at: T0 })
// Dimanche 15/11/2026 10:00 à Paris (09:00 UTC).
const NOW = new Date('2026-11-15T09:00:00Z')
const st = (t: CleaningTask, lastAt: string | null, serviceDays?: Set<string>, now = NOW) => taskStatus({ task: t, lastAt, now, timeZone: TZ, serviceDays })

describe('échéances du plan de nettoyage (Europe/Paris)', () => {
  it('jours locaux : 23:30 Paris le 14 et 00:30 Paris le 15 sont deux jours différents', () => {
    expect(localDaysBetween('2026-11-14T22:30:00Z', '2026-11-14T23:30:00Z', TZ)).toBe(1)
    expect(localDaysBetween('2026-11-14T22:30:00Z', '2026-11-14T22:59:00Z', TZ)).toBe(0)
  })

  it('quotidienne : faite aujourd’hui → fait ; hier → à faire ; avant-hier → ambre ; il y a 4 jours → rouge', () => {
    const t = task('daily')
    expect(st(t, '2026-11-15T07:12:00Z')).toMatchObject({ state: 'done', label: 'Fait aujourd’hui à 08:12' })
    // Faite hier à 23:30 Paris (22:30 UTC) : pas en retard.
    expect(st(t, '2026-11-14T22:30:00Z')).toMatchObject({ state: 'due', lateBy: 0, label: 'À faire aujourd’hui' })
    // Faite le 14 à 00:30 Paris (13/11 23:30 UTC) : même jour local → toujours pas en retard.
    expect(st(t, '2026-11-13T23:30:00Z').state).toBe('due')
    expect(st(t, '2026-11-13T12:00:00Z')).toMatchObject({ state: 'late', lateBy: 1, label: 'En retard de 1 jour' })
    expect(st(t, '2026-11-12T12:00:00Z')).toMatchObject({ state: 'late', lateBy: 2 })
    expect(st(t, '2026-11-11T12:00:00Z')).toMatchObject({ state: 'overdue', lateBy: 3, label: 'En retard de 3 jours' })
    expect(st(t, null)).toMatchObject({ state: 'due', lateBy: 0 })
  })

  it('après service : une fois par jour de service ; services manqués → ambre puis rouge', () => {
    const t = task('after_service')
    expect(st(t, '2026-11-15T08:00:00Z').state).toBe('done')
    expect(st(t, null, new Set(['2026-11-13', '2026-11-14']))).toMatchObject({ state: 'due', label: 'À faire après le service' })
    // Dernière fois le 12 ; services le 13 et le 14 sans nettoyage → 2 services manqués.
    const days = serviceDaysOf(['2026-11-12T10:00:00Z', '2026-11-13T10:00:00Z', '2026-11-14T22:30:00Z', '2026-11-15T07:00:00Z'], TZ)
    expect([...days].sort()).toEqual(['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'])
    expect(st(t, '2026-11-12T20:00:00Z', days)).toMatchObject({ state: 'overdue', lateBy: 2, label: 'Oubliée aux 2 derniers services' })
    expect(st(t, '2026-11-13T20:00:00Z', days)).toMatchObject({ state: 'late', lateBy: 1, label: 'Oubliée au dernier service' })
    // Food truck fermé le 13 et le 14 (aucune saisie) : faite le 12 → simplement à faire.
    expect(st(t, '2026-11-12T20:00:00Z', serviceDaysOf(['2026-11-12T10:00:00Z', '2026-11-15T07:00:00Z'], TZ)).state).toBe('due')
  })

  it('hebdomadaire : 7 jours glissants depuis la dernière fois ; mensuelle : 30 jours', () => {
    const w = task('weekly')
    // Faite le dimanche 08/11 → due le dimanche 15/11.
    expect(st(w, '2026-11-08T15:00:00Z')).toMatchObject({ state: 'due', label: 'À faire aujourd’hui' })
    expect(st(w, '2026-11-09T15:00:00Z')).toMatchObject({ state: 'done', nextDue: '2026-11-16', label: 'À jour · prochaine fois le 16/11' })
    expect(st(w, '2026-11-06T15:00:00Z')).toMatchObject({ state: 'late', lateBy: 2 })
    expect(st(w, '2026-11-05T15:00:00Z')).toMatchObject({ state: 'overdue', lateBy: 3 })
    expect(st(w, null)).toMatchObject({ state: 'due', label: 'À faire' })
    const m = task('monthly')
    expect(st(m, '2026-10-20T10:00:00Z')).toMatchObject({ state: 'done', nextDue: '2026-11-19' })
    expect(st(m, '2026-10-16T10:00:00Z')).toMatchObject({ state: 'due' })
    expect(st(m, '2026-10-10T10:00:00Z')).toMatchObject({ state: 'late', lateBy: 6 })
    expect(st(m, '2026-10-09T10:00:00Z')).toMatchObject({ state: 'overdue', lateBy: 7 })
  })

  it('hebdomadaire au passage à l’heure d’hiver (25/10/2026) : due 7 jours locaux plus tard', () => {
    const w = task('weekly')
    // Faite le 22/10 à 23:30 Paris (21:30 UTC, heure d'été) → due le 29/10.
    expect(st(w, '2026-10-22T21:30:00Z', undefined, new Date('2026-10-28T22:59:00Z'))).toMatchObject({ state: 'done', nextDue: '2026-10-29' })
    expect(st(w, '2026-10-22T21:30:00Z', undefined, new Date('2026-10-28T23:01:00Z')).state).toBe('due')
  })

  it('statuts triés du plus urgent au moins urgent ; tâches désactivées ignorées ; compteurs', () => {
    const a = task('daily', 'Sols')
    const b = task('weekly', 'Hotte')
    const c = { ...task('daily', 'Ancien'), active: false }
    const d = task('daily', 'Poubelles')
    const list = taskStatuses({
      tasks: [a, b, c, d],
      lastDone: new Map([
        [a.id, '2026-11-15T07:00:00Z'],
        [b.id, '2026-11-01T07:00:00Z'],
        [d.id, '2026-11-13T07:00:00Z'],
      ]),
      now: NOW,
      timeZone: TZ,
    })
    expect(list.map((s) => [s.task.name, s.state])).toEqual([
      ['Hotte', 'overdue'],
      ['Poubelles', 'late'],
      ['Sols', 'done'],
    ])
    const s = summarizeCleaning(list, [], 1)
    expect(s).toMatchObject({ todo: 2, late: 1, overdue: 1, doneToday: 1 })
  })
})

describe('rappels des checklists', () => {
  const [opening, closing, pest] = DEMO_CHECKLISTS
  const times = ['08:00', '18:00']
  const cs = (checklist: Checklist, lastAt: string | null, now: Date) => checklistStatus({ checklist, lastAt, now, timeZone: TZ, checkTimes: times })

  it('ouverture : à faire avant le premier créneau, en retard ensuite, faite aujourd’hui → plus de rappel', () => {
    expect(cs(opening, '2026-11-14T06:30:00Z', new Date('2026-11-15T06:00:00Z'))).toMatchObject({ state: 'due', reminder: true, label: 'À faire avant 08:00' })
    expect(cs(opening, null, new Date('2026-11-15T07:30:00Z'))).toMatchObject({ state: 'late', reminder: true })
    expect(cs(opening, '2026-11-15T06:40:00Z', new Date('2026-11-15T09:00:00Z'))).toMatchObject({ state: 'done', reminder: false, label: 'Faite aujourd’hui à 07:40' })
  })

  it('fermeture : rappelée après le dernier créneau du jour ; sans heure de relevé, jamais rappelée', () => {
    expect(cs(closing, null, new Date('2026-11-15T15:00:00Z'))).toMatchObject({ state: 'upcoming', reminder: false, label: 'Après le relevé de 18:00' })
    expect(cs(closing, '2026-11-14T21:00:00Z', new Date('2026-11-15T17:05:00Z'))).toMatchObject({ state: 'due', reminder: true })
    expect(cs(closing, '2026-11-15T17:30:00Z', new Date('2026-11-15T18:00:00Z')).state).toBe('done')
    expect(checklistStatus({ checklist: closing, lastAt: null, now: NOW, timeZone: TZ, checkTimes: [] }).reminder).toBe(false)
  })

  it('nuisibles : hebdomadaire glissant', () => {
    expect(cs(pest, null, NOW)).toMatchObject({ state: 'due', reminder: true })
    expect(cs(pest, '2026-11-10T10:00:00Z', NOW)).toMatchObject({ state: 'done', reminder: false, label: 'À jour · prochain contrôle le 17/11' })
    expect(cs(pest, '2026-11-06T10:00:00Z', NOW)).toMatchObject({ state: 'late', reminder: true })
    expect(cs(pest, '2026-11-01T10:00:00Z', NOW)).toMatchObject({ state: 'overdue', reminder: true })
  })

  it('« autre » : sur demande, jamais rappelée', () => {
    expect(cs({ ...opening, kind: 'other' }, null, NOW)).toMatchObject({ state: 'none', reminder: false })
  })
})

describe('payloads et corrections', () => {
  const rec = (id: string, type: HaccpRecord['type'], payload: Record<string, unknown>, time: string, supersedes_id: string | null = null): HaccpRecord => ({
    id,
    type,
    payload,
    author_id: 'a',
    device_id: 'd',
    device_seq: 1,
    device_time: time,
    prev_hash: '0'.repeat(64),
    hash: '1'.repeat(64),
    supersedes_id,
  })

  it('all_ok = toutes les réponses ok ; validé par le contrat (sinon quarantaine serveur)', () => {
    const p = checklistPayload('00000000-0000-4000-8000-000000000551', [
      { item_id: 'gaz', ok: true, comment: '  ' },
      { item_id: 'friteuses', ok: false, comment: ' Couvercle cassé, bac couvert d’un film ' },
    ])
    expect(p).toEqual({
      checklist_id: '00000000-0000-4000-8000-000000000551',
      answers: [
        { item_id: 'gaz', ok: true },
        { item_id: 'friteuses', ok: false, comment: 'Couvercle cassé, bac couvert d’un film' },
      ],
      all_ok: false,
    })
    expect(validatePayload('checklist_done', p)).toEqual({ ok: true })
    expect(validatePayload('checklist_done', { ...p, all_ok: true }).ok).toBe(false)
    expect(checklistPayload('00000000-0000-4000-8000-000000000551', [{ item_id: 'gaz', ok: true }]).all_ok).toBe(true)
  })

  it('corrections en chaîne : payload en vigueur et différences lisibles', () => {
    const records = [
      rec('c1', 'cleaning_done', { task_id: 'A' }, '2026-11-15T08:00:00Z'),
      rec('c2', 'correction', { reason: 'Mauvaise tâche', replacement: { task_id: 'B', comment: 'fait à fond' } }, '2026-11-15T08:10:00Z', 'c1'),
      rec('k1', 'checklist_done', { checklist_id: 'L', answers: [{ item_id: 'gaz', ok: false, comment: 'fuite' }], all_ok: false }, '2026-11-15T07:00:00Z'),
      rec('k2', 'correction', { reason: 'Erreur', replacement: { checklist_id: 'L', answers: [{ item_id: 'gaz', ok: true }], all_ok: true } }, '2026-11-15T07:05:00Z', 'k1'),
    ]
    const [c] = buildCleanings(records)
    expect(c).toMatchObject({ id: 'c1', corrected: true, payload: { task_id: 'B' } })
    const name = (id: string) => (id === 'A' ? 'Sols' : 'Plans de travail')
    expect(diffCleaning(c.versions[0].payload, c.versions[1].payload, name)).toEqual([
      { label: 'Tâche', before: 'Sols', after: 'Plans de travail' },
      { label: 'Commentaire', before: '—', after: 'fait à fond' },
    ])
    const [k] = buildChecklistRuns(records)
    expect(k.payload.all_ok).toBe(true)
    expect(diffChecklist(k.versions[0].payload, k.versions[1].payload, { ...DEMO_CHECKLISTS[1] })).toEqual([{ label: 'Gaz coupé', before: 'Non (fuite)', after: 'Oui' }])
  })
})
