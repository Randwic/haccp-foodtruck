// Repères ● (allergène présent, rose néon) et ○ (peut en contenir, jaune / ambre) — formes CSS, jamais de
// caractère Unicode ni d'emoji. Le sens est toujours aussi porté par un texte (légende, aria-label).
export function PresentDot({ size = 12, className = '' }: { size?: number; className?: string }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 rounded-full bg-brand-pink ${className}`} style={{ width: size, height: size }} />
}

/** `poster` : jaune de la charte (sur fond bleu nuit) ; sinon ambre du thème (contraste suffisant en clair). */
export function TraceDot({ size = 12, poster = false, className = '' }: { size?: number; poster?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full border-2 ${poster ? 'border-brand-yellow' : 'border-warn'} ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
