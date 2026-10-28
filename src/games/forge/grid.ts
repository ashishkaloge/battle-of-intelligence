/**
 * A grid is rows of cells. 0 is empty and 1 to 9 are colors, the same encoding ARC uses, so a
 * grid prints as rows of digits that every model already knows how to read.
 */
export type Grid = number[][]

export const MAX_SIDE = 30

export const height = (grid: Grid) => grid.length
export const width = (grid: Grid) => grid[0]?.length ?? 0

/** The cell at (y, x), or 0 outside the grid. */
export const cell = (grid: Grid, y: number, x: number) => grid[y]?.[x] ?? 0

export const blank = (rows: number, cols: number): Grid =>
  Array.from({ length: rows }, () => new Array<number>(cols).fill(0))

export const clone = (grid: Grid): Grid => grid.map((row) => row.slice())

export const sameGrid = (a: Grid, b: Grid) =>
  a.length === b.length &&
  a.every((row, y) => {
    const other = b[y]
    return other !== undefined && row.length === other.length && row.every((v, x) => v === other[x])
  })

/** Rows of digits joined by "/", the format models see in prompts. */
export const formatGrid = (grid: Grid) => grid.map((row) => row.join('')).join('/')

export const parseGrid = (text: string): Grid =>
  text.split('/').map((row) => Array.from(row, (digit) => Number(digit)))

export const colorsIn = (grid: Grid) => {
  const colors = new Set<number>()
  for (const row of grid) for (const value of row) if (value !== 0) colors.add(value)
  return colors
}
