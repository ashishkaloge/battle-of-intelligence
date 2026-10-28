import type { Dir, Move, Target } from './moves.ts'

/**
 * The text form of a move, as models write it: `gravity(down)`, `recolor(2,5)`, `crop()`.
 * Models answer with these strings because they are easy to write and easy to check, and a flat
 * list of strings fits every lab's structured output rules.
 */
export function formatMove(move: Move): string {
  switch (move.op) {
    case 'rotate':
      return `rotate(${move.turns})`
    case 'mirror':
      return `mirror(${move.axis})`
    case 'shift':
    case 'gravity':
    case 'extend':
      return `${move.op}(${move.dir})`
    case 'recolor':
      return `recolor(${move.from},${move.to})`
    case 'swap':
      return `swap(${move.a},${move.b})`
    case 'paint':
      return `paint(${move.target},${move.color})`
    case 'keep':
      return `keep(${move.target})`
    case 'outline':
    case 'fill':
      return `${move.op}(${move.color})`
    case 'crop':
    case 'scale':
      return `${move.op}()`
    case 'symmetry':
      return `symmetry(${move.from})`
  }
}

/** One example per move, shown in prompts so models copy the exact syntax. */
export const SYNTAX_EXAMPLES =
  'rotate(1), mirror(left-right), shift(up), gravity(down), extend(right), recolor(2,5), swap(3,4), paint(largest,6), keep(smallest), outline(3), fill(4), crop(), scale(), symmetry(left)'

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right']
const TARGETS: readonly Target[] = ['largest', 'smallest']

const isDir = (value: string): value is Dir => (DIRS as readonly string[]).includes(value)
const isTarget = (value: string): value is Target => (TARGETS as readonly string[]).includes(value)

const color = (value: string | undefined, allowEmpty = false) => {
  const n = Number(value)
  const min = allowEmpty ? 0 : 1
  return value !== undefined && /^\d$/.test(value.trim()) && n >= min && n <= 9 ? n : null
}

export type Parsed = { ok: true; move: Move } | { ok: false; error: string }

/** Parses one move. Errors say what was wrong so a retry prompt can quote them. */
export function parseMove(text: string): Parsed {
  const match = /^\s*([a-z]+)\s*(?:\(([^)]*)\))?\s*$/i.exec(text)
  if (!match) return { ok: false, error: `"${text}" is not a move` }
  const name = (match[1] ?? '').toLowerCase()
  const args = (match[2] ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '')
  const fail = (why: string): Parsed => ({ ok: false, error: `"${text}": ${why}` })
  const [a, b] = args

  switch (name) {
    case 'rotate': {
      const turns = Number(a)
      return turns === 1 || turns === 2 || turns === 3
        ? { ok: true, move: { op: 'rotate', turns } }
        : fail('rotate takes 1, 2 or 3')
    }
    case 'mirror':
      return a === 'left-right' || a === 'top-bottom' || a === 'diagonal'
        ? { ok: true, move: { op: 'mirror', axis: a } }
        : fail('mirror takes left-right, top-bottom or diagonal')
    case 'shift':
    case 'gravity':
    case 'extend':
      return a !== undefined && isDir(a)
        ? { ok: true, move: { op: name, dir: a } }
        : fail(`${name} takes up, down, left or right`)
    case 'recolor': {
      const from = color(a)
      const to = color(b, true)
      if (from === null || to === null) return fail('recolor takes a color 1-9 and a color 0-9')
      if (from === to) return fail('recolor needs two different colors')
      return { ok: true, move: { op: 'recolor', from, to } }
    }
    case 'swap': {
      const x = color(a)
      const y = color(b)
      if (x === null || y === null || x === y) return fail('swap takes two different colors 1-9')
      return { ok: true, move: { op: 'swap', a: x, b: y } }
    }
    case 'paint': {
      const c = color(b)
      if (a === undefined || !isTarget(a) || c === null) {
        return fail('paint takes largest or smallest, then a color 1-9')
      }
      return { ok: true, move: { op: 'paint', target: a, color: c } }
    }
    case 'keep':
      return a !== undefined && isTarget(a)
        ? { ok: true, move: { op: 'keep', target: a } }
        : fail('keep takes largest or smallest')
    case 'outline':
    case 'fill': {
      const c = color(a)
      return c === null
        ? fail(`${name} takes a color 1-9`)
        : { ok: true, move: { op: name, color: c } }
    }
    case 'crop':
    case 'scale':
      return args.length === 0 ? { ok: true, move: { op: name } } : fail(`${name} takes nothing`)
    case 'symmetry':
      return a === 'left' || a === 'right' || a === 'top' || a === 'bottom'
        ? { ok: true, move: { op: 'symmetry', from: a } }
        : fail('symmetry takes left, right, top or bottom')
    default:
      return fail('unknown move')
  }
}
