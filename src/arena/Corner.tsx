import type { CSSProperties } from 'react'
import { Stat, Status, type StatusState } from '../ui/index.ts'
import type { Corner, Tier } from './corners.ts'

type Side = 'left' | 'right'

const tint = (corner: Corner) => ({ '--side': `var(--${corner.key})` }) as CSSProperties

/** A fighter's corner: lab, route and the model the shared tier puts in the ring. */
export function CornerCard({
  corner,
  side,
  tier,
  status,
  statusLabel,
}: {
  corner: Corner
  side: Side
  tier: Tier
  status: StatusState
  statusLabel?: string | undefined
}) {
  const model = corner.models[tier]
  return (
    <section
      className="corner"
      data-side={side}
      style={tint(corner)}
      aria-label={`${corner.name} corner`}
    >
      <div className="corner__top">
        <span className="corner__route">{corner.route}</span>
        <Status state={status} label={statusLabel} />
      </div>
      <h2 className="corner__name">{corner.name}</h2>
      <p className="corner__model">{model.name}</p>
      <code className="corner__id">{model.id}</code>
    </section>
  )
}

/** Rounds won and CLI calls made across the five fights at the chosen tier. */
export function CornerStats({
  corner,
  side,
  won,
  calls,
}: {
  corner: Corner
  side: Side
  won?: number
  calls: number
}) {
  return (
    <div className="corner-stats" data-side={side} style={tint(corner)}>
      <Stat label="Rounds won" value={won ?? '—'} />
      <Stat label="Calls" value={calls} />
    </div>
  )
}
