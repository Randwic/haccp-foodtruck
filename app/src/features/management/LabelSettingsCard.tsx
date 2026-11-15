import { IconMinus, IconPlus, IconPrint } from '../../ui/icons.tsx'
import { DEFAULT_LABEL_HEIGHT_MM, LABEL_WIDTH_MM, MAX_LABEL_HEIGHT_MM, MIN_LABEL_HEIGHT_MM } from '../labels/layout.ts'
import { setLabelHeightMm, useLabelHeightMm } from '../labels/labelSettings.ts'

const PRESETS = [29, 40, 50, 62, 75] as const

/** Gestion › Réglages : format des étiquettes, propre à cet appareil (rangé localement, effet immédiat). */
export function LabelSettingsCard() {
  const height = useLabelHeightMm()
  const stepBtn =
    'flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-elevated text-fg shadow-card transition-transform active:scale-[0.96] active:bg-pressed disabled:opacity-40'
  return (
    <section aria-labelledby="label-settings-title" className="mt-6 max-w-2xl rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <h3 id="label-settings-title" className="flex items-center gap-2 text-[17px] font-semibold text-fg">
        <IconPrint size={20} className="text-accent" />
        Étiquettes DLC — cet appareil
      </h3>
      <p className="mt-1.5 text-[15px] text-fg-muted">
        Imprimante Brother QL-820NWB (AirPrint), rouleau continu {LABEL_WIDTH_MM} mm. Hauteur de chaque étiquette (défaut {DEFAULT_LABEL_HEIGHT_MM} mm). Réglage enregistré sur cet appareil uniquement.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={stepBtn} onClick={() => setLabelHeightMm(height - 1)} disabled={height <= MIN_LABEL_HEIGHT_MM} aria-label="Hauteur : 1 mm de moins">
          <IconMinus size={22} />
        </button>
        <output aria-live="polite" aria-label="Hauteur des étiquettes" className="min-w-28 text-center text-[24px] font-bold text-fg tabular-nums">
          {LABEL_WIDTH_MM} × {height} mm
        </output>
        <button type="button" className={stepBtn} onClick={() => setLabelHeightMm(height + 1)} disabled={height >= MAX_LABEL_HEIGHT_MM} aria-label="Hauteur : 1 mm de plus">
          <IconPlus size={22} />
        </button>
      </div>
      <div role="group" aria-label="Hauteurs courantes" className="mt-3 flex flex-wrap gap-2">
        {PRESETS.map((h) => (
          <button
            key={h}
            type="button"
            aria-pressed={height === h}
            onClick={() => setLabelHeightMm(h)}
            className={`min-h-11 rounded-full border px-4 text-[15px] font-semibold tabular-nums active:bg-pressed ${height === h ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-elevated text-fg'}`}
          >
            {h} mm
          </button>
        ))}
      </div>
    </section>
  )
}
