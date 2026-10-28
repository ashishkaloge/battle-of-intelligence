import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { cx, flag } from '../lib/cx.ts'
import { ICON_SIZE } from './Button.tsx'

export type SelectOption<T extends string> = {
  value: T
  label: string
  description?: string | undefined
  disabled?: boolean | undefined
}

export type SelectProps<T extends string> = {
  /** Accessible name, read together with the current value. */
  label: string
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md' | 'xl' | undefined
  align?: 'start' | 'end' | undefined
  outline?: boolean | undefined
  icon?: LucideIcon | undefined
  disabled?: boolean | undefined
  className?: string | undefined
}

/**
 * Ghost dropdown: a transparent trigger that opens a floating listbox.
 * Keyboard follows the ARIA listbox pattern: arrows move, Home and End jump, Enter or Space picks,
 * Escape closes and returns focus to the trigger, Tab closes and moves on.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
  align = 'start',
  outline,
  icon: Glyph,
  disabled,
  className,
}: SelectProps<T>) {
  const id = useId()
  const listId = `${id}-list`
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<CSSProperties>({})

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = options[selectedIndex]
  const unavailable = disabled || !options.some((option) => !option.disabled)

  const positionMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 16)
    const below = window.innerHeight - rect.bottom - 14
    const above = rect.top - 14
    const flip = below < 180 && above > below
    setPosition({
      position: 'fixed',
      left: Math.max(
        8,
        Math.min(align === 'end' ? rect.right - width : rect.left, window.innerWidth - width - 8),
      ),
      right: 'auto',
      top: flip ? 'auto' : rect.bottom + 6,
      bottom: flip ? window.innerHeight - rect.top + 6 : 'auto',
      width,
      minWidth: 0,
      maxHeight: Math.max(80, Math.min(360, flip ? above : below)),
    })
  }, [align])

  /** Next enabled index from `from`, wrapping around. */
  const step = (from: number, direction: 1 | -1) => {
    for (let offset = 1; offset <= options.length; offset++) {
      const next = (from + direction * offset + options.length) % options.length
      if (!options[next]?.disabled) return next
    }
    return from
  }

  const openMenu = () => {
    if (unavailable) return
    positionMenu()
    setActive(selectedIndex >= 0 && !selected?.disabled ? selectedIndex : step(-1, 1))
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const choose = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    onChange(option.value)
    close()
  }

  useEffect(() => {
    if (!open) return
    listRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', positionMenu)
      window.removeEventListener('scroll', positionMenu, true)
    }
  }, [open, positionMenu])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu()
    }
  }

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((index) => step(index, 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActive((index) => step(index, -1))
        break
      case 'Home':
        event.preventDefault()
        setActive(step(-1, 1))
        break
      case 'End':
        event.preventDefault()
        setActive(step(options.length, -1))
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        choose(active)
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        close()
        break
      case 'Tab':
        // Continue native tab order from the trigger, not from the portal at the end of body.
        close()
        break
    }
  }

  const onListClick = (event: MouseEvent<HTMLDivElement>) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
    if (item) choose(Number(item.dataset.index))
  }

  return (
    <div ref={rootRef} className={cx('select', className)}>
      <button
        ref={triggerRef}
        type="button"
        className="btn select__trigger"
        data-size={size}
        data-outline={flag(outline)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${selected?.label ?? 'none'}`}
        disabled={unavailable}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        {Glyph && (
          <Glyph
            className="select__icon"
            aria-hidden="true"
            size={size === 'xl' ? 18 : ICON_SIZE[size]}
            strokeWidth={1.75}
          />
        )}
        <span className="select__value">{selected?.label}</span>
        <ChevronDown className="select__chevron" aria-hidden="true" strokeWidth={2} />
      </button>

      {open &&
        createPortal(
          // A native <select> cannot render two-line, styled options, so this is the ARIA listbox
          // pattern with keyboard support handled above.
          <div
            ref={listRef}
            id={listId}
            className="select__menu"
            style={position}
            data-align={align}
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={options[active] ? `${id}-${active}` : undefined}
            onKeyDown={onListKeyDown}
            onClick={onListClick}
          >
            {options.map((option, index) => (
              <OptionRow
                key={option.value}
                id={`${id}-${index}`}
                index={index}
                option={option}
                active={index === active}
                selected={option.value === value}
                onHover={setActive}
              />
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

function OptionRow<T extends string>({
  id,
  index,
  option,
  active,
  selected,
  onHover,
}: {
  id: string
  index: number
  option: SelectOption<T>
  active: boolean
  selected: boolean
  onHover: (index: number) => void
}): ReactNode {
  return (
    <div
      id={id}
      tabIndex={-1}
      className="select__option"
      role="option"
      data-index={index}
      data-active={flag(active)}
      aria-selected={selected}
      aria-disabled={option.disabled || undefined}
      onPointerMove={() => {
        if (!option.disabled && !active) onHover(index)
      }}
    >
      <span className="select__option-label">{option.label}</span>
      {option.description && <span className="select__option-desc">{option.description}</span>}
      <Check className="select__check" aria-hidden="true" strokeWidth={2.25} />
    </div>
  )
}
