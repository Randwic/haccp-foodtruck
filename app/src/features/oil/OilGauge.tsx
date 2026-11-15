// Jauge des composés polaires (vert < alerte ≤ ambre ≤ limite < rouge) et petit graphe SVG de
// l'évolution depuis le dernier changement d'huile. Couleurs : jetons du thème uniquement.
import { IconError, IconOk, IconWarn } from '../../ui/icons.tsx'
import { formatPercent, LEVEL_LABELS, oilLevel, type OilLevel, type OilLimits } from './model.ts'
const dayMonth = (iso: string, timeZone: string) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone }).format(new Date(iso))

/** Échelle affichée : 0 → au moins 35 %, et toujours 10 points au-dessus de la limite. */
export const gaugeScale = (limits: OilLimits) => Math.max(35, Math.ceil(limits.max + 10))

const LEVEL_TEXT: Record<OilLevel, string> = { ok: 'text-ok', warn: 'text-warn', out: 'text-danger' }

export function LevelLabel({ level, className = '' }: { level: OilLevel; className?: string }) {
  const Icon = level === 'ok' ? IconOk : level === 'warn' ? IconWarn : IconError
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${LEVEL_TEXT[level]} ${className}`}>
      <Icon size={18} className="shrink-0" />
      {LEVEL_LABELS[level]}
    </span>
  )
}

export function OilGauge({ value, limits, label }: { value: number | null; limits: OilLimits; label: string }) {
  const scale = gaugeScale(limits)
  const pct = (v: number) => `${(Math.min(Math.max(v, 0), scale) / scale) * 100}%`
  const level = value === null ? null : oilLevel(value, limits)
  return (
    <div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={50}
        aria-valuenow={value ?? undefined}
        aria-valuetext={value === null ? 'Aucune mesure' : `${formatPercent(value)}, ${LEVEL_LABELS[level!].toLowerCase()} (alerte ${formatPercent(limits.warn)}, limite ${formatPercent(limits.max)})`}
        className="relative h-4 w-full rounded-full"
      >
        <div className="absolute inset-0 flex overflow-hidden rounded-full">
          <div className="h-full bg-ok/35" style={{ width: pct(limits.warn) }} />
          <div className="h-full bg-warn/40" style={{ width: `calc(${pct(limits.max)} - ${pct(limits.warn)})` }} />
          <div className="h-full flex-1 bg-danger/40" />
        </div>
        {value !== null && (
          <div aria-hidden="true" className="absolute -top-1.5 -bottom-1.5 w-1.5 -translate-x-1/2 rounded-full bg-fg shadow-card ring-2 ring-surface" style={{ left: pct(value) }} />
        )}
      </div>
      <div aria-hidden="true" className="relative mt-1.5 h-5 text-[13px] text-fg-subtle tabular-nums">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-full pr-1 max-sm:hidden" style={{ left: pct(limits.warn) }}>
          {formatPercent(limits.warn)}
        </span>
        <span className="absolute -translate-x-1/2 font-semibold text-danger" style={{ left: pct(limits.max) }}>
          {formatPercent(limits.max)}
        </span>
        <span className="absolute right-0">{scale} %</span>
      </div>
    </div>
  )
}

export interface TrendPoint {
  time: string
  value: number
}

/** Évolution depuis le dernier changement : ligne, points colorés par niveau, repères alerte et limite. */
export function OilTrend({ points, limits, timeZone, label, height = 96 }: { points: readonly TrendPoint[]; limits: OilLimits; timeZone: string; label: string; height?: number }) {
  const W = 320
  const H = height
  const pad = { l: 6, r: 6, t: 8, b: 18 }
  const top = Math.max(gaugeScale(limits) - 5, ...points.map((p) => p.value + 2))
  const y = (v: number) => pad.t + (1 - Math.min(v, top) / top) * (H - pad.t - pad.b)
  const x = (i: number) => (points.length <= 1 ? W / 2 : pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r))
  const desc =
    points.length === 0
      ? 'Aucun contrôle depuis le dernier changement d’huile.'
      : `${points.length} contrôle${points.length > 1 ? 's' : ''} depuis le changement : ${points.map((p) => formatPercent(p.value)).join(', ')}.`
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}. ${desc}`} className="block h-auto w-full overflow-visible">
        <line x1={0} x2={W} y1={y(limits.max)} y2={y(limits.max)} className="stroke-danger" strokeWidth={1.5} strokeDasharray="5 4" />
        <line x1={0} x2={W} y1={y(limits.warn)} y2={y(limits.warn)} className="stroke-warn" strokeWidth={1.25} strokeDasharray="2 4" />
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="stroke-line-strong" strokeWidth={1} />
        {points.length > 1 && (
          <polyline points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} className="fill-none stroke-fg-muted" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}
        {points.map((p, i) => {
          const lv = oilLevel(p.value, limits)
          return <circle key={`${p.time}-${i}`} cx={x(i)} cy={y(p.value)} r={4.5} className={`${lv === 'out' ? 'fill-danger' : lv === 'warn' ? 'fill-warn' : 'fill-ok'} stroke-surface`} strokeWidth={2} />
        })}
        {points.length > 0 && (
          <>
            <text x={pad.l} y={H - 3} className="fill-fg-subtle text-[11px]">
              {dayMonth(points[0].time, timeZone)}
            </text>
            {points.length > 1 && (
              <text x={W - pad.r} y={H - 3} textAnchor="end" className="fill-fg-subtle text-[11px]">
                {dayMonth(points[points.length - 1].time, timeZone)}
              </text>
            )}
          </>
        )}
      </svg>
      {points.length === 0 && <figcaption className="mt-1 text-[14px] text-fg-subtle">Aucun contrôle depuis le dernier changement d’huile.</figcaption>}
    </figure>
  )
}
