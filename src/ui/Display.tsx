import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function Badge({
  tone = 'neutral',
  icon: Glyph,
  children,
}: {
  /** `side` takes the fighter color from the nearest `--side`. */
  tone?: 'neutral' | 'side' | 'positive' | undefined
  icon?: LucideIcon | undefined
  children: ReactNode
}) {
  return (
    <span className="badge" data-tone={tone}>
      {Glyph && <Glyph aria-hidden="true" size={12} strokeWidth={2} />}
      {children}
    </span>
  )
}

export type StatusState = 'ready' | 'thinking' | 'done' | 'error'

const STATUS_LABEL: Record<StatusState, string> = {
  ready: 'Ready',
  thinking: 'Thinking',
  done: 'Done',
  error: 'Error',
}

export function Status({ state, label }: { state: StatusState; label?: string | undefined }) {
  return (
    <span className="status" data-state={state}>
      <span className="status__dot" aria-hidden="true" />
      <span className="status__label">{label ?? STATUS_LABEL[state]}</span>
    </span>
  )
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}
