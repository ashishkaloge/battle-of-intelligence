import { describe, expect, it } from 'vitest'
import {
  countDivisors,
  drawProblems,
  latticePaths,
  powMod,
  totient,
  trailingZeros,
} from './problems.ts'

/** Reads the numbers back out of a problem's text, so each answer is checked a second way. */
const nums = (text: string) =>
  [...text.replace(/(\d),(\d)/g, '$1$2').matchAll(/\d+/g)].map((m) => Number(m[0]))

const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹'
/** "7²⁰²⁶" back to "7^2026". */
const unsup = (text: string) =>
  text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (run) => `^${[...run].map((c) => SUPER.indexOf(c)).join('')}`)

/** Brute force: the slow, obvious way, for every family. */
function check(text: string): number | null {
  const pow = unsup(text).match(/(\d+)\^(\d+)/)
  if (text.includes('raised to the power') && pow) {
    // The whole exponent, no shortcut: square-and-multiply with exact integers.
    const a = BigInt(nums(text)[0] ?? 0)
    const [, b, c] = pow
    const m = BigInt(nums(text.split('divided by')[1] ?? '')[0] ?? 1)
    let e = BigInt(b ?? 0) ** BigInt(c ?? 0)
    let base = a % m
    let r = 1n
    while (e > 0n) {
      if (e & 1n) r = (r * base) % m
      base = (base * base) % m
      e >>= 1n
    }
    return Number(r)
  }
  if (text.includes('factorial') && text.includes('divide')) {
    // Build n! exactly, then strip out every prime by repeated division.
    const n = nums(text)[0] ?? 0
    let f = 1n
    for (let k = 2n; k <= BigInt(n); k++) f *= k
    let count = 1
    for (let p = 2n; p <= BigInt(n); p++) {
      let e = 0
      while (f % p === 0n) {
        f /= p
        e++
      }
      count *= e + 1
    }
    return count
  }
  if (text.startsWith('What is the remainder') && pow) {
    const [, a, e] = pow
    const m = nums(text.split('divided by')[1] ?? '')[0] ?? 1
    let r = 1
    for (let i = 0; i < Number(e); i++) r = (r * Number(a)) % m
    return r
  }
  if (text.startsWith('What are the last two digits') && pow) {
    const [, a, e] = pow
    let r = 1
    for (let i = 0; i < Number(e); i++) r = (r * Number(a)) % 100
    return r
  }
  if (text.includes('factorial')) {
    const n = nums(text)[0] ?? 0
    let zeros = 0
    for (let k = 1; k <= n; k++) for (let j = k; j % 5 === 0; j /= 5) zeros++
    return zeros
  }
  if (text.includes('divide')) {
    const n = nums(text)[0] ?? 0
    let count = 0
    for (let d = 1; d <= n; d++) if (n % d === 0) count++
    return count
  }
  if (text.includes('divisible by')) {
    const [, n = 0, a = 1, b = 1, c = 1] = nums(text)
    let count = 0
    for (let k = 1; k <= n; k++) if (k % a === 0 || k % b === 0 || k % c === 0) count++
    return count
  }
  if (text.includes('routes')) {
    const [m = 0, n = 0] = nums(text)
    // Count every string of m rights and n ups, one at a time.
    const walk = (r: number, u: number): number =>
      r === 0 || u === 0 ? 1 : walk(r - 1, u) + walk(r, u - 1)
    return walk(m, n)
  }
  if (text.includes('no common factor')) {
    const n = nums(text)[1] ?? 0
    const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
    let count = 0
    for (let k = 1; k <= n; k++) if (g(k, n) === 1) count++
    return count
  }
  return null
}

describe('the Buzzer problem families', () => {
  it('compute what the textbook says', () => {
    expect(powMod(2, 2026, 7)).toBe(2)
    expect(powMod(7, 2026, 100)).toBe(49)
    expect(trailingZeros(2026)).toBe(505)
    expect(trailingZeros(100)).toBe(24)
    expect(countDivisors(360)).toBe(24)
    expect(totient(36)).toBe(12)
    expect(latticePaths(2, 2)).toBe(6)
    expect(latticePaths(8, 8)).toBe(12870)
  })

  it('draw the same fight from the same seed, never two alike in a row', () => {
    const a = drawProblems(99, 7)
    expect(drawProblems(99, 7)).toEqual(a)
    expect(a).toHaveLength(7)
    expect(new Set(a.map((p) => p.text)).size).toBe(7)
    expect(drawProblems(100, 7)).not.toEqual(a)
  })

  it('have answers a brute force agrees with, and three hints each', () => {
    let checked = 0
    const texts: string[] = []
    for (let seed = 1; seed <= 40; seed++) {
      for (const problem of drawProblems(seed, 7)) {
        texts.push(problem.text)
        expect(problem.hints).toHaveLength(3)
        expect(Number.isSafeInteger(problem.answer)).toBe(true)
        const brute = check(problem.text)
        if (brute === null) throw new Error(`no brute force for: ${problem.text}`)
        expect(brute, problem.text).toBe(problem.answer)
        checked++
      }
    }
    expect(checked).toBe(280)
    // The two hardest families turn up in the draws.
    expect(texts.some((t) => t.includes('raised to the power'))).toBe(true)
    expect(texts.some((t) => t.includes('factorial) exactly'))).toBe(true)
  })
})
