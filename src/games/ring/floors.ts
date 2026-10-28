import type { Arena, Tile } from './arena.ts'
import { makeDemoArena } from './demo.ts'

const W = 9
const H = 5

/**
 * Crossroads, the floor for live fights. The demo's floor boxes its center in: belts on either
 * side throw you straight back onto it and traps sit right above and below, so a fighter on the
 * center cannot leave without a knockdown and nobody can stand beside it safely. Here every cell
 * next to the center is plain floor, so the holder can step off any way and a challenger can come
 * at it from four sides. The hazards sit one step further out, where they decide which angle is
 * worth taking:
 *
 *        0 1 2 3 4 5 6 7 8
 *   y=0  . . # . ! . . . .
 *   y=1  . . . . . . . . .
 *   y=2  C . > . * . < . G
 *   y=3  . . . . . . . . .
 *   y=4  . . . . ! . # . .
 *
 * - The belts at (2,2) and (6,2) fling a fighter onto the cells beside the center, so a straight
 *   rush still meets in the middle by the third turn.
 * - The traps at (4,0) and (4,4) sit behind the cells above and below the center. A challenger
 *   there has its back to a trap, and a holder shoved off that way lands with one behind it too.
 * - A fighter shoved from beside the center onto a belt is held there, since a belt cannot throw
 *   it onto the shover, so striking from the center costs the holder its seat.
 *
 * It is a mirror image through the center, like the demo's, so neither corner has the better side.
 */
export function makeCrossroads(): Arena {
  const tiles: Tile[] = new Array(W * H).fill(null).map(() => ({ kind: 'empty' }) as Tile)
  const set = (x: number, y: number, tile: Tile) => {
    tiles[y * W + x] = tile
  }
  set(2, 0, { kind: 'wall' })
  set(6, 4, { kind: 'wall' })
  set(2, 2, { kind: 'conveyor', dir: 'right' })
  set(6, 2, { kind: 'conveyor', dir: 'left' })
  set(4, 0, { kind: 'trap' })
  set(4, 4, { kind: 'trap' })
  return {
    name: 'Crossroads',
    width: W,
    height: H,
    tiles,
    center: { x: 4, y: 2 },
    starts: { claude: { x: 0, y: 2 }, gpt: { x: 8, y: 2 } },
  }
}

/** Floors a live fight can be played on, by the name the fight script takes. */
export const FLOORS = {
  crossroads: makeCrossroads,
  cage: () => ({ ...makeDemoArena(), name: 'Cage' }),
} as const

export type FloorName = keyof typeof FLOORS

/** Fights recorded before floors had names were all played on the demo's floor. */
export const floorName = (arena: Arena) => arena.name ?? 'Cage'
