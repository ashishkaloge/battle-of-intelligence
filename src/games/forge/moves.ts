import { blank, cell, clone, type Grid, height, MAX_SIDE, width } from './grid.ts'

export type Dir = 'up' | 'down' | 'left' | 'right'
export type Target = 'largest' | 'smallest'

/**
 * The Forge toolbox. A rule is a short chain of these moves. Both models see this exact list and
 * its definitions, so the space of possible rules is public and the solver can search all of it.
 * Objects are groups of same-colored cells joined edge to edge.
 */
export type Move =
  | { op: 'rotate'; turns: 1 | 2 | 3 }
  | { op: 'mirror'; axis: 'left-right' | 'top-bottom' | 'diagonal' }
  | { op: 'shift'; dir: Dir }
  | { op: 'gravity'; dir: Dir }
  | { op: 'extend'; dir: Dir }
  | { op: 'recolor'; from: number; to: number }
  | { op: 'swap'; a: number; b: number }
  | { op: 'paint'; target: Target; color: number }
  | { op: 'keep'; target: Target }
  | { op: 'outline'; color: number }
  | { op: 'fill'; color: number }
  | { op: 'crop' }
  | { op: 'scale' }
  | { op: 'symmetry'; from: 'left' | 'right' | 'top' | 'bottom' }

export type Op = Move['op']

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right']
const STEP: Record<Dir, readonly [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
}

/** One line per move, exactly as models read it in the prompt. */
export const TOOLBOX: Record<Op, string> = {
  rotate: 'rotate(turns): turn the whole grid 90° clockwise, 1 to 3 times.',
  mirror:
    'mirror(axis): flip the grid left-right, top-bottom, or across the diagonal (square grids only).',
  shift: 'shift(dir): move every cell one step up, down, left or right, wrapping around the edge.',
  gravity:
    'gravity(dir): colored cells slide toward an edge until they hit the edge or another cell.',
  extend:
    'extend(dir): every colored cell shoots a line of its color in that direction until it hits a colored cell or the edge.',
  recolor: 'recolor(from, to): every cell of one color becomes another color (0 erases it).',
  swap: 'swap(a, b): two colors trade places.',
  paint:
    'paint(target, color): the largest or smallest object becomes that color (ties: all of them).',
  keep: 'keep(target): only the largest or smallest object stays; everything else is erased (ties: all of them).',
  outline: 'outline(color): every empty cell touching an object edge to edge gets that color.',
  fill: 'fill(color): every empty area sealed off from the border gets that color.',
  crop: 'crop: cut the grid down to the smallest box holding every colored cell.',
  scale: 'scale: every cell becomes a 2×2 block, doubling the grid.',
  symmetry:
    'symmetry(from): copy one half of the grid, mirrored, over the other half (from left, right, top or bottom).',
}

/** Applies a move. Returns null when the move cannot apply, such as a diagonal on a non-square grid. */
export function applyMove(move: Move, grid: Grid): Grid | null {
  switch (move.op) {
    case 'rotate': {
      let out = grid
      for (let turn = 0; turn < move.turns; turn++) out = rotateOnce(out)
      return out
    }
    case 'mirror':
      return mirror(grid, move.axis)
    case 'shift':
      return shift(grid, move.dir)
    case 'gravity':
      return gravity(grid, move.dir)
    case 'extend':
      return extend(grid, move.dir)
    case 'recolor':
      return mapColors(grid, (v) => (v === move.from ? move.to : v))
    case 'swap':
      return mapColors(grid, (v) => (v === move.a ? move.b : v === move.b ? move.a : v))
    case 'paint':
      return paint(grid, move.target, move.color)
    case 'keep':
      return keep(grid, move.target)
    case 'outline':
      return outline(grid, move.color)
    case 'fill':
      return fill(grid, move.color)
    case 'crop':
      return crop(grid)
    case 'scale':
      return scale(grid)
    case 'symmetry':
      return symmetry(grid, move.from)
  }
}

/** Runs a chain of moves. Null if any move cannot apply. */
export function runProgram(program: readonly Move[], grid: Grid): Grid | null {
  let out: Grid | null = grid
  for (const move of program) {
    if (!out) return null
    out = applyMove(move, out)
  }
  return out
}

/**
 * Every move the toolbox allows for a set of colors. The solver searches chains of these, so the
 * color list is limited to colors that actually appear in the puzzle.
 */
