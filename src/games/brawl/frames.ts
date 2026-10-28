import { FIGHTERS, type Fighter } from '../ring/arena.ts'
import type { Crash, Dir, Pos } from './cycles.ts'
import type { Played } from './match.ts'

/**
 * A played match laid out for drawing: each cycle's whole path, and for every tick how much of it
 * exists, which way it faces, whether it boosted, what it said, and how many rings have closed.
 * Tick 0 is the start, before anyone moves.
 */
export type Frames = {
  paths: Record<Fighter, Pos[]>
  /** Cells of each path visible after tick t. */
  shown: Record<Fighter, number[]>
  facing: Record<Fighter, Dir[]>
  boosted: Record<Fighter, boolean[]>
  says: Partial<Record<Fighter, string>>[]
  closed: number[]
  crashes: Partial<Record<Fighter, Crash>>
  ticks: number
}

export function framesOf(played: Played): Frames {
  const paths = {} as Record<Fighter, Pos[]>
  const shown = {} as Record<Fighter, number[]>
  const facing = {} as Record<Fighter, Dir[]>
  const boosted = {} as Record<Fighter, boolean[]>
  for (const fighter of FIGHTERS) {
    const start = played.map.starts[fighter]
    paths[fighter] = [start.pos]
    shown[fighter] = [1]
    facing[fighter] = [start.dir]
    boosted[fighter] = [false]
  }
  const says: Frames['says'] = [{}]
  const closed = [0]
  played.ticks.forEach((tick) => {
    let rings = closed.at(-1) ?? 0
    const turned: Partial<Record<Fighter, { cells: Pos[]; boost: boolean }>> = {}
    for (const event of tick.events) {
      if (event.type === 'move') turned[event.fighter] = { cells: event.cells, boost: event.boost }
      if (event.type === 'close') rings += 1
    }
    for (const fighter of FIGHTERS) {
      const move = turned[fighter]
      const path = paths[fighter]
      const before = path.at(-1)
      if (move) path.push(...move.cells)
      const head = path.at(-1)
      let dir = facing[fighter].at(-1) ?? 'right'
      if (move && before && head) {
        dir =
          head.x > before.x
            ? 'right'
            : head.x < before.x
              ? 'left'
              : head.y > before.y
                ? 'down'
                : 'up'
      }
      shown[fighter].push(path.length)
      facing[fighter].push(dir)
      boosted[fighter].push(move?.boost ?? false)
    }
    says.push(tick.says)
    closed.push(rings)
  })
  return {
    paths,
    shown,
    facing,
    boosted,
    says,
    closed,
    crashes: played.crashes,
    ticks: played.ticks.length,
  }
}

/** The most recent taunt from a fighter within the last `window` ticks. */
export function recentSay(frames: Frames, fighter: Fighter, tick: number, window = 14) {
  for (let t = tick; t >= Math.max(0, tick - window); t--) {
    const say = frames.says[t]?.[fighter]
    if (say) return { text: say, at: t }
  }
  return null
}
