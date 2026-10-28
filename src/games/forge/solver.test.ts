import { describe, expect, it } from 'vitest'
import { parseGrid } from './grid.ts'
import type { Move } from './moves.ts'
import { generatePool } from './pool.ts'
import { checkPuzzle } from './solver.ts'

const grids = (...texts: string[]) => texts.map(parseGrid)

describe('checkPuzzle', () => {
  it('rejects a rule longer than the budget', () => {
    const program: Move[] = [{ op: 'rotate', turns: 1 }, { op: 'crop' }, { op: 'scale' }]
    const verdict = checkPuzzle({ program, examples: grids('10/00'), test: parseGrid('01/00') }, 2)
    expect(verdict).toMatchObject({ valid: false, reason: 'over-budget' })
  })

  it('rejects a rule that cannot apply to every grid', () => {
    const program: Move[] = [{ op: 'mirror', axis: 'diagonal' }]
    const verdict = checkPuzzle(
      { program, examples: grids('12/30'), test: parseGrid('120/000') },
      2,
    )
    expect(verdict).toMatchObject({ valid: false, reason: 'cannot-apply' })
  })

  it('rejects a test where the rule changes nothing', () => {
    const program: Move[] = [{ op: 'gravity', dir: 'down' }]
    const verdict = checkPuzzle({ program, examples: grids('10/00'), test: parseGrid('00/01') }, 2)
    expect(verdict).toMatchObject({ valid: false, reason: 'test-unchanged' })
  })

  it('voids a puzzle whose examples fit more than one answer', () => {
    // One symmetric example fits both a quarter turn and a mirror, which disagree on the test.
    const program: Move[] = [{ op: 'rotate', turns: 1 }]
    const verdict = checkPuzzle(
      { program, examples: grids('010/111/010'), test: parseGrid('100/000/000') },
      1,
    )
    expect(verdict).toMatchObject({ valid: false, reason: 'ambiguous' })
    if (!verdict.valid) expect(verdict.answers).toBeGreaterThan(1)
  })

  it('backs every verdict with a full search of the toolbox', () => {
    const pool = generatePool(7)
    const program: Move[] = [
      { op: 'gravity', dir: 'down' },
      { op: 'mirror', axis: 'left-right' },
    ]
    const [a, b, c, test] = [pool[0], pool[1], pool[2], pool[3]]
    if (!a || !b || !c || !test) throw new Error('pool too small')
    const verdict = checkPuzzle({ program, examples: [a, b, c], test }, 2)
    // Random grids may still leave room for doubt, so the referee's answer either way must be
    // backed by a real search.
    expect(verdict.rulesChecked).toBeGreaterThan(1000)
  })

  it('checks a public suffix after every candidate base and rejects an inapplicable suffix', () => {
    const pool = generatePool(7)
    const puzzle = {
      program: [{ op: 'gravity', dir: 'down' }] as Move[],
      examples: pool.slice(0, 3),
      test: pool[3] ?? [],
    }
    const suffix: Move[] = [{ op: 'mirror', axis: 'left-right' }]
    const known = checkPuzzle(puzzle, 1, suffix)
    const unknown = checkPuzzle({ ...puzzle, program: [...puzzle.program, ...suffix] }, 2)
    expect(known.valid).toBe(true)
    expect(unknown.valid).toBe(true)
    expect(known.rulesChecked).toBeLessThan(unknown.rulesChecked / 10)
    if (known.valid && unknown.valid) {
      expect(known.outputs).toEqual(unknown.outputs)
      expect(known.answer).toEqual(unknown.answer)
    }
    expect(
      checkPuzzle({ ...puzzle, test: parseGrid('100/020') }, 1, [
        { op: 'mirror', axis: 'diagonal' },
      ]),
    ).toMatchObject({ valid: false, reason: 'cannot-apply' })
  })
})

describe('generatePool', () => {
  it('is the same for the same seed and different for another', () => {
    expect(generatePool(42)).toEqual(generatePool(42))
    expect(generatePool(42)).not.toEqual(generatePool(43))
  })

  it('makes twelve grids of 5 to 8 cells a side in three colors', () => {
    const pool = generatePool(1)
    expect(pool).toHaveLength(12)
    const colors = new Set(pool.flat(2).filter((v) => v !== 0))
    expect(colors.size).toBeLessThanOrEqual(3)
    for (const grid of pool) {
      expect(grid.length).toBeGreaterThanOrEqual(5)
      expect(grid.length).toBeLessThanOrEqual(8)
    }
  })
})