export function moveSpace(colors: readonly number[]): Move[] {
  const moves: Move[] = [
    { op: 'rotate', turns: 1 },
    { op: 'rotate', turns: 2 },
    { op: 'rotate', turns: 3 },
    { op: 'mirror', axis: 'left-right' },
    { op: 'mirror', axis: 'top-bottom' },
    { op: 'mirror', axis: 'diagonal' },
    { op: 'crop' },
    { op: 'scale' },
    { op: 'keep', target: 'largest' },
    { op: 'keep', target: 'smallest' },
  ]
  for (const dir of DIRS) {
    moves.push({ op: 'shift', dir }, { op: 'gravity', dir }, { op: 'extend', dir })
  }
  for (const from of ['left', 'right', 'top', 'bottom'] as const)
    moves.push({ op: 'symmetry', from })
  for (const color of colors) {
    moves.push(
      { op: 'paint', target: 'largest', color },
      { op: 'paint', target: 'smallest', color },
      { op: 'outline', color },
      { op: 'fill', color },
      { op: 'recolor', from: color, to: 0 },
    )
    for (const other of colors) {
      if (other === color) continue
      moves.push({ op: 'recolor', from: color, to: other })
      if (color < other) moves.push({ op: 'swap', a: color, b: other })
    }
  }
  return moves
}

/** Short label for a move chip, such as "Gravity ↓" or "Recolor 2 → 5". */
export function describeMove(move: Move): string {
  const arrow: Record<Dir, string> = { up: '↑', down: '↓', left: '←', right: '→' }
  switch (move.op) {
    case 'rotate':
      return `Rotate ${move.turns * 90}°`
    case 'mirror':
      return `Mirror ${move.axis.replace('-', '–')}`
    case 'shift':
      return `Shift ${arrow[move.dir]}`
    case 'gravity':
      return `Gravity ${arrow[move.dir]}`
    case 'extend':
      return `Extend ${arrow[move.dir]}`
    case 'recolor':
      return move.to === 0 ? `Erase ${move.from}` : `Recolor ${move.from} → ${move.to}`
    case 'swap':
      return `Swap ${move.a} ↔ ${move.b}`
    case 'paint':
      return `Paint ${move.target} ${move.color}`
    case 'keep':
      return `Keep ${move.target}`
    case 'outline':
      return `Outline ${move.color}`
    case 'fill':
      return `Fill holes ${move.color}`
    case 'crop':
      return 'Crop'
    case 'scale':
      return 'Scale ×2'
    case 'symmetry':
      return `Symmetry from ${move.from}`
  }
}

// Geometry

function rotateOnce(grid: Grid): Grid {
  const rows = height(grid)
  const out = blank(width(grid), rows)
  grid.forEach((row, y) => {
    row.forEach((value, x) => {
      const target = out[x]
      if (target) target[rows - 1 - y] = value
    })
  })
  return out
}

function mirror(grid: Grid, axis: 'left-right' | 'top-bottom' | 'diagonal'): Grid | null {
  if (axis === 'left-right') return grid.map((row) => row.slice().reverse())
  if (axis === 'top-bottom') return grid.slice().reverse()
  if (height(grid) !== width(grid)) return null
  return grid.map((row, y) => row.map((_, x) => cell(grid, x, y)))
}

function shift(grid: Grid, dir: Dir): Grid {
  const rows = height(grid)
  const cols = width(grid)
  const [dy, dx] = STEP[dir]
  const out = blank(rows, cols)
  grid.forEach((row, y) => {
    row.forEach((value, x) => {
      const target = out[(y + dy + rows) % rows]
      if (target) target[(x + dx + cols) % cols] = value
    })
  })
  return out
}

/** Slides colored cells along each line toward the edge, keeping their order. */
function gravity(grid: Grid, dir: Dir): Grid {
  const rows = height(grid)
  const cols = width(grid)
  const out = blank(rows, cols)
  const vertical = dir === 'up' || dir === 'down'
  const lines = vertical ? cols : rows
  const length = vertical ? rows : cols
  for (let line = 0; line < lines; line++) {
    const values: number[] = []
    for (let i = 0; i < length; i++) {
      const value = vertical ? cell(grid, i, line) : cell(grid, line, i)
      if (value !== 0) values.push(value)
    }
    const toEnd = dir === 'down' || dir === 'right'
    const start = toEnd ? length - values.length : 0
    values.forEach((value, k) => {
      const i = start + k
      const y = vertical ? i : line
      const x = vertical ? line : i
      const target = out[y]
      if (target) target[x] = value
    })
  }
  return out
}

/** Rays are traced on the original grid, so they stop at original cells, never at other rays. */
function extend(grid: Grid, dir: Dir): Grid {
  const out = clone(grid)
  const [dy, dx] = STEP[dir]
  grid.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value === 0) return
      let ny = y + dy
      let nx = x + dx
      while (
        ny >= 0 &&
        ny < height(grid) &&
        nx >= 0 &&
        nx < width(grid) &&
        cell(grid, ny, nx) === 0
      ) {
        const target = out[ny]
        if (target) target[nx] = value
        ny += dy
        nx += dx
      }
    })
  })
  return out
}

