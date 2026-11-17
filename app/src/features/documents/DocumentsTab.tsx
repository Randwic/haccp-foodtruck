// Documents du contrôle sanitaire : dépôt (PDF ou photo), échéances et rappels, ouverture, archivage.
// Le fichier d'une fiche ne change jamais (preuve de ce qui a été présenté) : nouvelle version = nouveau document.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { DocumentCategory, DocumentRef } from '../../../../shared/payloads.ts'
import { errorText } from '../../manager/api.ts'
import { DOCUMENT_CATEGORIES, documentFileError, normalizeDocumentInput } from '../../manager/helpers.ts'
import { useManager } from '../../manager/ManagerContext.tsx'
import { Badge, Button, Modal, Notice, TextField, useToast } from '../../ui/components/index.ts'
import { useNow } from '../../ui/hooks/useNow.ts'
import { IconCamera, IconDocuments, IconError, IconOk, IconPlus, IconShare, IconWarn } from '../../ui/icons.tsx'
import { TextArea } from '../cleaning/parts.tsx'
import { ConfirmModal, SectionTitle } from '../management/common.tsx'
import { prepareDocumentFile, shareFile } from './files.ts'
import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  downloadName,
  expiringDocuments,
  expiryLabel,
  expiryState,
  formatIsoDay,
  formatSize,
  missingExpected,
  type ExpiryState,
} from './model.ts'

type Dialog =
  | { kind: 'add'; preset?: { category: DocumentCategory; title: string } }
  | { kind: 'edit'; doc: DocumentRef }
  | { kind: 'archive'; doc: DocumentRef }
  | { kind: 'restore'; doc: DocumentRef }
  | { kind: 'open'; doc: DocumentRef }
  | null

