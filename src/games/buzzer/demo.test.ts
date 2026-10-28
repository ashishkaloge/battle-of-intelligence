import { describe, expect, it } from 'vitest'
import type { Fighter } from '../ring/arena.ts'
import { TOSSUPS } from './demo.ts'
import { type Decision, playTossup } from './quiz.ts'

const decisionsOf = (index: number) =>
  (TOSSUPS[index]?.turns ?? []).map((turn) => {
    const out: Partial<Record<Fighter, Decision>> = {}
    for (const [fighter, t] of Object.entries(turn) as [Fighter, { decision: Decision }][]) {
      out[fighter] = t.decision
    }
    return out
  })

const isPrime = (n: number) => {
  if (n < 2) return false
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false
  return true
}

const modPow = (base: bigint, exp: bigint, mod: bigint) => {
  let result = 1n
  let b = base % mod
  let e = exp
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod
    b = (b * b) % mod
    e >>= 1n
  }
  return result
}

describe('the scripted Buzzer', () => {
  it('every answer card is computed, not trusted', () => {
    const computed = [
      Number(modPow(2n, 2026n, 7n)),
      Number(modPow(7n, 2026n, 100n)),
      [5, 25, 125, 625, 3125].reduce((zeros, p) => zeros + Math.floor(2026 / p), 0),
      (() => {
        const ways = [1, 1]
        for (let n = 2; n <= 12; n++) ways.push((ways[n - 1] ?? 0) + (ways[n - 2] ?? 0))
        return ways[12]
      })(),
      Array.from({ length: 1000 }, (_, i) => i + 1).filter((n) => (n % 3 === 0) !== (n % 5 === 0))
        .length,
      (() => {
        const square = 2026 * 2026
        let count = 0
        for (let d = 1; d <= square; d++) if (square % d === 0) count++
        return count
      })(),
      Array.from({ length: 100 }, (_, i) => i + 1)
        .filter((n) => (n * n + n + 1) % 7 === 0)
        .reduce((sum, n) => sum + n, 0),
    ]
    expect(TOSSUPS.map((t) => t.problem.answer)).toEqual(computed)
    // The hint on tossup 6 says 1013 is prime.
    expect(isPrime(1013)).toBe(true)
  })

  it('plays out exactly as the commentary says', () => {
    const totals: Record<Fighter, number> = { claude: 0, gpt: 0 }
    const after: Record<Fighter, number>[] = []
    TOSSUPS.forEach((tossup, i) => {
      const { points } = playTossup(tossup.problem, decisionsOf(i), tossup.double)
      totals.claude += points.claude
      totals.gpt += points.gpt
      after.push({ ...totals })
    })
    // Tossup 5: "we are level at thirty".
    expect(after[4]).toEqual({ claude: 30, gpt: 30 })
    // Tossup 6: "GPT leads into the final tossup".
    expect((after[5]?.gpt ?? 0) > (after[5]?.claude ?? 0)).toBe(true)
    // The final: Claude wins, and patience was worth a thirty-point swing.
    expect(totals).toEqual({ claude: 50, gpt: 35 })
    const final = playTossup(
      TOSSUPS[6]?.problem ?? { text: '', hints: ['', '', ''], answer: 0 },
      decisionsOf(6),
      true,
    )
    expect(final.points.claude - final.points.gpt).toBe(30)
  })
})
