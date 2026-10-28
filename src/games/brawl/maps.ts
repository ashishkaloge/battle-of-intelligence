import type { Fighter } from '../ring/arena.ts'
import type { MapSpec, Pos } from './cycles.ts'

export const WIDTH = 31
export const HEIGHT = 17

/** Small, fast, seeded PRNG (mulberry32). The same seed always builds the same floor. */
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A floor for one match. Pillars are scattered over one half and mirrored through the center, so
 * both starts see the same floor. `flip` swaps which side each fighter starts on, so a bout of
 * five plays both sides of every layout pair.
 */
export function makeMap(seed: number, flip: boolean): MapSpec {
  const rand = random(seed)
  const walls: Pos[] = []
  const taken = new Set<string>()
  const mirror = (p: Pos): Pos => ({ x: WIDTH - 1 - p.x, y: HEIGHT - 1 - p.y })
  const add = (p: Pos) => {
    for (const q of [p, mirror(p)]) {
      const key = `${q.x},${q.y}`
      if (!taken.has(key)) {
        taken.add(key)
        walls.push(q)
      }
    }
  }
  const pieces = 5 + Math.floor(rand() * 3)
  for (let i = 0; i < pieces; i++) {
    // Keep pillars off the outer ring and out of the starting lanes.
    const x = 3 + Math.floor(rand() * 12)
    const y = 2 + Math.floor(rand() * (HEIGHT - 6))
    const long = 1 + Math.floor(rand() * 3)
    const vertical = rand() < 0.5
    const cells = Array.from({ length: long }, (_, k) =>
      vertical ? { x, y: y + k } : { x: x + k, y },
    )
    const inLane = cells.some((c) => Math.abs(c.y - 8) <= 1 && c.x <= 8)
    if (!inLane) for (const cell of cells) add(cell)
  }
  const left = { pos: { x: 3, y: 8 }, dir: 'right' as const }
  const right = { pos: { x: WIDTH - 4, y: 8 }, dir: 'left' as const }
  const starts: Record<Fighter, { pos: Pos; dir: 'left' | 'right' }> = flip
    ? { claude: right, gpt: left }
    : { claude: left, gpt: right }
  return { width: WIDTH, height: HEIGHT, walls, starts }
}
