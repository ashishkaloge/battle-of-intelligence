import type { Fighter } from './ring/arena.ts'

/** Safe in filenames and copyable CLI examples, including metadata loaded from saved JSON. */
export const isBroadcastId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)

/** What every recorded fight shares, whatever the round: who played, how hard, and who won. */
export type FightMeta = {
  /** Rounds sharing this id belong to one separately recorded five-round broadcast. */
  broadcast?: string
  models: Record<Fighter, { name: string; id: string }>
  /** The CLI effort flag each corner ran at. Both corners always share one setting. */
  effort: Record<Fighter, string>
  winner: Fighter | null
  calls: Record<Fighter, number>
  playedAt: string
}
