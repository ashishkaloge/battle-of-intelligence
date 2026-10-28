import type { LucideIcon } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cx, flag } from '../lib/cx.ts'

/** On/off toggle on a native checkbox, announced as a switch. */
export function Switch({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean | undefined
}) {
  return (
    <label className="switch">
      <input
        className="sr-only"
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      <span>{label}</span>
    </label>
  )
}

export type TextFieldProps = Omit<ComponentPropsWithoutRef<'input'>, 'size'> & {
  /** Accessible name. Placeholders are hints, not labels. */
  label: string
  icon?: LucideIcon | undefined
  trailing?: ReactNode
  outline?: boolean | undefined
}

export function TextField({
  label,
  icon: Glyph,
  trailing,
  outline,
  className,
  ...rest
}: TextFieldProps) {
  return (
    <label className={cx('field', className)} data-outline={flag(outline)}>
      {Glyph && <Glyph aria-hidden="true" size={15} strokeWidth={1.75} />}
      <span className="sr-only">{label}</span>
      <input {...rest} />
      {trailing}
    </label>
  )
}
