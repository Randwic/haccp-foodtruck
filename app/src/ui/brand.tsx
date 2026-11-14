// Éléments de marque Space Diner : logo (SVG) et filet signature « 3 tubes ».
// Utilisés par touches : en-tête, verrouillage, première configuration.

/** Couleurs de la charte (docs/marque/charte.md) — le logo est identique dans les deux thèmes. */
const CHARTE = { navy: '#0A0E1F', pink: '#FF2E97', cyan: '#22E6F2', white: '#F4F1EC' } as const

export interface BrandLogoProps {
  /** Diamètre en px. */
  size?: number
  className?: string
  /** Lueur néon subtile du contour (thème sombre uniquement). */
  glow?: boolean
  /** Nom accessible ; `null` = décoratif. */
  title?: string | null
}

/** Petite étoile à 4 branches. */
function Sparkle({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  const k = r * 0.28
  return <path d={`M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`} fill={color} />
}

/**
 * Logo rond Space Diner : contour néon rose, pastille « SPACE », « DINER » en Bowlby One blanc chrome,
 * anneau cyan. Net de 32 px (en-tête) à 512 px (icônes PWA).
 */
export function BrandLogo({ size = 96, className = '', glow = false, title = 'Space Diner' }: BrandLogoProps) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={`${glow ? 'brand-glow' : ''} ${className}`}
      focusable="false"
      {...a11y}
    >
      <circle cx="100" cy="100" r="97" fill={CHARTE.navy} />
      <circle cx="100" cy="100" r="91" fill="none" stroke={CHARTE.pink} strokeWidth="7" />
      <Sparkle x={52} y={60} r={5} color={CHARTE.white} />
      <Sparkle x={151} y={56} r={3.6} color={CHARTE.cyan} />
      <Sparkle x={148} y={150} r={4.4} color={CHARTE.white} />
      <Sparkle x={56} y={146} r={3.2} color={CHARTE.pink} />
      <ellipse cx="100" cy="114" rx="78" ry="21" fill="none" stroke={CHARTE.cyan} strokeWidth="4.5" transform="rotate(-9 100 114)" />
      <rect x="66" y="64" width="68" height="22" rx="11" fill={CHARTE.pink} />
      <text
        x="100"
        y="80.2"
        textAnchor="middle"
        fontFamily="'Bowlby One', sans-serif"
        fontSize="13"
        letterSpacing="1.6"
        fill={CHARTE.white}
        textLength="50"
        lengthAdjust="spacingAndGlyphs"
      >
        SPACE
      </text>
      <text
        x="100"
        y="129"
        textAnchor="middle"
        fontFamily="'Bowlby One', sans-serif"
        fontSize="41"
        fill={CHARTE.white}
        stroke={CHARTE.navy}
        strokeWidth="7"
        strokeLinejoin="round"
        paintOrder="stroke"
        textLength="138"
        lengthAdjust="spacingAndGlyphs"
      >
        DINER
      </text>
    </svg>
  )
}

/** Filet signature : néon rose, néon cyan, filet chrome (les 3 « tubes » du camion). Décoratif. */
export function BrandStripe({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`flex flex-col gap-[2px] ${className}`}>
      <span className="block h-[3px] bg-brand-pink" />
      <span className="block h-[3px] bg-brand-cyan" />
      <span className="block h-[2px] bg-stripe-chrome" />
    </div>
  )
}
