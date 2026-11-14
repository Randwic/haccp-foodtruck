import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  // Jetons de theme.css — contrastes AA vérifiés dans les deux thèmes (docs/ui.md).
  primary: 'bg-accent text-on-accent active:bg-accent-pressed',
  secondary: 'bg-elevated text-fg border border-line-strong shadow-card active:bg-pressed',
  danger: 'bg-danger-strong text-on-danger active:brightness-110',
  ghost: 'bg-transparent text-fg active:bg-pressed',
}
const SIZES: Record<ButtonSize, string> = {
  md: 'min-h-14 px-5 text-[17px]',
  lg: 'min-h-16 px-6 text-lg',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', block, icon, className = '', type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-w-14 select-none items-center justify-center gap-2 rounded-xl font-semibold tracking-[-0.01em] transition-[background-color,transform] duration-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 ${VARIANTS[variant]} ${SIZES[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
