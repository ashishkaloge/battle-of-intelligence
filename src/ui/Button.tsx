import type { LucideIcon } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cx, flag } from '../lib/cx.ts'

export type Tone = 'neutral' | 'strong' | 'accent' | 'danger' | 'side'
export type Size = 'sm' | 'md' | 'lg'

type Look = {
  size?: Size | undefined
  /** `side` takes the fighter color from the nearest `--side`. */
  tone?: Tone | undefined
  /** Adds a hairline. There is no filled variant. */
  outline?: boolean | undefined
}

export const ICON_SIZE: Record<Size, number> = { sm: 14, md: 16, lg: 18 }

export type ButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'type'> &
  Look & {
    icon?: LucideIcon | undefined
    trailing?: ReactNode
    type?: 'button' | 'submit' | 'reset'
  }

export function Button({
  size = 'md',
  tone = 'neutral',
  outline,
  icon: Glyph,
  trailing,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', className)}
      data-size={size}
      data-tone={tone}
      data-outline={flag(outline)}
      {...rest}
    >
      {Glyph && <Glyph aria-hidden="true" size={ICON_SIZE[size]} strokeWidth={1.75} />}
      {children}
      {trailing}
    </button>
  )
}

export type IconButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'type' | 'children'> &
  Look & {
    icon: LucideIcon
    /** Accessible name, also shown as the tooltip. */
    label: string
    tip?: 'top' | 'bottom' | 'none' | undefined
  }

export function IconButton({
  icon: Glyph,
  label,
  size = 'md',
  tone = 'neutral',
  outline,
  tip = 'top',
  className,
  ...rest
}: IconButtonProps) {
  const showTip = tip !== 'none'
  return (
    <button
      type="button"
      className={cx('btn', showTip && 'tip', className)}
      data-size={size}
      data-tone={tone}
      data-outline={flag(outline)}
      data-icon-only=""
      data-tip={showTip ? tip : undefined}
      aria-label={label}
      {...rest}
    >
      <Glyph aria-hidden="true" size={ICON_SIZE[size]} strokeWidth={1.75} />
      {showTip && (
        <span className="tip__bubble" aria-hidden="true">
          {label}
        </span>
      )}
    </button>
  )
}
