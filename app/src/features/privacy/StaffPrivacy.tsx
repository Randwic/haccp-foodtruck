// RGPD (lot 8) dans Gestion › Équipe : documents à remettre (note, registre) et données d'une personne
// (note remise, copie PDF, effacement après le départ).
import { useEffect, useState } from 'react'
import { errorText, type ManagedStaff } from '../../manager/api.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Badge, Button, Modal, Notice } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { IconShare } from '../../ui/icons.tsx'
import { formatIsoDay } from '../documents/model.ts'
import { shareFile } from '../documents/files.ts'
import { loadLabelFonts } from '../labels/fonts.ts'
import { ConfirmModal, useManagement } from '../management/common.tsx'
import { DEFAULT_TIMEZONE } from '../temperatures/schedule.ts'
import { canForget, DEFAULT_RETENTION_YEARS, fileSlug, todayIso, type PrivacyContext } from './model.ts'
import { buildNoticePdf, buildRegisterPdf, buildStaffExportPdf } from './pdf.ts'

type Ready = { bytes: Uint8Array; name: string; title: string } | null

function usePrivacyContext(staff: readonly ManagedStaff[]): { ctx: PrivacyContext; timeZone: string } {
  const core = useCore()
  const manager = useManager()
  const [base, setBase] = useState({ establishmentName: '', managerEmail: null as string | null, retentionYears: DEFAULT_RETENTION_YEARS, timeZone: DEFAULT_TIMEZONE })
  useEffect(() => {
    let alive = true
    void Promise.all([core.getEstablishment().catch(() => null), core.getSettings().catch(() => null), manager.sessionEmail().catch(() => null)]).then(([e, s, email]) => {
      if (alive) setBase({ establishmentName: e?.name ?? '', managerEmail: email, retentionYears: s?.retention_years ?? DEFAULT_RETENTION_YEARS, timeZone: e?.timezone || DEFAULT_TIMEZONE })
    })
    return () => {
      alive = false
    }
  }, [core, manager])
  const boss = staff.find((s) => s.role === 'manager' && s.active)
  return { ctx: { establishmentName: base.establishmentName, managerEmail: base.managerEmail, managerName: boss?.display_name ?? null, retentionYears: base.retentionYears }, timeZone: base.timeZone }
}

/** Bouton « Ouvrir / partager » après préparation (le partage iOS demande un geste de l'utilisateur). */
function ReadyFile({ ready }: { ready: Ready }) {
  if (!ready) return null
  return (
    <Button icon={<IconShare size={20} />} onClick={() => void shareFile(ready.bytes, ready.name, 'application/pdf', ready.title)}>
      Ouvrir {ready.title.toLowerCase()}
    </Button>
  )
}

