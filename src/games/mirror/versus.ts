import { type Grid, sameGrid } from '../forge/grid.ts'
import { describeMove, type Move, runProgram } from '../forge/moves.ts'
import { checkPuzzle } from '../forge/solver.ts'
import { FIGHTERS, type Fighter, other } from '../ring/arena.ts'

/**
 * Mirror: versus ARC. Each turn both models get the same base puzzle, mirrored: the same example
 * inputs, the same test, the same hidden rule. Clear it and your garbage is wiped, and you send an
 * attack: one toolbox move stacked on top of the opponent's next puzzle, so its rule becomes the
 * base rule plus everything stacked on it. Miss and your garbage stays. An attack lands only if
 * Forge's solver proves the attacked puzzle still has exactly one answer; otherwise it is blocked.
 * A third stacked attack tops you out: a knockout.
 */

/** Stacked attacks that knock a side out. */
export const TOP_OUT = 3
/** The longest rule any puzzle can have: one base move plus two stacked attacks. */
export const BUDGET = 3

export type Base = { program: readonly Move[]; examples: readonly Grid[]; test: Grid }

/** Missing on historical records, which checked an attack against the next puzzle only. */
export type MirrorRules = { persistentAttackCheck: boolean }
export const LIVE_RULES: MirrorRules = { persistentAttackCheck: true }

/** What a model does on a turn: the rule it believes, and the attack it sends if it clears. */
export type Play = { hypothesis: readonly Move[]; attack?: Move }

export type Attack = { move: Move; landed: boolean; reason?: string; ko: boolean }

export type TurnResult = {
  turn: number
  /** Each side's puzzle this turn: its full rule, the example outputs, and the true answer. */
  puzzles: Record<Fighter, { program: Move[]; outputs: Grid[]; truth: Grid }>
  answers: Record<Fighter, { hypothesis: Move[]; grid: Grid | null; right: boolean }>
  attacks: Partial<Record<Fighter, Attack>>
  stacks: Record<Fighter, Move[]>
  clears: Record<Fighter, number>
  ko: Fighter | null
}

export class IllegalPlay extends Error {}

const outputsFor = (program: readonly Move[], base: Base) => {
  const outputs = base.examples.map((input) => runProgram(program, input))
  const truth = runProgram(program, base.test)
  if (!truth || outputs.some((o) => o === null)) {
    throw new IllegalPlay(`the rule ${program.map(describeMove).join(' → ')} cannot apply`)
  }
  return { outputs: outputs as Grid[], truth }
}

/**
 * Plays a whole match. `plays[t]` is what each side does on turn t; the match stops early on a
 * knockout. Attacks are checked against the next turn's base puzzle, which is what they land on.
 */
export function playMatch(
  bases: readonly Base[],
  plays: readonly Record<Fighter, Play>[],
  rules: MirrorRules = { persistentAttackCheck: false },
): { turns: TurnResult[]; ko: Fighter | null; winner: Fighter | null } {
  const stacks: Record<Fighter, Move[]> = { claude: [], gpt: [] }
  const clears: Record<Fighter, number> = { claude: 0, gpt: 0 }
  const turns: TurnResult[] = []
  let ko: Fighter | null = null

  for (let t = 0; t < plays.length; t++) {
    const base = bases[t]
    const play = plays[t]
    if (!base || !play) throw new IllegalPlay(`no base puzzle for turn ${t + 1}`)
    if (ko) throw new IllegalPlay('the match is already over')

    const puzzles = {} as TurnResult['puzzles']
    const answers = {} as TurnResult['answers']
    for (const fighter of FIGHTERS) {
      const program = [...base.program, ...stacks[fighter]]
      const { outputs, truth } = outputsFor(program, base)
      puzzles[fighter] = { program, outputs, truth }
      const hypothesis = [...play[fighter].hypothesis]
      const grid = runProgram(hypothesis, base.test)
      answers[fighter] = { hypothesis, grid, right: grid !== null && sameGrid(grid, truth) }
    }

    // Clears wipe the clearer's garbage first; then attacks land on what is left.
    for (const fighter of FIGHTERS) {
      if (answers[fighter].right) {
        stacks[fighter] = []
        clears[fighter] += 1
      } else if (play[fighter].attack) {
        throw new IllegalPlay(`${fighter} missed on turn ${t + 1} and cannot attack`)
      }
    }

    const attacks: TurnResult['attacks'] = {}
    const next = bases[t + 1]
    for (const fighter of FIGHTERS) {
      const move = play[fighter].attack
      if (!move) continue
      const target = other(fighter)
      const stacked = [...stacks[target], move]
      if (stacked.length >= TOP_OUT) {
        stacks[target] = stacked
        attacks[fighter] = { move, landed: true, ko: true }
        ko ??= target
        continue
      }
      if (!next) {
        attacks[fighter] = { move, landed: false, reason: 'no next puzzle', ko: false }
        continue
      }
      // The referee's fairness check: the attacked puzzle must still have exactly one answer.
      // A missed puzzle keeps its stack. Prove it remains playable on every later base, not just
      // the next one: for example, a diagonal may work on that square and fail on a later rectangle.
      // The stack is public, so only the base move is unknown; searching it as a fixed suffix is
      // both more faithful to the prompt and much cheaper than rediscovering all three moves.
      const verdict = rules.persistentAttackCheck
        ? bases
            .slice(t + 1)
            .map((future) => checkPuzzle(future, future.program.length, stacked))
            .find((checked) => !checked.valid)
        : checkPuzzle(
            { program: [...next.program, ...stacked], examples: next.examples, test: next.test },
            Math.min(BUDGET, next.program.length + stacked.length),
          )
      if (!verdict || verdict.valid) {
        stacks[target] = stacked
        attacks[fighter] = { move, landed: true, ko: false }
      } else {
        attacks[fighter] = { move, landed: false, reason: verdict.reason, ko: false }
      }
    }

    turns.push({
      turn: t + 1,
      puzzles,
      answers,
      attacks,
      stacks: { claude: [...stacks.claude], gpt: [...stacks.gpt] },
      clears: { ...clears },
      ko,
    })
    if (ko) break
  }

  const winner: Fighter | null = ko
    ? other(ko)
    : clears.claude === clears.gpt
      ? stacks.claude.length === stacks.gpt.length
        ? null
        : stacks.claude.length < stacks.gpt.length
          ? 'claude'
          : 'gpt'
      : clears.claude > clears.gpt
        ? 'claude'
        : 'gpt'
  return { turns, ko, winner }
}
