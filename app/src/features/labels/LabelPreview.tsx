// Aperçu fidèle de l'étiquette : SVG dessiné à partir de la MÊME mise en page que le PDF (layout.ts),
// avec les mêmes polices. Vue d'impression directe (window.print) : une page 62 mm × h par copie.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CSS_WEIGHT, LABEL_FONT_FAMILY, LABEL_FONT_URLS, loadLabelFonts, type LabelFonts } from './fonts.ts'
import { LABEL_WIDTH_MM, layoutLabel, type LabelLayout } from './layout.ts'
import type { LabelContent } from './model.ts'

let facesInjected = false
/** Déclare les polices de l'étiquette pour l'aperçu (une fois). */
function injectFontFaces() {
  if (facesInjected || typeof document === 'undefined') return
  facesInjected = true
  const style = document.createElement('style')
  style.dataset.labelFonts = ''
  style.textContent = (Object.keys(LABEL_FONT_URLS) as (keyof typeof LABEL_FONT_URLS)[])
    .map((w) => `@font-face{font-family:'${LABEL_FONT_FAMILY}';src:url('${LABEL_FONT_URLS[w]}') format('truetype');font-weight:${CSS_WEIGHT[w]};font-display:block}`)
    .join('\n')
  document.head.append(style)
}

/** Polices chargées (aperçu + PDF). */
export function useLabelFonts(): { fonts: LabelFonts | null; error: string | null } {
  const [fonts, setFonts] = useState<LabelFonts | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    injectFontFaces()
    let alive = true
    loadLabelFonts().then(
      (f) => alive && setFonts(f),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      alive = false
    }
  }, [])
  return { fonts, error }
}

export function useLabelLayout(content: LabelContent | null, heightMm: number, fonts: LabelFonts | null): LabelLayout | null {
  return useMemo(() => (content && fonts ? layoutLabel(content, fonts.measure, heightMm) : null), [content, fonts, heightMm])
}

/** Dessin SVG de l'étiquette (unités : points). */
export function LabelSvg({ layout, width, title }: { layout: LabelLayout; width?: string; title?: string }) {
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={width ?? '100%'}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', fontKerning: 'none', fontFamily: `'${LABEL_FONT_FAMILY}', sans-serif` }}
    >
      <rect x={0} y={0} width={layout.width} height={layout.height} fill="#ffffff" />
      {layout.ops.map((op, i) => {
        if (op.kind === 'text')
          return (
            <text
              key={i}
              x={op.x}
              y={op.y}
              fontSize={op.size}
              fontWeight={CSS_WEIGHT[op.weight]}
              fill="#000"
              xmlSpace="preserve"
              textLength={op.w && op.text.trim() ? op.w : undefined}
              lengthAdjust="spacingAndGlyphs"
            >
              {op.text}
            </text>
          )
        if (op.kind === 'rule') return <rect key={i} x={op.x} y={op.y} width={op.w} height={op.h} fill="#000" />
        if (op.kind === 'frame') return <rect key={i} x={op.x} y={op.y} width={op.w} height={op.h} fill="none" stroke="#000" strokeWidth={op.line} />
        return <circle key={i} cx={op.cx} cy={op.cy} r={op.r} fill="none" stroke="#000" strokeWidth={op.line} />
      })}
    </svg>
  )
}

/** Étiquette posée sur la page (ombre, format indiqué). */
export function LabelPaper({ layout, heightMm, title }: { layout: LabelLayout; heightMm: number; title: string }) {
  return (
    <figure className="flex flex-col items-center gap-2">
      <div className="w-full max-w-[26rem] overflow-hidden rounded-[6px] bg-white shadow-pop ring-1 ring-black/10">
        <LabelSvg layout={layout} title={title} />
      </div>
      <figcaption className="text-[13px] text-fg-subtle tabular-nums">
        Aperçu à l’échelle · {LABEL_WIDTH_MM} × {heightMm} mm
      </figcaption>
    </figure>
  )
}

/**
 * Vue d'impression directe (window.print) : montée hors de l'application, invisible à l'écran.
 * `@page { size: 62mm <h>mm; margin: 0 }`, une page par copie.
 */
export function LabelPrintSheet({ layout, copies, heightMm }: { layout: LabelLayout; copies: number; heightMm: number }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div id="label-print-root" aria-hidden="true">
      <style>{`@page { size: ${LABEL_WIDTH_MM}mm ${heightMm}mm; margin: 0 }`}</style>
      {Array.from({ length: copies }, (_, i) => (
        <div key={i} className="label-print-page" style={{ width: `${LABEL_WIDTH_MM}mm`, height: `${heightMm}mm` }}>
          <LabelSvg layout={layout} width={`${LABEL_WIDTH_MM}mm`} />
        </div>
      ))}
    </div>,
    document.body,
  )
}

/** Lance l'impression directe de la vue `#label-print-root` (ou `#a4-print-root`). */
export function printSheet(kind: 'labels' | 'a4' = 'labels'): void {
  const cls = kind === 'labels' ? 'printing-labels' : 'printing-a4'
  document.body.classList.add(cls)
  const done = () => {
    document.body.classList.remove(cls)
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  try {
    window.print()
  } finally {
    // Safari iOS rend la main avant la fin de l'impression : la classe reste jusqu'à `afterprint` (au plus 60 s).
    setTimeout(done, 60_000)
  }
}