function usePdf() {
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState<Ready>(null)
  const [error, setError] = useState<string | null>(null)
  const make = async (title: string, name: string, build: () => Promise<Uint8Array>) => {
    setBusy(true)
    setError(null)
    setReady(null)
    try {
      setReady({ bytes: await build(), name, title })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, ready, error, make }
}

/** Encart en haut de Gestion › Équipe. */
export function PrivacyCard({ staff }: { staff: readonly ManagedStaff[] }) {
  const { ctx, timeZone } = usePrivacyContext(staff)
  const pdf = usePdf()
  const missing = staff.filter((s) => s.active && !s.privacy_notice_on).length
  return (
    <section aria-labelledby="privacy-title" className="mb-8 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id="privacy-title" className="text-lg font-semibold text-fg">
          Données personnelles (RGPD)
        </h3>
        {missing > 0 ? <Badge tone="warn">Note à remettre : {missing}</Badge> : <Badge tone="ok">Équipe informée</Badge>}
      </div>
      <p className="mt-2 max-w-3xl text-[15px] text-fg-muted">
        Remettez la note d’information à chaque personne (à faire signer), puis notez-le sur sa fiche. Gardez le registre avec votre PMS. Saisies gardées {ctx.retentionYears} ans, puis effacées automatiquement ; le nom d’un ancien équipier est effacé automatiquement quand plus aucune de ses saisies n’est gardée.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="secondary" disabled={pdf.busy} onClick={() => void pdf.make('Note d’information', 'note-information-donnees.pdf', async () => buildNoticePdf(ctx, await loadLabelFonts(), { generatedAt: new Date(), timeZone }))}>
          Note d’information (PDF)
        </Button>
        <Button variant="secondary" disabled={pdf.busy} onClick={() => void pdf.make('Registre RGPD', 'registre-rgpd.pdf', async () => buildRegisterPdf(ctx, await loadLabelFonts(), { generatedAt: new Date(), timeZone, staff }))}>
          Registre des traitements (PDF)
        </Button>
        <ReadyFile ready={pdf.ready} />
      </div>
      {pdf.busy && <p className="mt-3 text-[15px] text-fg-muted">Préparation…</p>}
      {pdf.error && <div className="mt-3"><Notice>{pdf.error}</Notice></div>}
    </section>
  )
}

/** Fenêtre « Données personnelles » d'une personne. */
export function StaffPrivacyModal({ s, staff, onClose, onChanged }: { s: ManagedStaff; staff: readonly ManagedStaff[]; onClose: () => void; onChanged: () => void }) {
  const manager = useManager()
  const { run } = useManagement()
  const { ctx, timeZone } = usePrivacyContext(staff)
  const pdf = usePdf()
  const [confirmForget, setConfirmForget] = useState(false)
  const slug = fileSlug(s.display_name)

  const markGiven = () => run(() => manager.updateStaff(s.id, { privacy_notice_on: todayIso(new Date(), timeZone) }), 'Note d’information notée comme remise').then(onChanged)
  const exportData = () =>
    pdf.make('Copie des données', `donnees-${slug}.pdf`, async () => {
      const [records, audit, devices, fonts] = await Promise.all([manager.listStaffRecords(s.id), manager.listStaffAudit(s.id), manager.listDevices(), loadLabelFonts()])
      return buildStaffExportPdf({ staff: s, records, audit, devices, ctx, generatedAt: new Date(), timeZone }, fonts)
    })

  return (
    <Modal open title={`Données personnelles – ${s.display_name}`} onClose={onClose}>
      <div className="space-y-6">
        {s.forgotten_at ? (
          <Notice tone="info">Données personnelles effacées. Ses saisies restent dans le registre sous ce pseudonyme.</Notice>
        ) : (
          <div>
            <p className="text-[15px] font-semibold text-fg">Note d’information</p>
            <p className="mt-1 text-[15px] text-fg-muted">{s.privacy_notice_on ? `Remise le ${formatIsoDay(s.privacy_notice_on)}.` : 'Pas encore notée comme remise.'}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button variant="secondary" disabled={pdf.busy} onClick={() => void pdf.make('Note d’information', `note-information-${slug}.pdf`, async () => buildNoticePdf(ctx, await loadLabelFonts(), { personName: s.display_name, generatedAt: new Date(), timeZone }))}>
                Note à son nom (PDF)
              </Button>
              {!s.privacy_notice_on && <Button variant="secondary" onClick={() => void markGiven()}>Noter : remise aujourd’hui</Button>}
            </div>
          </div>
        )}
        <div>
          <p className="text-[15px] font-semibold text-fg">Copie de ses données</p>
          <p className="mt-1 text-[15px] text-fg-muted">Si la personne la demande : sa fiche, l’historique de son compte et toutes ses saisies.</p>
          <div className="mt-3">
            <Button variant="secondary" disabled={pdf.busy} onClick={() => void exportData()}>
              Préparer la copie (PDF)
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <ReadyFile ready={pdf.ready} />
        </div>
        {pdf.busy && <p className="text-[15px] text-fg-muted">Préparation…</p>}
        {pdf.error && <Notice>{pdf.error}</Notice>}
        {!s.forgotten_at && s.role === 'staff' && (
          <div className="border-t border-line pt-5">
            <p className="text-[15px] font-semibold text-fg">Effacer ses données</p>
            {canForget(s) ? (
              <>
                <p className="mt-1 text-[15px] text-fg-muted">Après son départ, si la personne le demande. Sinon c’est fait automatiquement quand ses saisies arrivent en fin de conservation.</p>
                <div className="mt-3">
                  <Button variant="danger" onClick={() => setConfirmForget(true)}>
                    Effacer ses données personnelles
                  </Button>
                </div>
              </>
            ) : (
              <p className="mt-1 text-[15px] text-fg-muted">Possible seulement après son départ : désactivez d’abord son compte.</p>
            )}
          </div>
        )}
      </div>
      <ConfirmModal
        open={confirmForget}
        title="Effacer ses données personnelles ?"
        confirmLabel="Effacer définitivement"
        danger
        onClose={() => setConfirmForget(false)}
        onConfirm={() => run(() => manager.forgetStaff(s.id), 'Données personnelles effacées').then(() => { setConfirmForget(false); onChanged(); onClose() })}
      >
        <p>
          Le nom <strong>{s.display_name}</strong> sera remplacé par « Ancien équipier n° … » partout, et son compte ne pourra plus jamais être réactivé. Ses saisies d’hygiène restent dans le registre (obligation légale). Pensez à préparer d’abord la copie de ses données si elle la demande.
        </p>
      </ConfirmModal>
    </Modal>
  )
}
