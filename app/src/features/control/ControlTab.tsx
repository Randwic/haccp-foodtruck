// Mode Contrôle : choisir une période, voir la synthèse (écarts, actions correctives, corrections), vérifier
// l'intégrité du registre et produire le dossier PDF / le tableau CSV à remettre à l'inspecteur.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { IntegrityReport } from '../../../../shared/payloads.ts'
import { chainHead } from '../../../../shared/testMarks.ts'
import { errorText, type ManagerApi } from '../../manager/api.ts'
import { Badge, Button, Notice, TextField, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { IconChevronRight, IconError, IconOffline, IconOk, IconPrint, IconShare, IconWarn } from '../../ui/icons.tsx'
import { PhotoGallery } from '../../ui/photos/Photos.tsx'
import { downloadFile, shareFile, toJpegBytes } from '../documents/files.ts'
import { loadLabelFonts } from '../labels/fonts.ts'
import { verifyChains } from './integrity.ts'
import { loadControlData, type ControlData } from './load.ts'
import {
  PERIOD_LABELS,
  buildControlReport,
  customRange,
  formatDay,
  formatDayTime,
  periodRange,
  statusText,
  type ControlReport,
  type ControlRow,
  type PeriodPreset,
} from './model.ts'
import { controlCsv } from './csv.ts'
import { buildControlPdf, integritySummary } from './pdf.ts'

/** Au-delà, les photos ne sont pas jointes au PDF (taille du fichier). */
const MAX_PDF_PHOTOS = 60

export function ControlTab({ manager, timeZone, onSignIn }: { manager: ManagerApi | null; timeZone: string; onSignIn?: () => void }) {
  const core = useCore()
  const toast = useToast()
  const [preset, setPreset] = useState<PeriodPreset>('30d')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [data, setData] = useState<ControlData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [integrity, setIntegrity] = useState<{ report: IntegrityReport; source: 'server' | 'device' } | null>(null)
  const [checking, setChecking] = useState(false)
  const [withPhotos, setWithPhotos] = useState(true)
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; name: string } | null>(null)
  const [building, setBuilding] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const range = useMemo(() => (preset === 'custom' ? customRange(custom.from, custom.to, timeZone) : periodRange(preset, new Date(), timeZone)), [preset, custom, timeZone])

  const load = useCallback(async () => {
    if (!range) return
    setLoading(true)
    setError(null)
    setPdf(null)
    try {
      setData(await loadControlData(core, manager, range))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [core, manager, range])
  useEffect(() => {
    void load()
  }, [load])

  const report = useMemo<ControlReport | null>(
    () => (data && range ? buildControlReport({ records: data.records, pendingIds: data.pendingIds, from: range.from, to: range.to, refs: data.refs }) : null),
    [data, range],
  )

  /** « Saisie de test » : correction qui garde la valeur et marque la saisie ; rien n'est effacé du registre. */
  const markTest = async (row: ControlRow, reason: string): Promise<boolean> => {
    const head = data ? chainHead(data.records, row.id) : null
    if (!head) {
      toast('Saisie introuvable dans le registre chargé', 'error')
      return false
    }
    try {
      await core.addRecord('correction', { reason: reason.trim(), replacement: head.payload, test: true }, { supersedes_id: head.id })
      toast('Saisie marquée « test » : elle reste au registre mais n’est plus reprise dans le dossier', 'ok')
      await load()
      return true
    } catch (e) {
      toast(errorText(e), 'error')
      return false
    }
  }

  const verify = async () => {
    if (!data) return
    setChecking(true)
    try {
      if (data.source === 'server' && manager) setIntegrity({ report: await manager.verifyIntegrity(), source: 'server' })
      else {
        const local = await core.listRecords()
        setIntegrity({ report: await verifyChains(local, data.refs.deviceName, { complete: false }), source: 'device' })
      }
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setChecking(false)
    }
  }

  const fileBase = report ? `controle-sanitaire-${report.from.slice(0, 10)}-au-${formatDay(report.to, timeZone).split('/').reverse().join('-')}` : 'controle'

  const makePdf = async () => {
    if (!report || !data) return
    setBuilding('Préparation du dossier…')
    try {
      const photos: { row: ControlRow; bytes: Uint8Array; kind: 'jpg' }[] = []
      if (withPhotos) {
        const rows = report.modules.flatMap((m) => m.rows).filter((r) => r.photos.length > 0)
        for (const row of rows) {
          for (const path of row.photos) {
            if (photos.length >= MAX_PDF_PHOTOS) break
            setBuilding(`Photos : ${photos.length + 1}…`)
            let blob = await core.getPhoto(path).catch(() => null)
            if (!blob && manager) blob = await manager.downloadPhoto(path).catch(() => null)
            const bytes = blob ? await toJpegBytes(blob, 900) : null
            if (bytes) photos.push({ row, bytes, kind: 'jpg' })
          }
        }
      }
      setBuilding('Mise en page…')
      const bytes = await buildControlPdf(
        {
          report,
          establishmentName: data.establishmentName,
          timeZone,
          generatedAt: new Date(),
          source: data.source,
          deviceCount: data.devices.length,
          integrity: integrity?.report ?? null,
          staff: data.staff,
          equipment: data.equipment,
          thresholds: data.thresholds,
          documents: data.documents,
          photos,
        },
        await loadLabelFonts(),
      )
      setPdf({ bytes, name: `${fileBase}.pdf` })
    } catch (e) {
      toast(`Dossier impossible : ${errorText(e)}`, 'error')
    } finally {
      setBuilding(null)
    }
  }

  const csv = () => {
    if (!report) return
    const blob = new Blob([controlCsv(report, timeZone)], { type: 'text/csv;charset=utf-8' })
    void shareFile(blob, `${fileBase}.csv`, 'text/csv', 'Registres HACCP (tableau)').catch(() => downloadFile(blob, `${fileBase}.csv`))
  }

  return (
    <section aria-labelledby="control-title" className="space-y-8">
      <h2 id="control-title" className="sr-only">
        Mode Contrôle
      </h2>
      <p className="max-w-3xl text-[17px] text-fg-muted">
        Lors d’un contrôle, choisissez la période demandée : l’application rassemble tous les relevés, les écarts et ce qui a été fait, puis prépare un dossier PDF à montrer ou à envoyer.
      </p>

      {/* Période */}
      <div>
        <p className="mb-2 text-[15px] font-semibold text-fg">Période</p>
        <div role="radiogroup" aria-label="Période" className="flex flex-wrap gap-2">
          {([...Object.keys(PERIOD_LABELS), 'custom'] as PeriodPreset[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={preset === p}
              onClick={() => setPreset(p)}
              className={`min-h-12 rounded-full border px-4 text-[15px] font-semibold ${preset === p ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-elevated text-fg active:bg-pressed'}`}
            >
              {p === 'custom' ? 'Autres dates' : PERIOD_LABELS[p as Exclude<PeriodPreset, 'custom'>]}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="mt-4 grid max-w-xl gap-4 sm:grid-cols-2">
            <TextField label="Du" type="date" value={custom.from} onChange={(v) => setCustom({ ...custom, from: v })} />
            <TextField label="Au" type="date" value={custom.to} onChange={(v) => setCustom({ ...custom, to: v })} error={custom.from && custom.to && !range ? 'La fin doit être après le début.' : undefined} />
          </div>
        )}
        {range && <p className="mt-3 text-[15px] text-fg-muted">Du {formatDay(range.from.toISOString(), timeZone)} au {formatDay(range.to.toISOString(), timeZone)}</p>}
      </div>

      {error && <Notice>{error}</Notice>}
      {loading && !data && <p className="text-[17px] text-fg-muted">Chargement du registre…</p>}

      {data && report && (
        <>
          {data.source === 'device' ? (
            <div className="flex flex-wrap items-start gap-4 rounded-2xl border border-warn/35 bg-warn-soft p-4 sm:p-5">
              <IconOffline size={22} className="mt-0.5 shrink-0 text-warn" />
              <div className="min-w-0 flex-1 basis-48 text-[16px] text-fg">
                <p className="font-semibold">Saisies de cet appareil seulement.</p>
                <p className="text-fg-muted">
                  {data.fallbackReason ?? 'Sans connexion gérant, l’application ne lit que ce qui a été saisi sur cet appareil.'} Connectez-vous pour inclure tout le registre (tous les appareils) et les documents.
                </p>
              </div>
              {onSignIn && <Button variant="secondary" onClick={onSignIn}>Se connecter</Button>}
            </div>
          ) : (
            <Notice tone="info">
              Registre complet du serveur ({data.devices.length} appareil{data.devices.length > 1 ? 's' : ''}){report.totals.pending ? `, plus ${report.totals.pending} saisie(s) de cet appareil pas encore envoyée(s)` : ''}.
            </Notice>
          )}

          {/* Chiffres clés */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Saisies" value={report.totals.entries} />
            <Stat label="Écarts" value={report.totals.nonConform} tone={report.totals.nonConform ? 'warn' : 'ok'} />
            <Stat label="Sans action corrective" value={report.totals.missingActions} tone={report.totals.missingActions ? 'danger' : 'ok'} />
            <Stat label="Saisies corrigées" value={report.totals.corrected} />
          </div>

          {/* Intégrité */}
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1 basis-48">
                <h3 className="text-lg font-semibold text-fg">Intégrité du registre</h3>
                <p className="text-[15px] text-fg-muted">Prouve qu’aucune saisie n’a été modifiée, retirée ou ajoutée après coup.</p>
              </div>
              <Button variant="secondary" onClick={verify} disabled={checking}>
                {checking ? 'Vérification…' : integrity ? 'Vérifier à nouveau' : 'Vérifier'}
              </Button>
            </div>
            {integrity && (
              <p className={`mt-3 flex items-start gap-2 text-[16px] font-semibold ${integrity.report.ok ? 'text-ok' : 'text-danger'}`}>
                {integrity.report.ok ? <IconOk size={20} className="mt-0.5 shrink-0" /> : <IconError size={20} className="mt-0.5 shrink-0" />}
                {integritySummary(integrity.report, integrity.source)}
              </p>
            )}
          </div>

          {/* Export */}
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
            <h3 className="text-lg font-semibold text-fg">Dossier pour l’inspecteur</h3>
            <p className="text-[15px] text-fg-muted">
              PDF : synthèse, {integrity ? 'résultat de la vérification, ' : ''}écarts et actions correctives, chaque registre en détail, équipements, équipe{data.documents ? ', liste des documents' : ''}.{' '}
              {!integrity && 'Faites d’abord « Vérifier » pour y joindre la preuve d’intégrité.'}
            </p>
            <label className="mt-3 flex min-h-12 items-center gap-3 text-[16px] text-fg">
              <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} className="h-6 w-6 accent-[var(--accent)]" />
              Joindre les photos ({Math.min(report.totals.photos, MAX_PDF_PHOTOS)}
              {report.totals.photos > MAX_PDF_PHOTOS ? ` sur ${report.totals.photos}` : ''})
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              {pdf ? (
                <Button icon={<IconShare size={20} />} onClick={() => void shareFile(pdf.bytes, pdf.name, 'application/pdf', 'Dossier contrôle sanitaire')}>
                  Ouvrir le dossier PDF
                </Button>
              ) : (
                <Button icon={<IconPrint size={20} />} onClick={makePdf} disabled={!!building || report.totals.entries === 0}>
                  {building ?? 'Préparer le dossier PDF'}
                </Button>
              )}
              <Button variant="secondary" onClick={csv} disabled={report.totals.entries === 0}>
                Tableau CSV (Excel)
              </Button>
              {pdf && (
                <Button variant="ghost" onClick={() => setPdf(null)}>
                  Refaire le dossier
                </Button>
              )}
            </div>
          </div>

          {/* Écarts */}
          <div>
            <h3 className="mb-3 text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">Écarts et actions correctives ({report.nonConformities.length})</h3>
            {report.nonConformities.length === 0 ? (
              <p className="rounded-2xl border border-line bg-surface p-5 text-[17px] text-fg-muted shadow-card">Aucun écart sur la période.</p>
            ) : (
              <ul className="space-y-3">
                {report.nonConformities.map((r) => (
                  <RowCard key={r.id} row={r} timeZone={timeZone} module={report.modules.find((m) => m.module === r.module)?.short} onMarkTest={TEST_MARKABLE.has(r.module) ? markTest : undefined} />
                ))}
              </ul>
            )}
          </div>

          {/* Registres */}
          <div>
            <h3 className="mb-3 text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">Registres de la période</h3>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              {report.modules
                .filter((m) => m.total > 0)
                .map((m) => (
                  <li key={m.module}>
                    <button
                      type="button"
                      onClick={() => setOpen(open === m.module ? null : m.module)}
                      aria-expanded={open === m.module}
                      className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left active:bg-pressed sm:px-5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[17px] font-semibold text-fg">{m.title}</span>
                        <span className="text-[15px] text-fg-muted">
                          {m.total} saisie{m.total > 1 ? 's' : ''}
                          {m.corrected ? ` · ${m.corrected} corrigée${m.corrected > 1 ? 's' : ''}` : ''}
                        </span>
                      </span>
                      {m.missingActions > 0 ? (
                        <Badge tone="error">
                          <IconError size={14} strokeWidth={2.25} />
                          {m.missingActions} sans action
                        </Badge>
                      ) : m.nonConform > 0 ? (
                        <Badge tone="warn">
                          <IconWarn size={14} strokeWidth={2.25} />
                          {m.nonConform} écart{m.nonConform > 1 ? 's' : ''}
                        </Badge>
                      ) : (
                        <Badge tone="ok">
                          <IconOk size={14} strokeWidth={2.25} />
                          Conforme
                        </Badge>
                      )}
                      <IconChevronRight size={20} className={`shrink-0 text-fg-subtle transition-transform ${open === m.module ? 'rotate-90' : ''}`} />
                    </button>
                    {open === m.module && (
                      <ul className="space-y-3 bg-sunken p-3 sm:p-4">
                        {[...m.rows].reverse().map((r) => (
                          <RowCard key={r.id} row={r} timeZone={timeZone} onMarkTest={TEST_MARKABLE.has(r.module) ? markTest : undefined} />
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
            </ul>
            {report.totals.entries === 0 && <p className="mt-3 text-[17px] text-fg-muted">Aucune saisie sur la période.</p>}
            {(report.tests > 0 || report.quarantined > 0) && (
              <p className="mt-3 text-[15px] text-fg-subtle">
                {[report.tests ? `${report.tests} saisie(s) de test` : '', report.quarantined ? `${report.quarantined} saisie(s) refusée(s) par le serveur` : ''].filter(Boolean).join(' et ')} non repris dans le dossier.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' | 'danger' }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-fg'
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <p className={`text-[30px] leading-none font-bold tabular-nums ${color}`}>{value.toLocaleString('fr-FR')}</p>
      <p className="mt-2 text-[15px] text-fg-muted">{label}</p>
    </div>
  )
}

/** Modules dont une ligne = une saisie (les lots chronométrés regroupent plusieurs saisies). */
const TEST_MARKABLE = new Set<ControlRow['module']>(['temperatures', 'reception', 'cooking', 'labels', 'waste', 'cleaning', 'checklists', 'oil'])
const DEFAULT_TEST_REASON = 'Saisie de test (mise en route de l’application)'

function RowCard({
  row: r,
  timeZone,
  module,
  onMarkTest,
}: {
  row: ControlRow
  timeZone: string
  module?: string
  onMarkTest?: (row: ControlRow, reason: string) => Promise<boolean>
}) {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState(DEFAULT_TEST_REASON)
  const [saving, setSaving] = useState(false)
  const confirm = async () => {
    if (!onMarkTest || !reason.trim()) return
    setSaving(true)
    const done = await onMarkTest(r, reason)
    setSaving(false)
    if (done) setAsking(false)
  }
  return (
    <li className={`rounded-2xl border bg-surface p-4 ${r.missingAction ? 'border-danger/55' : r.status === 'ko' ? 'border-warn/55' : 'border-line'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-[14px] text-fg-muted">
            {formatDayTime(r.time, timeZone)}
            {module ? ` · ${module}` : ''} · {r.author}
            {r.pending ? ' · pas encore envoyée' : ''}
          </p>
          <p className="text-[17px] font-semibold text-fg">{r.subject}</p>
          <p className="text-[16px] text-fg">{r.detail}</p>
        </div>
        {r.status === 'ko' ? (
          <Badge tone="error">
            <IconWarn size={14} strokeWidth={2.25} />
            {statusText(r)}
          </Badge>
        ) : r.status === 'ok' ? (
          <Badge tone="ok">
            <IconOk size={14} strokeWidth={2.25} />
            Conforme
          </Badge>
        ) : r.status === 'running' ? (
          <Badge tone="warn">{statusText(r)}</Badge>
        ) : null}
      </div>
      {r.actions.map((a) => (
        <p key={a} className="mt-2 flex items-start gap-2 text-[15px] text-fg">
          <IconOk size={18} className="mt-0.5 shrink-0 text-ok" />
          Action corrective : {a}
        </p>
      ))}
      {r.missingAction && (
        <p className="mt-2 flex items-start gap-2 text-[15px] font-semibold text-danger">
          <IconError size={18} className="mt-0.5 shrink-0" />
          Aucune action corrective enregistrée
        </p>
      )}
      {r.corrections.map((c) => (
        <p key={c.time} className="mt-2 text-[15px] text-fg-muted">
          Corrigé le {formatDayTime(c.time, timeZone)} par {c.author} ({c.reason || 'motif non précisé'}) — avant : <span className="line-through">{c.before}</span>
        </p>
      ))}
      {r.photos.length > 0 && (
        <div className="mt-3">
          <PhotoGallery paths={r.photos} label={r.subject} />
        </div>
      )}
      {onMarkTest &&
        (asking ? (
          <div className="mt-3 rounded-xl border border-line bg-sunken p-3">
            <p className="mb-2 text-[15px] text-fg">
              La saisie reste dans le registre (rien n’est effacé), mais elle ne sera plus reprise dans les écrans ni dans le dossier de contrôle.
            </p>
            <TextField label="Motif" value={reason} onChange={setReason} maxLength={200} />
            <div className="mt-3 flex flex-wrap gap-3">
              <Button onClick={() => void confirm()} disabled={saving || !reason.trim()}>
                {saving ? 'Enregistrement…' : 'Confirmer : saisie de test'}
              </Button>
              <Button variant="ghost" onClick={() => setAsking(false)} disabled={saving}>
                Annuler
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <Button variant="ghost" onClick={() => setAsking(true)}>
              Marquer comme saisie de test
            </Button>
          </div>
        ))}
    </li>
  )
}