export function DocumentsTab({ timeZone, refreshKey = 0, onChanged }: { timeZone: string; refreshKey?: number; onChanged?: () => void }) {
  const manager = useManager()
  const toast = useToast()
  const now = useNow(60_000)
  const [docs, setDocs] = useState<DocumentRef[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(async () => {
    try {
      setDocs(await manager.listDocuments())
      setLoadError(null)
    } catch (e) {
      setLoadError(errorText(e))
    }
  }, [manager])
  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const active = useMemo(() => docs?.filter((d) => d.active) ?? [], [docs])
  const archived = useMemo(() => docs?.filter((d) => !d.active) ?? [], [docs])
  const reminders = useMemo(() => expiringDocuments(active, now, timeZone), [active, now, timeZone])
  const missing = useMemo(() => (docs ? missingExpected(docs, now, timeZone) : []), [docs, now, timeZone])
  const groups = useMemo(() => DOCUMENT_CATEGORIES.map((c) => ({ category: c, docs: active.filter((d) => d.category === c) })).filter((g) => g.docs.length > 0), [active])

  const close = () => setDialog(null)
  const after = async () => {
    close()
    await load()
    onChanged?.()
  }

  return (
    <section aria-labelledby="docs-title">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="docs-title" className="sr-only">
          Documents
        </h2>
        <p className="max-w-2xl text-[17px] text-fg-muted">
          Rangez ici les papiers à présenter lors d’un contrôle : PDF ou photo. L’application vous prévient {30} jours avant chaque échéance.
        </p>
        <Button onClick={() => setDialog({ kind: 'add' })} icon={<IconPlus size={20} />}>
          Ajouter un document
        </Button>
      </div>
      {loadError && <Notice>{loadError}</Notice>}
      {docs === null && !loadError && <p className="text-[17px] text-fg-muted">Chargement…</p>}

      {docs !== null && (
        <>
          {reminders.length > 0 && (
            <div className="mb-6 space-y-3">
              {reminders.map((d) => (
                <Notice key={d.id} tone={d.days < 0 ? 'error' : 'warn'}>
                  <span className="font-semibold">{d.title}</span> — {expiryLabel(d, now, timeZone).toLowerCase()}. Déposez la nouvelle version quand vous l’avez.
                </Notice>
              ))}
            </div>
          )}

          {missing.length > 0 && (
            <div className="mb-8 rounded-2xl border border-line bg-sunken p-4 sm:p-5">
              <h3 className="text-[17px] font-semibold text-fg">Souvent demandés lors d’un contrôle</h3>
              <ul className="mt-3 divide-y divide-line">
                {missing.map((m) => (
                  <li key={m.category} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-fg">{m.title}</p>
                      <p className="text-[15px] text-fg-muted">{m.why}</p>
                    </div>
                    <Button variant="secondary" onClick={() => setDialog({ kind: 'add', preset: { category: m.category, title: m.title } })} icon={<IconPlus size={18} />}>
                      Ajouter
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {active.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong p-5 text-[17px] text-fg-muted">Aucun document pour l’instant.</p>
          ) : (
            groups.map((g) => (
              <div key={g.category}>
                <SectionTitle count={g.docs.length}>{CATEGORY_LABELS[g.category]}</SectionTitle>
                <ul className="mb-2 grid gap-3 sm:gap-4 lg:grid-cols-2">
                  {g.docs.map((d) => (
                    <DocumentCard key={d.id} doc={d} state={expiryState(d, now, timeZone)} expiry={expiryLabel(d, now, timeZone)}>
                      <Button onClick={() => setDialog({ kind: 'open', doc: d })} aria-label={`Ouvrir – ${d.title}`}>
                        Ouvrir
                      </Button>
                      <Button variant="secondary" onClick={() => setDialog({ kind: 'edit', doc: d })} aria-label={`Modifier – ${d.title}`}>
                        Modifier
                      </Button>
                      <Button variant="ghost" onClick={() => setDialog({ kind: 'archive', doc: d })} aria-label={`Archiver – ${d.title}`}>
                        Archiver
                      </Button>
                    </DocumentCard>
                  ))}
                </ul>
              </div>
            ))
          )}

          {archived.length > 0 && (
            <div className="mt-8">
              <Button variant="ghost" className="-ml-3 px-3 text-accent" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
                {showArchived ? 'Masquer' : 'Afficher'} les documents archivés ({archived.length})
              </Button>
              {showArchived && (
                <ul className="mt-3 grid gap-3 sm:gap-4 lg:grid-cols-2">
                  {archived.map((d) => (
                    <DocumentCard key={d.id} doc={d} state="none" expiry="" archived>
                      <Button variant="secondary" onClick={() => setDialog({ kind: 'open', doc: d })} aria-label={`Ouvrir – ${d.title}`}>
                        Ouvrir
                      </Button>
                      <Button variant="ghost" onClick={() => setDialog({ kind: 'restore', doc: d })} aria-label={`Remettre – ${d.title}`}>
                        Remettre
                      </Button>
                    </DocumentCard>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {dialog?.kind === 'add' && <DocumentModal preset={dialog.preset} onClose={close} onDone={after} />}
      {dialog?.kind === 'edit' && <DocumentModal doc={dialog.doc} onClose={close} onDone={after} />}
      {dialog?.kind === 'open' && <DocumentViewer doc={dialog.doc} onClose={close} />}
      {dialog?.kind === 'archive' && (
        <ConfirmModal
          open
          title="Archiver ce document ?"
          confirmLabel="Archiver"
          onClose={close}
          onConfirm={async () => {
            await manager.updateDocument(dialog.doc.id, { active: false })
            toast(`« ${dialog.doc.title} » archivé`, 'ok')
            await load()
            onChanged?.()
          }}
        >
          <p>
            <strong>{dialog.doc.title}</strong> n’apparaîtra plus dans la liste ni dans les rappels. Il n’est jamais supprimé : vous le retrouverez dans les documents archivés.
          </p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'restore' && (
        <ConfirmModal
          open
          title="Remettre ce document ?"
          confirmLabel="Remettre"
          onClose={close}
          onConfirm={async () => {
            await manager.updateDocument(dialog.doc.id, { active: true })
            toast(`« ${dialog.doc.title} » remis dans la liste`, 'ok')
            await load()
            onChanged?.()
          }}
        >
          <p>
            <strong>{dialog.doc.title}</strong> reviendra dans la liste des documents.
          </p>
        </ConfirmModal>
      )}
    </section>
  )
}

function ExpiryBadge({ state, label }: { state: ExpiryState; label: string }) {
  if (state === 'expired')
    return (
      <Badge tone="error">
        <IconError size={14} strokeWidth={2.25} />
        {label}
      </Badge>
    )
  if (state === 'soon')
    return (
      <Badge tone="warn">
        <IconWarn size={14} strokeWidth={2.25} />
        {label}
      </Badge>
    )
  if (state === 'valid')
    return (
      <Badge tone="ok">
        <IconOk size={14} strokeWidth={2.25} />
        {label}
      </Badge>
    )
  return null
}

function DocumentCard({ doc, state, expiry, archived, children }: { doc: DocumentRef; state: ExpiryState; expiry: string; archived?: boolean; children: ReactNode }) {
  const border = state === 'expired' ? 'border-danger/55' : state === 'soon' ? 'border-warn/55' : 'border-line'
  return (
    <li className={`flex flex-col gap-4 rounded-2xl border p-4 sm:p-5 ${border} ${archived ? 'bg-sunken' : 'bg-surface shadow-card'}`}>
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${archived ? 'bg-surface text-fg-subtle' : 'bg-accent-soft text-accent'}`}>
          {doc.mime_type === 'application/pdf' ? <IconDocuments size={22} /> : <IconCamera size={22} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`text-lg leading-snug font-semibold tracking-[-0.01em] break-words ${archived ? 'text-fg-muted' : 'text-fg'}`}>{doc.title}</h3>
            {archived && <Badge tone="neutral">Archivé</Badge>}
            {!archived && <ExpiryBadge state={state} label={expiry} />}
          </div>
          <p className="mt-1 text-[15px] text-fg-muted">
            {[archived ? CATEGORY_LABELS[doc.category] : '', doc.issued_on ? `Daté du ${formatIsoDay(doc.issued_on)}` : '', doc.mime_type === 'application/pdf' ? 'PDF' : 'Photo', formatSize(doc.size_bytes)]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {doc.notes && <p className="mt-1.5 text-[15px] whitespace-pre-line text-fg">{doc.notes}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">{children}</div>
    </li>
  )
}

/** Ajout (fichier + fiche) ou modification de la fiche d'un document. */
function DocumentModal({ doc, preset, onClose, onDone }: { doc?: DocumentRef; preset?: { category: DocumentCategory; title: string }; onClose: () => void; onDone: () => void }) {
  const manager = useManager()
  const toast = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [f, setF] = useState({
    title: doc?.title ?? preset?.title ?? '',
    category: doc?.category ?? preset?.category ?? ('other' as DocumentCategory),
    issued_on: doc?.issued_on ?? '',
    valid_until: doc?.valid_until ?? '',
    notes: doc?.notes ?? '',
  })
  const [errors, setErrors] = useState<Partial<Record<'file' | 'title' | 'category' | 'issued_on' | 'valid_until' | 'notes', string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const catId = useId()

  const pick = (list: FileList | null) => {
    const picked = list?.[0]
    if (!picked) return
    setFile(picked)
    const e = documentFileError(picked)
    setErrors((p) => ({ ...p, file: e ?? undefined }))
    if (!f.title.trim()) setF((x) => ({ ...x, title: picked.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 120) }))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!doc && !file) return setErrors({ file: 'Choisissez un fichier ou prenez une photo.' })
    const n = normalizeDocumentInput(f)
    if (!n.ok) return setErrors({ [n.field]: n.message })
    setErrors({})
    setBusy(true)
    setError(null)
    try {
      const input = { title: n.value.title!, category: n.value.category!, issued_on: n.value.issued_on ?? null, valid_until: n.value.valid_until ?? null, notes: n.value.notes ?? null }
      if (doc) {
        await manager.updateDocument(doc.id, input)
        toast('Document modifié', 'ok')
      } else {
        const prepared = await prepareDocumentFile(file!)
        const fileError = documentFileError(prepared)
        if (fileError) {
          setErrors({ file: fileError })
          setBusy(false)
          return
        }
        await manager.addDocument(prepared, input)
        toast(`« ${input.title} » ajouté`, 'ok')
      }
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal open title={doc ? `Modifier « ${doc.title} »` : 'Ajouter un document'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-6">
        {!doc && (
          <div>
            <p className="mb-1.5 text-[15px] font-semibold text-fg">Fichier</p>
            <p className="mb-3 text-[15px] text-fg-muted">PDF ou photo du document (10 Mo au maximum).</p>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => fileInput.current?.click()} icon={<IconDocuments size={20} />}>
                Choisir un fichier
              </Button>
              <Button variant="secondary" onClick={() => photoInput.current?.click()} icon={<IconCamera size={20} />}>
                Prendre une photo
              </Button>
            </div>
            <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" data-testid="document-file" onChange={(e) => pick(e.target.files)} />
            <input ref={photoInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files)} />
            {file && (
              <p className="mt-3 flex items-center gap-2 text-[15px] text-fg">
                <IconOk size={18} className="shrink-0 text-ok" />
                <span className="min-w-0 break-all">
                  {file.name} ({formatSize(file.size)})
                </span>
              </p>
            )}
            {errors.file && (
              <p className="mt-2 flex items-start gap-1.5 text-[15px] font-medium text-danger">
                <IconError size={18} className="mt-0.5 shrink-0" />
                {errors.file}
              </p>
            )}
          </div>
        )}
        <TextField label="Titre" hint="Ex. « Attestation de formation hygiène – Cédric »." value={f.title} onChange={(v) => setF({ ...f, title: v })} error={errors.title} maxLength={120} autoCapitalize="sentences" />
        <fieldset>
          <legend id={catId} className="mb-1.5 text-[15px] font-semibold text-fg">
            Catégorie
          </legend>
          <div role="radiogroup" aria-labelledby={catId} className="grid gap-2 sm:grid-cols-2">
            {DOCUMENT_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={f.category === c}
                onClick={() => setF({ ...f, category: c })}
                className={`min-h-12 rounded-xl border px-3 py-2 text-left text-[15px] leading-tight font-semibold text-fg transition-colors ${
                  f.category === c ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line-strong bg-elevated active:bg-pressed'
                }`}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[15px] text-fg-muted">{CATEGORY_HINTS[f.category]}</p>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Date du document" hint="Facultatif." type="date" value={f.issued_on} onChange={(v) => setF({ ...f, issued_on: v })} error={errors.issued_on} />
          <TextField label="Échéance" hint="Facultatif : fin de validité, renouvellement." type="date" value={f.valid_until} onChange={(v) => setF({ ...f, valid_until: v })} error={errors.valid_until} />
        </div>
        <TextArea label="Note" hint="Facultatif (500 caractères)." value={f.notes} onChange={(v) => setF({ ...f, notes: v })} maxLength={500} rows={2} invalid={!!errors.notes} />
        {doc && <p className="text-[15px] text-fg-muted">Le fichier lui-même ne peut pas être remplacé : pour une nouvelle version, ajoutez un nouveau document et archivez l’ancien.</p>}
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? (doc ? 'Enregistrement…' : 'Envoi…') : doc ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Télécharge le fichier puis l'affiche (photo) ou propose de l'ouvrir / partager (PDF). */
function DocumentViewer({ doc, onClose }: { doc: DocumentRef; onClose: () => void }) {
  const manager = useManager()
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const url = useMemo(() => (blob && doc.mime_type !== 'application/pdf' ? URL.createObjectURL(blob) : null), [blob, doc.mime_type])
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])
  useEffect(() => {
    let alive = true
    manager.downloadDocument(doc).then(
      (b) => alive && setBlob(b),
      (e: unknown) => alive && setError(errorText(e)),
    )
    return () => {
      alive = false
    }
  }, [manager, doc])

  return (
    <Modal
      open
      title={doc.title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
          <Button disabled={!blob} icon={<IconShare size={20} />} onClick={() => blob && void shareFile(blob, downloadName(doc), doc.mime_type, doc.title)}>
            {doc.mime_type === 'application/pdf' ? 'Ouvrir le PDF' : 'Partager / imprimer'}
          </Button>
        </>
      }
    >
      {error && <Notice>{error}</Notice>}
      {!blob && !error && <p className="text-fg-muted">Téléchargement…</p>}
      {blob && url && <img src={url} alt={doc.title} className="mx-auto max-h-[60dvh] rounded-xl border border-line object-contain" />}
      {blob && !url && <p className="text-fg-muted">Le PDF est prêt ({formatSize(blob.size)}). Touchez « Ouvrir le PDF » pour le lire, l’imprimer ou l’envoyer.</p>}
    </Modal>
  )
}
