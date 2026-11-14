import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconError, IconInfo, IconOk } from '../icons.tsx'

export type ToastTone = 'ok' | 'error' | 'info'
interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}
type ShowToast = (message: string, tone?: ToastTone, durationMs?: number) => void

const ToastContext = createContext<ShowToast>(() => {})

const TONES: Record<ToastTone, { icon: string; Icon: typeof IconOk }> = {
  ok: { icon: 'text-ok', Icon: IconOk },
  error: { icon: 'text-danger', Icon: IconError },
  info: { icon: 'text-accent', Icon: IconInfo },
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
        {items.map((t) => {
          const { icon, Icon } = TONES[t.tone]
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => dismiss(t.id)}
              className="pointer-events-auto flex min-h-14 max-w-xl items-center gap-3 rounded-2xl border border-line bg-elevated px-5 py-3 text-left text-[16px] font-medium text-fg shadow-pop"
            >
              <Icon size={22} className={`shrink-0 ${icon}`} />
              {t.message}
            </button>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ShowToast {
  return useContext(ToastContext)
}
