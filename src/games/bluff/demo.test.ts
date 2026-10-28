import { describe, expect, it } from 'vitest'
import { calibrate } from './calibration.ts'
import { CALIBRATION_LINE, HANDS } from './demo.ts'
import { chipsInPlay, isRight, newTable, playHand, START_STACK, type TableState } from './table.ts'

/** Plays every scripted hand through the engine and returns the table after each. */
function playAll() {
  const after: TableState[] = []
  let state = newTable()
  HANDS.forEach((hand, h) => {
    const actions = hand.moves.map((move) => move.action)
    state = playHand(state, hand.question, hand.opener, actions, h === HANDS.length - 1).state
    after.push(state)
  })
  return after
}

describe('the scripted Bluff', () => {
  it('every hand is legal and the chips always add up', () => {
    for (const state of playAll()) expect(chipsInPlay(state)).toBe(2 * START_STACK)
  })

  it('ends exactly as the commentary says', () => {
    const after = playAll()
    const last = after.at(-1)
    // Hand 5: "That call cost Claude twenty four."
    expect((after[3]?.stacks.claude ?? 0) - (after[4]?.stacks.claude ?? 0)).toBe(24)
    // Hand 7: "Its stack is down to forty two."
    expect(after[6]?.stacks.claude).toBe(42)
    // Hand 8: Claude busts and GPT wins by knockout.
    expect(last?.out).toBe('claude')
    expect(last?.stacks).toEqual({ claude: 0, gpt: 2 * START_STACK })
  })

  it('the truth cards are right where the script says the models were right', () => {
    // Hand 3: "Claude had it, and got bluffed out."
    const flux = HANDS[2]
    expect(flux && isRight(flux.question, flux.hole.claude.answer)).toBe(true)
    expect(flux && isRight(flux.question, flux.hole.gpt.answer)).toBe(false)
    // 1009 really is the first prime after 1000.
    const isPrime = (n: number) =>
      n > 1 && [...Array(Math.floor(Math.sqrt(n)) - 1)].every((_, i) => n % (i + 2) !== 0)
    expect([1001, 1003, 1005, 1007].some(isPrime)).toBe(false)
    expect(isPrime(1009)).toBe(true)
  })

  it('the calibration numbers match what Cori says', () => {
    const gpt = calibrate(HANDS, 'gpt')
    const claude = calibrate(HANDS, 'claude')
    expect([Math.round(gpt.said), Math.round(gpt.right)]).toEqual([61, 63])
    expect([Math.round(claude.said), Math.round(claude.right)]).toEqual([62, 50])
    expect(CALIBRATION_LINE.text).toMatch(/sixty one.*sixty three.*sixty two.*half/)
  })
})
