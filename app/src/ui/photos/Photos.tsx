// Photos (lot 3) : prise de vue, miniatures, visionneuse plein écran.
// Réutilisable par tous les modules (réception, pertes, et plus tard actions correctives…).
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import type { PhotoStatus } from '../../core/api.ts'
import { useCore } from '../CoreContext.tsx'
import { Notice } from '../components/index.ts'
import { IconCamera, IconChevronLeft, IconChevronRight, IconClose, IconError, IconImageOff, IconSyncPending } from '../icons.tsx'
import { usePhotoUrl } from './usePhotoUrl.ts'

/** Miniature carrée ; toucher = plein écran. */
export function PhotoThumb({ path, label, onOpen, size = 'md', status }: { path: string; label: string; onOpen: () => void; size?: 'sm' | 'md'; status?: PhotoStatus }) {
  const load = usePhotoUrl(path)
  const dim = size === 'sm' ? 'h-14 w-14' : 'h-20 w-20'
  const pending = status && (status.state === 'pending' || status.state === 'draft')
  const failed = status?.state === 'failed'
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label}${pending ? ' (en attente d’envoi)' : failed ? ' (refusée par le serveur)' : ''} — afficher en plein écran`}
      className={`relative shrink-0 overflow-hidden rounded-xl border bg-sunken ${dim} ${failed ? 'border-danger' : 'border-line'} active:opacity-80`}
    >
      {load.state === 'ok' ? (
        <img src={load.url} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-fg-subtle">
          {load.state === 'loading' ? <span className="h-5 w-5 animate-pulse rounded-full bg-line" /> : <IconImageOff size={22} />}
        </span>
      )}
      {(pending || failed) && (
        <span className={`absolute right-1 bottom-1 flex h-6 w-6 items-center justify-center rounded-full ${failed ? 'bg-danger-strong text-on-danger' : 'bg-warn-soft text-warn'} shadow-card`}>
          {failed ? <IconError size={15} /> : <IconSyncPending size={15} />}
        </span>
      )}
    </button>
  )
}

/** Visionneuse plein écran (fond noir, image entière, précédente / suivante). */
export function PhotoViewer({ paths, index, onClose, title }: { paths: readonly string[]; index: number; onClose: () => void; title?: string }) {
  const [i, setI] = useState(index)
  const path = paths[Math.min(i, paths.length - 1)] ?? null
  const load = usePhotoUrl(path)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setI((x) => Math.min(paths.length - 1, x + 1))
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [onClose, paths.length])
  const nav = 'flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white active:bg-white/30 disabled:opacity-30'
  return (
    <div role="dialog" aria-modal="true" aria-label={title ?? 'Photo'} className="safe-pt safe-pb fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-white">
        <p className="min-w-0 truncate text-[16px] font-semibold">
          {title}
          {paths.length > 1 && <span className="ml-2 font-normal text-white/70 tabular-nums">{i + 1} / {paths.length}</span>}
        </p>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Fermer la photo" className={nav}>
          <IconClose size={26} />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
        {load.state === 'ok' ? (
          <img src={load.url} alt={title ?? 'Photo'} className="max-h-full max-w-full object-contain" />
        ) : (
          <p className="flex items-center gap-2 text-[17px] text-white/80">
            {load.state === 'loading' ? 'Chargement…' : (
              <>
                <IconImageOff size={22} /> Photo indisponible sur cet appareil
              </>
            )}
          </p>
        )}
        {paths.length > 1 && (
          <>
            <button type="button" aria-label="Photo précédente" disabled={i === 0} onClick={() => setI(i - 1)} className={`${nav} absolute top-1/2 left-3 -translate-y-1/2`}>
              <IconChevronLeft size={28} />
            </button>
            <button type="button" aria-label="Photo suivante" disabled={i >= paths.length - 1} onClick={() => setI(i + 1)} className={`${nav} absolute top-1/2 right-3 -translate-y-1/2`}>
              <IconChevronRight size={28} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** Rangée de miniatures (historique) avec visionneuse. */
export function PhotoGallery({ paths, label, status, size = 'sm' }: { paths: readonly string[]; label: string; status?: Record<string, PhotoStatus>; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState<number | null>(null)
  if (paths.length === 0) return null
  return (
    <>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {paths.map((p, k) => (
          <PhotoThumb key={p} path={p} size={size} label={`${label} ${k + 1}`} status={status?.[p]} onOpen={() => setOpen(k)} />
        ))}
      </div>
      {open !== null && <PhotoViewer paths={paths} index={open} title={label} onClose={() => setOpen(null)} />}
    </>
  )
}

export interface PhotoPickerProps {
  label: string
  hint?: string
  paths: string[]
  onChange: (paths: string[]) => void
  /** Maximum pour ce champ (contrat : 5). */
  max: number
  /** Photos encore autorisées pour l'ensemble de la saisie (plafond global : 20 par réception). */
  remaining?: number
  /** Appelé après chaque photo ajoutée (point d'extension : lecture d'étiquette). */
  onAdded?: (path: string, image: Blob) => void
  /** Chemins à ne pas supprimer de l'appareil quand on les retire (photos d'une version précédente). */
  keep?: readonly string[]
}

/**
 * Prise de vue (appareil photo arrière), compression WebP par le core, miniatures retirables.
 * Une photo retirée avant l'enregistrement est effacée de l'appareil (brouillon).
 */
export function PhotoPicker({ label, hint, paths, onChange, max, remaining = Infinity, onAdded, keep = [] }: PhotoPickerProps) {
  const core = useCore()
  const inputId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const pathsRef = useRef(paths)
  pathsRef.current = paths
  const fieldFull = paths.length >= max
  const globalFull = remaining <= 0
  const full = fieldFull || globalFull

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // même photo reprise : l'événement doit se redéclencher
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const info = await core.addPhoto(file)
      onChange([...pathsRef.current, info.path])
      onAdded?.(info.path, file)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Photo : /, '') : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (path: string) => {
    onChange(paths.filter((p) => p !== path))
    if (!keep.includes(path)) await core.discardPhoto(path).catch(() => false)
  }

  return (
    <div>
      <p className="mb-1.5 text-[15px] font-semibold text-fg">
        {label} <span className="font-normal text-fg-muted tabular-nums">({paths.length}/{max})</span>
      </p>
      {hint && <p className="mb-2 text-[15px] text-fg-muted">{hint}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {paths.map((p, k) => (
          <div key={p} className="relative">
            <PhotoThumb path={p} label={`${label} ${k + 1}`} onOpen={() => setOpen(k)} />
            <button
              type="button"
              onClick={() => void remove(p)}
              aria-label={`Retirer la photo ${k + 1} — ${label}`}
              className="absolute -top-2.5 -right-2.5 flex h-9 w-9 items-center justify-center rounded-full border border-line-strong bg-elevated text-fg shadow-card active:bg-pressed"
            >
              <IconClose size={18} />
            </button>
          </div>
        ))}
        {!full && (
          <label
            htmlFor={inputId}
            className={`flex h-20 min-w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-3 text-[14px] font-semibold transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
              busy ? 'border-line text-fg-subtle' : 'border-accent/60 text-accent active:bg-accent-soft'
            }`}
          >
            <IconCamera size={24} />
            {busy ? 'Compression…' : paths.length ? 'Ajouter' : 'Photo'}
            <input
              id={inputId}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={busy}
              aria-label={`Prendre une photo — ${label}`}
              onChange={onFile}
            />
          </label>
        )}
      </div>
      {full && (
        <p className="mt-2 text-[14px] text-fg-subtle">
          {fieldFull ? `${max} photos au maximum ici.` : 'Plafond de photos atteint pour cette saisie.'}
        </p>
      )}
      {error && (
        <div className="mt-3">
          <Notice>Photo non enregistrée : {error}</Notice>
        </div>
      )}
      {open !== null && <PhotoViewer paths={paths} index={open} title={label} onClose={() => setOpen(null)} />}
    </div>
  )
}
