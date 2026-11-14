import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  // Contrastes vérifiés (WCAG AA) sur fond slate-950.
  primary: 'bg-sky-300 text-slate-950 active:bg-sky-200',
  secondary: 'bg-slate-700 text-white ring-1 ring-slate-500 active:bg-slate-600',
  danger: 'bg-red-700 text-white active:bg-red-600',
  ghost: 'bg-transparent text-slate-100 ring-1 ring-slate-600 active:bg-slate-800',
}
const SIZES: Record<ButtonSize, string> = {
  md: 'min-h-14 px-5 text-lg',
  lg: 'min-h-18 px-7 text-xl',
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
      className={`inline-flex min-w-14 select-none items-center justify-center gap-2 rounded-2xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
