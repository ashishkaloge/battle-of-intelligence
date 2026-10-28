import { blank, type Grid } from './grid.ts'

/** Small, fast, seedable generator (mulberry32). The same seed always gives the same pool. */
export function seededRandom(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  const pickOne = <T>(items: readonly T[]): T => {
    const item = items[int(0, items.length - 1)]
    if (item === undefined) throw new Error('pickOne needs at least one item')
    return item
  }
  return { next, int, pickOne }
}

type Shape = Array<[number, number]>

/** Shapes that give every toolbox move something to act on: holes to fill, lines to extend. */
function shapeFor(
  kind: 'dot' | 'bar' | 'block' | 'ring' | 'ell',
  random: ReturnType<typeof seededRandom>,
): Shape {
  const cells: Shape = []
  switch (kind) {
    case 'dot':
      return [[0, 0]]
    case 'bar': {
      const length = random.int(2, 4)
      const vertical = random.next() < 0.5
      for (let i = 0; i < length; i++) cells.push(vertical ? [i, 0] : [0, i])
      return cells
    }
    case 'block': {
      const rows = random.int(2, 3)
      const cols = random.int(2, 3)
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.push([y, x])
      return cells
    }
    case 'ring': {
      const side = random.int(3, 4)
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          if (y === 0 || x === 0 || y === side - 1 || x === side - 1) cells.push([y, x])
        }
      }
      return cells
    }
    case 'ell': {
      const length = random.int(2, 3)
      for (let i = 0; i <= length; i++) cells.push([i, 0])
      for (let i = 1; i <= length - 1; i++) cells.push([length, i])
      return cells
    }
  }
}

/**
 * The pool both makers pick from: fresh input grids, 5 to 8 cells a side, each holding 2 to 4
 * objects in the pool's 3 colors. Objects never touch, so each one stays a separate object.
 */
export function generatePool(seed: number, count = 12): Grid[] {
  const random = seededRandom(seed)
  const palette: number[] = []
  while (palette.length < 3) {
    const color = random.int(1, 9)
    if (!palette.includes(color)) palette.push(color)
  }
  const kinds = ['dot', 'bar', 'block', 'ring', 'ell'] as const

  return Array.from({ length: count }, () => {
    const rows = random.int(5, 8)
    const cols = random.int(5, 8)
    const grid = blank(rows, cols)
    const objects = random.int(2, 4)
    for (let placed = 0, tries = 0; placed < objects && tries < 40; tries++) {
      const shape = shapeFor(random.pickOne(kinds), random)
      const color = random.pickOne(palette)
      const oy = random.int(0, rows - 1)
      const ox = random.int(0, cols - 1)
      const fits = shape.every(([y, x]) => {
        const ty = oy + y
        const tx = ox + x
        if (ty >= rows || tx >= cols) return false
        // Keep a one-cell gap around other objects.
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((grid[ty + dy]?.[tx + dx] ?? 0) !== 0) return false
          }
        }
        return true
      })
      if (!fits) continue
      for (const [y, x] of shape) {
        const row = grid[oy + y]
        if (row) row[ox + x] = color
      }
      placed++
    }
    return grid
  })
}
