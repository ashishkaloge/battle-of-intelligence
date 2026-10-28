import { FIGHTERS, type Fighter } from '../ring/arena.ts'

/**
 * Buzzer: a math race measured in clues, not milliseconds. Each tossup is one problem with a
 * whole-number answer, revealed up a ladder: the problem alone, then three hints. At every reveal
 * both models decide in secret to buzz with an answer or wait. Right takes the reveal's value;
 * wrong is a neg, locks that model out, and the other keeps going with more hints. Two right buzzes
 * on the same reveal are a dead heat and both score. Pure and deterministic.
 */

/** What a right buzz is worth at each reveal: the problem alone, then after each hint. */
export const VALUES: readonly number[] = [15, 10, 5, 2]
/** What a wrong buzz costs. */
export const NEG = 5
export const REVEALS = VALUES.length

export type Problem = {
  text: string
  /** Three hints, from a way in to nearly there. */
  hints: readonly [string, string, string]
  answer: number
}

export type Decision = { kind: 'wait' } | { kind: 'buzz'; answer: number }

export type QuizEvent =
  | { type: 'reveal'; reveal: number; value: number; eligible: Fighter[] }
  | { type: 'buzz'; fighter: Fighter; answer: number; right: boolean; reveal: number }
  | { type: 'neg'; fighter: Fighter; points: number }
  | { type: 'score'; fighter: Fighter; points: number; reveal: number; power: boolean }
  | { type: 'dead-heat'; points: number }
  | { type: 'dead' }
  | { type: 'end'; answer: number; winners: Fighter[] }

export class IllegalDecision extends Error {}

const valueAt = (reveal: number, double: boolean) => (VALUES[reveal] ?? 0) * (double ? 2 : 1)

/**
 * Plays one tossup. `decisions[r]` holds what each model still in the race chose at reveal r; a
 * model with no entry waits. The tossup ends at the first right buzz, when nobody is left to buzz,
 * or after the last reveal. Returns each model's points and what happened, in order.
 */
export function playTossup(
  problem: Problem,
  decisions: readonly Partial<Record<Fighter, Decision>>[],
  double = false,
): { points: Record<Fighter, number>; events: QuizEvent[]; reveals: number } {
  const points: Record<Fighter, number> = { claude: 0, gpt: 0 }
  const events: QuizEvent[] = []
  const locked = new Set<Fighter>()
  let reveals = 0

  for (let reveal = 0; reveal < REVEALS; reveal++) {
    const eligible = FIGHTERS.filter((f) => !locked.has(f))
    if (eligible.length === 0) break
    const value = valueAt(reveal, double)
    events.push({ type: 'reveal', reveal, value, eligible })
    reveals = reveal + 1
    const chosen = decisions[reveal] ?? {}
    for (const fighter of FIGHTERS) {
      if (locked.has(fighter) && chosen[fighter]) {
        throw new IllegalDecision(`${fighter} is locked out and cannot decide at reveal ${reveal}`)
      }
    }

    const right: Fighter[] = []
    for (const fighter of eligible) {
      const decision = chosen[fighter]
      if (decision?.kind !== 'buzz') continue
      const correct = decision.answer === problem.answer
      events.push({ type: 'buzz', fighter, answer: decision.answer, right: correct, reveal })
      if (correct) {
        right.push(fighter)
      } else {
        const neg = NEG * (double ? 2 : 1)
        points[fighter] -= neg
        locked.add(fighter)
        events.push({ type: 'neg', fighter, points: -neg })
      }
    }

    if (right.length > 0) {
      for (const fighter of right) {
        points[fighter] += value
        events.push({ type: 'score', fighter, points: value, reveal, power: reveal === 0 })
      }
      if (right.length === 2) events.push({ type: 'dead-heat', points: value })
      if (decisions.slice(reveal + 1).some((d) => Object.keys(d).length > 0)) {
        throw new IllegalDecision(`decisions after the tossup ended at reveal ${reveal}`)
      }
      events.push({ type: 'end', answer: problem.answer, winners: right })
      return { points, events, reveals }
    }
  }

  if (
    decisions.length > reveals &&
    decisions.slice(reveals).some((d) => Object.keys(d).length > 0)
  ) {
    throw new IllegalDecision('decisions after the tossup ended')
  }
  events.push({ type: 'dead' })
  events.push({ type: 'end', answer: problem.answer, winners: [] })
  return { points, events, reveals }
}
