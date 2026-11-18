// Rappel produit (gérant) : saisir ou scanner le n° de lot (ou le code-barres) d'un produit rappelé,
// voir quand il a été acheté, ce qui a été préparé avec, ce qui a déjà été jeté ; noter le retrait
// des produits encore en stock ; éditer la fiche de rappel (PDF).
// Registre du serveur (tous les appareils) si le gérant est connecté, sinon saisies de cet appareil.
import { useState, type FormEvent } from 'react'
import type { LabelPrintedPayload, ReceptionItem, WastePayload } from '../../../../shared/payloads.ts'
import type { RecordType } from '../../../../shared/types.ts'
import { LIMITS } from '../../../../shared/validation.ts'
import { errorText, type ManagerApi } from '../../manager/api.ts'
import { Badge, Button, Modal, Notice, TextField, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { IconBarcode, IconOffline, IconOk, IconPrint, IconRecall, IconShare, IconWarn, IconWaste } from '../../ui/icons.tsx'
import { formatDayTime } from '../control/model.ts'
import { loadControlData, type ControlData } from '../control/load.ts'
import { shareFile } from '../documents/files.ts'
import { loadLabelFonts } from '../labels/fonts.ts'
import { KIND_TITLES, formatLabelDateTime } from '../labels/model.ts'
import { useRecordSaver } from '../processes/common.tsx'
import { receptionExtensions } from '../reception/extensions.ts'
import { STORAGE_LABELS, WASTE_REASON_LABELS, frenchDate } from '../reception/model.ts'
import { parseRecallQuery, toWithdraw, traceRecall, withdrawalPayload, type ReceptionHit, type RecallResult } from './model.ts'
import { buildRecallPdf, recallTitle } from './pdf.ts'
import type { Entry } from '../processes/entries.ts'

/** Profondeur de recherche : 2 ans (produits surgelés compris). */
const RECALL_LOOKBACK_DAYS = 731
const RECALL_TYPES: readonly RecordType[] = ['reception', 'label_printed', 'waste']

type Withdrawal = { kind: 'reception'; hit: ReceptionHit; item: ReceptionItem } | { kind: 'label'; entry: Entry<LabelPrintedPayload> }

export function RecallTab({ manager, timeZone, onSignIn }: { manager: ManagerApi | null; timeZone: string; onSignIn?: () => void }) {
  const core = useCore()
  const toast = useToast()
  const ext = receptionExtensions()
  const [text, setText] = useState('')
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<{ data: ControlData; result: RecallResult } | null>(null)
  const [withdraw, setWithdraw] = useState<Withdrawal | null>(null)
  const [building, setBuilding] = useState(false)
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; name: string } | null>(null)

  const search = async (q: string) => {
    const query = parseRecallQuery(q)
    if (!query.lot && !query.gtin) return
    setLoading(true)
    setError(null)
    setPdf(null)
    try {
      const to = new Date()
      const from = new Date(to.getTime() - RECALL_LOOKBACK_DAYS * 86_400_000)
      const data = await loadControlData(core, manager, { from, to, types: RECALL_TYPES })
      setFound({ data, result: traceRecall(data.records, query) })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void search(text)
  }

  const makePdf = async () => {
    if (!found) return
    setBuilding(true)
    try {
      const bytes = await buildRecallPdf(
        {
          result: found.result,
          establishmentName: found.data.establishmentName,
          timeZone,
          generatedAt: new Date(),
          source: found.data.source,
          supplierName: found.data.refs.supplierName,
          staffName: found.data.refs.staffName,
        },
        await loadLabelFonts(),
      )
      const slug = recallTitle(found.result).replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 40)
      setPdf({ bytes, name: `rappel-produit-${slug}.pdf` })
    } catch (e) {
      toast(`Fiche impossible : ${errorText(e)}`, 'error')
    } finally {
      setBuilding(false)
    }
  }

  const r = found?.result
  const total = r ? r.receptions.length + r.labels.length + r.wastes.length : 0
  const labelWithdrawn = (id: string) => !!r?.wastes.some((w) => w.entry.payload.reason === 'recall' && w.entry.versions.some((v) => v.payload.related_record_id === id))
  const pendingCount = r ? r.receptions.reduce((n, h) => n + toWithdraw(h).length, 0) + r.labels.filter((h) => !labelWithdrawn(h.entry.id)).length : 0

  return (
    <section aria-labelledby="recall-title" className="space-y-8">
      <h2 id="recall-title" className="sr-only">
        Rappel produit
      </h2>
      <p className="max-w-3xl text-[17px] text-fg-muted">
        Un produit que vous avez acheté fait l’objet d’un rappel (avis du fournisseur, de Metro ou de RappelConso) ? Saisissez son n° de lot, ou scannez son code-barres : l’application retrouve quand vous l’avez acheté, ce
        que vous avez préparé avec, et ce qui a déjà été jeté.
      </p>

      <form onSubmit={submit} className="flex max-w-2xl flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <TextField label="N° de lot ou code-barres" value={text} onChange={setText} maxLength={100} placeholder="Ex. : L23115A ou 3017620422003" autoCapitalize="characters" />
        </div>
        <Button type="submit" icon={<IconRecall size={20} />} disabled={loading || !text.trim()}>
          {loading ? 'Recherche…' : 'Chercher'}
        </Button>
        {ext.BarcodeScanner && (
          <Button variant="secondary" icon={<IconBarcode size={20} />} onClick={() => setScanning(true)}>
            Scanner
          </Button>
        )}
      </form>
      {scanning && ext.BarcodeScanner && (
        <ext.BarcodeScanner
          onResult={(read) => {
            setScanning(false)
            const q = read?.lot ?? read?.gtin
            if (!q) return
            setText(q)
            void search(read?.lot && read.gtin ? read.lot : q)
          }}
        />
      )}

      {error && <Notice>{error}</Notice>}

      {found && r && (
        <>
          {found.data.source === 'device' ? (
            <div className="flex flex-wrap items-start gap-4 rounded-2xl border border-warn/35 bg-warn-soft p-4 sm:p-5">
              <IconOffline size={22} className="mt-0.5 shrink-0 text-warn" />
              <div className="min-w-0 flex-1 basis-48 text-[16px] text-fg">
                <p className="font-semibold">Saisies de cet appareil seulement.</p>
                <p className="text-fg-muted">{found.data.fallbackReason ?? 'Connectez-vous pour chercher dans tout le registre (tous les appareils).'}</p>
              </div>
              {onSignIn && <Button variant="secondary" onClick={onSignIn}>Se connecter</Button>}
            </div>
          ) : (
            <Notice tone="info">Recherche dans tout le registre du serveur, sur les 2 dernières années.</Notice>
          )}

          {total === 0 ? (
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
              <p className="flex items-start gap-2 text-[18px] font-semibold text-ok">
                <IconOk size={22} className="mt-0.5 shrink-0" /> Aucun achat, étiquette ni produit jeté avec « {text.trim()} ».
              </p>
              <p className="mt-1 text-[15px] text-fg-muted">
                Vérifiez quand même votre stock : un lot qui n’a pas été noté à l’achat n’apparaît pas ici.{r.withoutLot ? ` ${r.withoutLot} achat(s) de ce code-barres n’ont pas de n° de lot noté.` : ''}
              </p>
            </div>
          ) : (
            <>
              <div className={`rounded-2xl border-2 p-4 sm:p-5 ${pendingCount ? 'border-danger bg-danger-soft' : 'border-ok bg-ok-soft'}`}>
                <p className={`flex items-start gap-2 text-[18px] font-bold ${pendingCount ? 'text-danger' : 'text-ok'}`}>
                  {pendingCount ? <IconWarn size={22} className="mt-0.5 shrink-0" /> : <IconOk size={22} className="mt-0.5 shrink-0" />}
                  {pendingCount ? `${pendingCount} produit(s) à retirer ou à vérifier` : 'Tout ce qui a été trouvé est déjà retiré ou refusé'}
                </p>
                <ol className="mt-2 list-decimal space-y-1 pl-6 text-[15px] text-fg">
                  <li>Mettez de côté tout ce qui reste de ce lot, et ce qui a été préparé avec. Ne l’utilisez plus.</li>
                  <li>Notez le retrait ci-dessous (produit jeté, motif « Rappel produit ») ou rendez-le au magasin selon l’avis de rappel.</li>
                  <li>Suivez les consignes de l’avis de rappel. En cas de doute sur des plats déjà servis, appelez la DDPP de votre département.</li>
                  <li>Éditez la fiche de rappel et rangez-la dans le classeur.</li>
                </ol>
              </div>
              {r.lotsFound.length > 0 && r.query.gtin && <p className="text-[15px] text-fg-muted">Lots reçus avec ce code-barres : {r.lotsFound.join(', ')}.</p>}
              {r.withoutLot > 0 && <Notice tone="warn">{r.withoutLot} achat(s) de ce code-barres sans n° de lot noté : vérifiez les photos d’étiquette et le stock.</Notice>}

              <Group title={`Achats (${r.receptions.length})`}>
                {r.receptions.map((h) => (
                  <li key={h.entry.id} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
                    <p className="text-[15px] text-fg-muted">
                      {formatDayTime(h.entry.time, timeZone)} · {found.data.refs.supplierName(h.entry.payload.supplier_id)}
                      {h.entry.corrected && ' · corrigé'}
                    </p>
                    {h.quarantine && <QuarantineBadge />}
                    <ul className="mt-2 space-y-2">
                      {h.items.map((i, k) => {
                        const open = toWithdraw(h).includes(i)
                        return (
                          <li key={k} className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[17px] font-semibold text-fg">{i.product}</p>
                              <p className="text-[15px] text-fg-muted">
                                {[i.lot ? `Lot ${i.lot}` : 'Lot non noté', i.dlc ? `DLC ${frenchDate(i.dlc)}` : i.ddm ? `DDM ${frenchDate(i.ddm)}` : null, STORAGE_LABELS[i.storage]].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            {!i.accepted ? (
                              <Badge tone="ok">Refusé à l’achat</Badge>
                            ) : open ? (
                              <Button variant="danger" icon={<IconWaste size={20} />} onClick={() => setWithdraw({ kind: 'reception', hit: h, item: i })}>
                                Noter le retrait
                              </Button>
                            ) : (
                              <Badge tone="ok">Retrait noté</Badge>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                ))}
              </Group>

              <Group title={`Étiquettes : ouvert, préparé, décongelé (${r.labels.length})`}>
                {r.labels.map((h) => {
                  const p = h.entry.payload
                  return (
                    <li key={h.entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
                      <div className="min-w-0">
                        <p className="text-[17px] font-semibold text-fg">{p.name}</p>
                        <p className="text-[15px] text-fg-muted">
                          {KIND_TITLES[p.kind]} · {formatDayTime(h.entry.time, timeZone)} · DLC {formatLabelDateTime(p.dlc_at, timeZone)}
                          {p.lot ? ` · Lot ${p.lot}` : ''}
                          {h.matchedBy === 'source_record' ? ' · faite avec un produit du lot' : ''}
                        </p>
                        {h.quarantine && <QuarantineBadge />}
                      </div>
                      {labelWithdrawn(h.entry.id) ? (
                        <Badge tone="ok">Retrait noté</Badge>
                      ) : (
                        <Button variant="secondary" icon={<IconWaste size={20} />} onClick={() => setWithdraw({ kind: 'label', entry: h.entry })}>
                          Noter jeté
                        </Button>
                      )}
                    </li>
                  )
                })}
              </Group>

              <Group title={`Produits jetés (${r.wastes.length})`}>
                {r.wastes.map((h) => (
                  <li key={h.entry.id} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
                    <p className="text-[17px] font-semibold text-fg">{h.entry.payload.product}</p>
                    <p className="text-[15px] text-fg-muted">
                      {formatDayTime(h.entry.time, timeZone)} · {WASTE_REASON_LABELS[h.entry.payload.reason]}
                      {h.entry.payload.quantity ? ` · ${h.entry.payload.quantity}` : ''}
                      {h.entry.payload.lot ? ` · Lot ${h.entry.payload.lot}` : ''} · {found.data.refs.staffName(h.entry.authorId)}
                    </p>
                    {h.quarantine && <QuarantineBadge />}
                  </li>
                ))}
              </Group>
            </>
          )}

          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
            <h3 className="text-lg font-semibold text-fg">Fiche de rappel</h3>
            <p className="text-[15px] text-fg-muted">PDF : ce qui a été trouvé et les retraits notés, à ranger dans le classeur ou à transmettre si on vous la demande.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {pdf ? (
                <Button icon={<IconShare size={20} />} onClick={() => void shareFile(pdf.bytes, pdf.name, 'application/pdf', 'Fiche de rappel produit')}>
                  Ouvrir la fiche PDF
                </Button>
              ) : (
                <Button icon={<IconPrint size={20} />} onClick={makePdf} disabled={building}>
                  {building ? 'Préparation…' : 'Préparer la fiche PDF'}
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {withdraw && (
        <WithdrawModal
          w={withdraw}
          onClose={() => setWithdraw(null)}
          onSaved={() => {
            setWithdraw(null)
            void search(text)
          }}
        />
      )}
    </section>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">{title}</h3>
      {Array.isArray(children) && children.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-[16px] text-fg-muted shadow-card">Rien trouvé.</p>
      ) : (
        <ul className="space-y-3">{children}</ul>
      )}
    </div>
  )
}

function QuarantineBadge() {
  return (
    <span className="mt-1 inline-block" title="Saisie refusée par le serveur (contenu invalide), montrée par prudence">
      <Badge tone="warn">Saisie refusée par le serveur</Badge>
    </span>
  )
}

function WithdrawModal({ w, onClose, onSaved }: { w: Withdrawal; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const { save, busy, error } = useRecordSaver()
  const [quantity, setQuantity] = useState('')
  const [comment, setComment] = useState('Rappel produit')
  const product = w.kind === 'reception' ? w.item.product : w.entry.payload.name
  const submit = async () => {
    let payload: WastePayload
    if (w.kind === 'reception') payload = withdrawalPayload(w.hit, w.item, quantity, comment)
    else {
      payload = { product: w.entry.payload.name.slice(0, LIMITS.productMax), reason: 'recall', related_record_id: w.entry.id }
      if (w.entry.payload.lot) payload.lot = w.entry.payload.lot
      if (quantity.trim()) payload.quantity = quantity.trim()
      if (comment.trim()) payload.comment = comment.trim()
    }
    const rec = await save('waste', { ...payload })
    if (!rec) return
    toast(`Retrait noté : ${product}`, 'ok')
    onSaved()
  }
  return (
    <Modal
      open
      title="Noter le retrait"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="danger" onClick={submit} disabled={busy} icon={<IconWaste size={20} />}>
            Enregistrer le retrait
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[17px] text-fg">
          <span className="font-semibold">{product}</span> sera noté comme produit jeté, motif « Rappel produit », lié à {w.kind === 'reception' ? 'l’achat' : 'l’étiquette'}.
        </p>
        <TextField label="Quantité (facultatif)" value={quantity} onChange={setQuantity} maxLength={LIMITS.quantityMax} placeholder="Ex. : 2 kg, 1 carton" />
        <TextField label="Commentaire (facultatif)" value={comment} onChange={setComment} maxLength={LIMITS.wasteCommentMax} placeholder="Ex. : rendu au magasin" />
        {error && <Notice>{error}</Notice>}
      </div>
    </Modal>
  )
}
