import type { LucideIcon } from 'lucide-react'
import { useId } from 'react'
import { cx, flag } from '../lib/cx.ts'

export type SegmentOption<T extends string> = {
  value: T
  label: string
  icon?: LucideIcon | undefined
}

/** One choice out of a few, built on native radios so arrow keys and screen readers just work. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  outline,
  className,
}: {
  label: string
  value: T
  options: readonly SegmentOption<T>[]
  onChange: (value: T) => void
  outline?: boolean | undefined
  className?: string | undefined
}) {
  const name = useId()
  return (
    <fieldset className={cx('seg', className)} data-outline={flag(outline)}>
      <legend className="sr-only">{label}</legend>
      {options.map(({ value: optionValue, label: optionLabel, icon: Glyph }) => (
        <label key={optionValue} className="seg__item">
          <input
            className="sr-only"
            type="radio"
            name={name}
            value={optionValue}
            checked={optionValue === value}
            onChange={() => onChange(optionValue)}
          />
          {Glyph && <Glyph aria-hidden="true" size={14} strokeWidth={1.75} />}
          {optionLabel}
        </label>
      ))}
    </fieldset>
  )
}