function crop(grid: Grid): Grid {
  let top = Number.POSITIVE_INFINITY
  let bottom = -1
  let left = Number.POSITIVE_INFINITY
  let right = -1
  grid.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value === 0) return
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
      left = Math.min(left, x)
      right = Math.max(right, x)
    })
  })
  if (bottom < 0) return grid
  return grid.slice(top, bottom + 1).map((row) => row.slice(left, right + 1))
}

function scale(grid: Grid): Grid | null {
  if (height(grid) * 2 > MAX_SIDE || width(grid) * 2 > MAX_SIDE) return null
  return grid.flatMap((row) => {
    const wide = row.flatMap((value) => [value, value])
    return [wide, wide.slice()]
  })
}

function symmetry(grid: Grid, from: 'left' | 'right' | 'top' | 'bottom'): Grid {
  const rows = height(grid)
  const cols = width(grid)
  const out = clone(grid)
  out.forEach((row, y) => {
    row.forEach((_, x) => {
      if (from === 'left' && x >= cols - Math.floor(cols / 2)) row[x] = cell(grid, y, cols - 1 - x)
      if (from === 'right' && x < Math.floor(cols / 2)) row[x] = cell(grid, y, cols - 1 - x)
      if (from === 'top' && y >= rows - Math.floor(rows / 2)) row[x] = cell(grid, rows - 1 - y, x)
      if (from === 'bottom' && y < Math.floor(rows / 2)) row[x] = cell(grid, rows - 1 - y, x)
    })
  })
  return out
}

// Color and objects

function mapColors(grid: Grid, change: (value: number) => number): Grid {
  return grid.map((row) => row.map(change))
}

/** Groups of same-colored cells joined edge to edge, each as a list of [y, x]. */
export function objectsIn(grid: Grid): Array<Array<[number, number]>> {
  const seen = grid.map((row) => row.map(() => false))
  const objects: Array<Array<[number, number]>> = []
  grid.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value === 0 || seen[y]?.[x]) return
      const cells: Array<[number, number]> = []
      const stack: Array<[number, number]> = [[y, x]]
      const seenRow = seen[y]
      if (seenRow) seenRow[x] = true
      while (stack.length > 0) {
        const next = stack.pop()
        if (!next) break
        const [cy, cx] = next
        cells.push([cy, cx])
        for (const [dy, dx] of Object.values(STEP)) {
          const ny = cy + dy
          const nx = cx + dx
          const mark = seen[ny]
          if (mark && nx >= 0 && nx < mark.length && !mark[nx] && cell(grid, ny, nx) === value) {
            mark[nx] = true
            stack.push([ny, nx])
          }
        }
      }
      objects.push(cells)
    })
  })
  return objects
}

function pick(grid: Grid, target: Target) {
  const objects = objectsIn(grid)
  if (objects.length === 0) return []
  const sizes = objects.map((object) => object.length)
  const size = target === 'largest' ? Math.max(...sizes) : Math.min(...sizes)
  return objects.filter((object) => object.length === size)
}

function paint(grid: Grid, target: Target, color: number): Grid {
  const out = clone(grid)
  for (const object of pick(grid, target)) {
    for (const [y, x] of object) {
      const row = out[y]
      if (row) row[x] = color
    }
  }
  return out
}

function keep(grid: Grid, target: Target): Grid {
  const out = blank(height(grid), width(grid))
  for (const object of pick(grid, target)) {
    for (const [y, x] of object) {
      const row = out[y]
      if (row) row[x] = cell(grid, y, x)
    }
  }
  return out
}

function outline(grid: Grid, color: number): Grid {
  return grid.map((row, y) =>
    row.map((value, x) => {
      if (value !== 0) return value
      const touches = Object.values(STEP).some(([dy, dx]) => cell(grid, y + dy, x + dx) !== 0)
      return touches ? color : 0
    }),
  )
}

/** Empty cells the border cannot reach through other empty cells are sealed, and get filled. */
function fill(grid: Grid, color: number): Grid {
  const rows = height(grid)
  const cols = width(grid)
  const open = grid.map((row) => row.map(() => false))
  const stack: Array<[number, number]> = []
  grid.forEach((row, y) => {
    row.forEach((value, x) => {
      const edge = y === 0 || x === 0 || y === rows - 1 || x === cols - 1
      if (edge && value === 0) stack.push([y, x])
    })
  })
  while (stack.length > 0) {
    const next = stack.pop()
    if (!next) break
    const [y, x] = next
    const mark = open[y]
    if (!mark || x < 0 || x >= cols || mark[x] || cell(grid, y, x) !== 0) continue
    mark[x] = true
    for (const [dy, dx] of Object.values(STEP)) stack.push([y + dy, x + dx])
  }
  return grid.map((row, y) => row.map((value, x) => (value === 0 && !open[y]?.[x] ? color : value)))
}
