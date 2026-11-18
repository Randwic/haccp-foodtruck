// Documents & contrôle › RGPD : registre des traitements et note d'information de l'équipe (PDF prêts à
// imprimer ou à partager), avec l'identité de l'établissement reprise de l'assistant PMS.
import { useCallback, useEffect, useState } from 'react'
import { errorText, type ManagerApi } from '../../manager/api.ts'
import { Button, Notice } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { IconCheck, IconShare, IconWarn } from '../../ui/icons.tsx'
import { shareFile } from '../documents/files.ts'
import { loadLabelFonts } from '../labels/fonts.ts'
import { defaultAnswers } from '../pms/model.ts'
import { savedPmsAnswers } from '../pms/saved.ts'
import { GOOD_PRACTICES, missingIdentity, type RgpdContext } from './model.ts'
import { buildRegisterPdf, buildStaffNoticePdf } from './pdf.ts'

type Kind = 'register' | 'notice'
const FILES: Record<Kind, { title: string; file: string; what: string }> = {
  register: { title: 'Registre des traitements', file: 'registre-des-traitements-rgpd.pdf', what: 'À garder avec votre plan de maîtrise sanitaire. Il décrit les données de l’équipe que l’application utilise, pourquoi et combien de temps.' },
  notice: { title: 'Note d’information de l’équipe', file: 'information-equipe-rgpd.pdf', what: 'À remettre à chaque employé (et à faire signer) avant sa première saisie.' },
}

export function RgpdTab({ manager, timeZone }: { manager: ManagerApi | null; timeZone: string }) {
  const core = useCore()
  const [ctx, setCtx] = useState<RgpdContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Kind | null>(null)
  const [pdf, setPdf] = useState<{ kind: Kind; bytes: Uint8Array } | null>(null)

  const load = useCallback(async () => {
    const [establishment, settings, staff] = await Promise.all([core.getEstablishment(), core.getSettings(), core.listStaff()])
    const defaults = defaultAnswers({ establishmentName: establishment?.name ?? '', ownerName: staff.find((s) => s.role === 'manager' && s.active)?.display_name ?? '' })
    const known = (await savedPmsAnswers(manager, defaults))?.answers ?? defaults
    setCtx({
      legalName: known.legal_name,
      owner: known.owner,
      address: known.address,
      siret: known.siret,
      contact: known.contact,
      retentionYears: settings?.retention_years ?? 3,
      staffCount: staff.filter((s) => s.active).length,
    })
  }, [core, manager])
  useEffect(() => {
    load().catch((e: unknown) => setError(errorText(e)))
  }, [load])

  const make = async (kind: Kind) => {
    if (!ctx) return
    setBusy(kind)
    setError(null)
    try {
      const edited = `Établi le ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone }).format(new Date())}`
      const fonts = await loadLabelFonts()
      const bytes = kind === 'register' ? await buildRegisterPdf(ctx, fonts, edited) : await buildStaffNoticePdf(ctx, fonts, edited)
      setPdf({ kind, bytes })
    } catch (e) {
      setError(`PDF impossible : ${errorText(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const missing = ctx ? missingIdentity(ctx) : []

  return (
    <section aria-labelledby="rgpd-title" className="space-y-5">
      <div>
        <h2 id="rgpd-title" className="text-xl font-semibold text-fg">
          Données personnelles (RGPD)
        </h2>
        <p className="mt-1 max-w-2xl text-[16px] text-fg-muted">
          L’application garde le nom de chaque membre de l’équipe sur ses saisies. La loi demande de tenir un registre de ces données et d’en informer l’équipe : les deux documents sont prêts ci-dessous.
        </p>
      </div>
      {error && <Notice>{error}</Notice>}
      {!ctx && !error && <p className="text-[17px] text-fg-muted">Chargement…</p>}
      {missing.length > 0 && (
        <Notice tone="warn">
          À compléter dans l’onglet « Plan (PMS) », étape 1 : {missing.join(', ')}. Ces informations apparaîtront dans le registre.
        </Notice>
      )}
      {ctx && (
        <div className="grid gap-4 lg:grid-cols-2">
          {(Object.keys(FILES) as Kind[]).map((kind) => (
            <div key={kind} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
              <h3 className="text-lg font-semibold text-fg">{FILES[kind].title}</h3>
              <p className="flex-1 text-[15px] text-fg-muted">{FILES[kind].what}</p>
              <div className="flex flex-wrap gap-3">
                <Button variant={pdf?.kind === kind ? 'secondary' : 'primary'} onClick={() => void make(kind)} disabled={busy !== null}>
                  {busy === kind ? 'Préparation…' : pdf?.kind === kind ? 'Refaire le PDF' : 'Créer le PDF'}
                </Button>
                {pdf?.kind === kind && (
                  <Button icon={<IconShare size={20} />} onClick={() => void shareFile(pdf.bytes, FILES[kind].file, 'application/pdf', FILES[kind].title)}>
                    Partager / imprimer
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-fg">
          <IconWarn size={20} className="text-warn" />
          Les bons réflexes
        </h3>
        <ul className="mt-3 space-y-2">
          {GOOD_PRACTICES.map((g) => (
            <li key={g} className="flex items-start gap-2 text-[16px] text-fg">
              <IconCheck size={18} className="mt-1 shrink-0 text-ok" />
              {g}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
