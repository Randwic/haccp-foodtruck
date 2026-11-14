import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export type ToastTone = 'ok' | 'error' | 'info'
interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}
type ShowToast = (message: string, tone?: ToastTone, durationMs?: number) => void

const ToastContext = createContext<ShowToast>(() => {})

const TONES: Record<ToastTone, string> = {
  ok: 'bg-emerald-400 text-slate-950',
  error: 'bg-red-700 text-white',
  info: 'bg-slate-100 text-slate-950',
}

/** Messages éphémères, annoncés aux lecteurs d'écran (aria-live). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), [])
  const show = useCallback<ShowToast>(
    (message, tone = 'info', durationMs = 4000) => {
      const id = nextId.current++
      setItems((list) => [...list.slice(-2), { id, message, tone }])
      setTimeout(() => dismiss(id), durationMs)
    },
    [dismiss],
  )
  const value = useMemo(() => show, [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="safe-pb pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-3 px-4 pb-4"
      >
        {items.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto min-h-14 max-w-xl rounded-2xl px-6 py-3 text-lg font-semibold shadow-2xl ${TONES[t.tone]}`}
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ShowToast {
  return useContext(ToastContext)
}
