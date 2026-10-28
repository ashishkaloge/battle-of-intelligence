import { colorsIn, formatGrid, type Grid, sameGrid } from './grid.ts'
import { applyMove, type Move, moveSpace, runProgram } from './moves.ts'

/** A forged puzzle: the hidden rule, the example inputs it is shown on, and the test input. */
export type Puzzle = {
  program: readonly Move[]
  examples: readonly Grid[]
  test: Grid
}

export type Verdict =
  | {
      valid: true
      outputs: Grid[]
      answer: Grid
      /** Move chains the referee tried. Shown on screen as "rules checked". */
      rulesChecked: number
    }
  | {
      valid: false
      reason: 'over-budget' | 'cannot-apply' | 'test-unchanged' | 'ambiguous'
      rulesChecked: number
      /** Distinct test answers that fit every example. More than one makes the puzzle void. */
      answers: number
    }

/**
 * The referee's fairness check. A puzzle is valid only if every rule in the toolbox, up to the
 * move budget, that reproduces all the examples also gives the same test answer. Then the answer is
 * forced by the examples, and a breaker who reasons perfectly can always find it. Anything else is
 * a guessing game, so the puzzle is void.
 *
 * The search runs breadth first over the tuple (example inputs..., test input), so two chains that
 * reach the same grids are only expanded once. A known suffix is applied after every candidate;
 * Mirror uses this for the public attacks following its one unknown base move.
 */
export function checkPuzzle(puzzle: Puzzle, budget: number, suffix: readonly Move[] = []): Verdict {
  const { program, examples, test } = puzzle
  if (program.length === 0 || program.length > budget) {
    return { valid: false, reason: 'over-budget', rulesChecked: 0, answers: 0 }
  }
  const fullProgram = [...program, ...suffix]
  const outputs = examples.map((input) => runProgram(fullProgram, input))
  const answer = runProgram(fullProgram, test)
  if (!answer || outputs.some((output) => output === null)) {
    return { valid: false, reason: 'cannot-apply', rulesChecked: 0, answers: 0 }
  }
  const targets = outputs as Grid[]
  if (sameGrid(answer, test)) {
    return { valid: false, reason: 'test-unchanged', rulesChecked: 0, answers: 0 }
  }

  const colors = new Set<number>()
  for (const grid of [...examples, ...targets, test]) for (const c of colorsIn(grid)) colors.add(c)
  const space = moveSpace([...colors].sort((a, b) => a - b))

  const answers = new Set<string>()
  const consider = (state: Grid[]) => {
    const candidate = suffix.length === 0 ? state : state.map((grid) => runProgram(suffix, grid))
    if (candidate.some((grid) => grid === null)) return
    if (targets.every((target, i) => sameGrid(candidate[i] ?? [], target))) {
      answers.add(formatGrid(candidate[examples.length] ?? []))
    }
  }

  let frontier: Grid[][] = [[...examples, test]]
  const seen = new Set(frontier.map(stateKey))
  let rulesChecked = 0
  frontier.forEach(consider)

  for (let depth = 1; depth <= budget; depth++) {
    const last = depth === budget
    const next: Grid[][] = []
    for (const state of frontier) {
      for (const move of space) {
        rulesChecked++
        const moved = applyAll(move, state)
        if (!moved) continue
        // The deepest level is only checked, never expanded, so it needs no dedupe or storage.
        if (last) {
          consider(moved)
          continue
        }
        const key = stateKey(moved)
        if (seen.has(key)) continue
        seen.add(key)
        consider(moved)
        next.push(moved)
      }
    }
    frontier = next
  }

  if (answers.size === 1 && answers.has(formatGrid(answer))) {
    return { valid: true, outputs: targets, answer, rulesChecked }
  }
  return { valid: false, reason: 'ambiguous', rulesChecked, answers: answers.size }
}

function applyAll(move: Move, state: readonly Grid[]): Grid[] | null {
  const out: Grid[] = []
  for (const grid of state) {
    const moved = applyMove(move, grid)
    if (!moved) return null
    out.push(moved)
  }
  return out
}

const stateKey = (state: readonly Grid[]) => state.map(formatGrid).join('|')
