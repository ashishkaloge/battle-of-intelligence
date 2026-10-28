import { between, pick, type Rand, random, shuffled } from '../../lib/random.ts'
import type { Problem } from './quiz.ts'

/**
 * Problems for live Buzzer fights. Each family draws its numbers from a seed and computes its own
 * answer, and the three hints are steps of the same working, from a way in to nearly there. So a
 * fight's problems are new to both models, and the answer card is always right.
 */

const SUPER: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
}
const sup = (n: number) => [...`${n}`].map((d) => SUPER[d] ?? d).join('')
const pow = (base: number, exp: number) => `${base}${sup(exp)}`
const fmt = (n: number) => n.toLocaleString('en-US')

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** a^e mod m without overflow, for the small moduli these problems use. */
export function powMod(a: number, e: number, m: number): number {
  let result = 1 % m
  let base = a % m
  let exp = e
  while (exp > 0) {
    if (exp & 1) result = (result * base) % m
    base = (base * base) % m
    exp >>= 1
  }
  return result
}

/** The smallest k > 0 with a^k ≡ 1 (mod m). */
export function order(a: number, m: number): number {
  for (let k = 1; k <= m; k++) if (powMod(a, k, m) === 1) return k
  throw new Error(`${a} has no order mod ${m}`)
}

export function factor(n: number): [number, number][] {
  const out: [number, number][] = []
  let rest = n
  for (let p = 2; p * p <= rest; p++) {
    let e = 0
    while (rest % p === 0) {
      rest /= p
      e++
    }
    if (e > 0) out.push([p, e])
  }
  if (rest > 1) out.push([rest, 1])
  return out
}

const factorText = (n: number) =>
  factor(n)
    .map(([p, e]) => (e === 1 ? `${p}` : pow(p, e)))
    .join(' × ')

export function countDivisors(n: number): number {
  let count = 0
  for (let d = 1; d * d <= n; d++) {
    if (n % d === 0) count += d * d === n ? 1 : 2
  }
  return count
}

export function totient(n: number): number {
  let count = 0
  for (let k = 1; k <= n; k++) if (gcd(k, n) === 1) count++
  return count
}

export function trailingZeros(n: number): number {
  let count = 0
  for (let p = 5; p <= n; p *= 5) count += Math.floor(n / p)
  return count
}

/** Monotone lattice paths from one corner of an m by n grid to the other, by counting them. */
export function latticePaths(m: number, n: number): number {
  const row = Array.from({ length: n + 1 }, () => 1)
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) row[j] = (row[j] ?? 0) + (row[j - 1] ?? 0)
  return row[n] ?? 0
}

export type Family =
  | 'tower'
  | 'factorial-divisors'
  | 'power-mod'
  | 'last-two'
  | 'trailing-zeros'
  | 'divisors'
  | 'either'
  | 'paths'
  | 'totient'

/** The exponent of each prime in n!, by Legendre's formula. */
export function factorialPrimes(n: number): [number, number][] {
  const out: [number, number][] = []
  for (let p = 2; p <= n; p++) {
    if (factor(p).length !== 1 || factor(p)[0]?.[1] !== 1) continue
    let e = 0
    for (let q = p; q <= n; q *= p) e += Math.floor(n / q)
    out.push([p, e])
  }
  return out
}

/**
 * The two hardest families come first: each takes a long chain of working that is easy to slip
 * on without the hints, which is what makes waiting for one worth it.
 */
const MAKERS: Record<Family, (rand: Rand) => Problem | null> = {
  tower: (rand) => {
    const m = pick(rand, [53, 59, 61, 67, 71, 73, 79, 83, 89, 97])
    const a = between(rand, 2, 20)
    const b = between(rand, 2, 9)
    const c = between(rand, 3, 9)
    const k = order(a, m)
    if (k < 10) return null
    const e = powMod(b, c, k)
    return {
      text: `What is the remainder when ${a} raised to the power ${pow(b, c)} is divided by ${m}?`,
      hints: [
        `Reduce the exponent modulo the order of ${a} modulo ${m}.`,
        `${pow(a, k)} leaves a remainder of 1 when divided by ${m}.`,
        `${pow(b, c)} leaves a remainder of ${e} when divided by ${k}.`,
      ],
      answer: powMod(a, e, m),
    }
  },
  'factorial-divisors': (rand) => {
    const n = between(rand, 12, 22)
    const primes = factorialPrimes(n)
    return {
      text: `How many positive whole numbers divide ${n}! (${n} factorial) exactly?`,
      hints: [
        `Find the power of each prime in ${n}!.`,
        `${n}! = ${primes.map(([p, e]) => (e === 1 ? `${p}` : pow(p, e))).join(' × ')}.`,
        'For p^a × q^b × …, the count is (a + 1)(b + 1)….',
      ],
      answer: primes.reduce((count, [, e]) => count * (e + 1), 1),
    }
  },
  'power-mod': (rand) => {
    const m = pick(rand, [13, 17, 19, 23, 29, 31, 37, 41, 43])
    const a = between(rand, 2, 12)
    if (gcd(a, m) !== 1) return null
    const n = between(rand, 1000, 9999)
    const k = order(a, m)
    if (k < 6) return null
    const q = Math.floor(n / k)
    const r = n % k
    return {
      text: `What is the remainder when ${pow(a, n)} is divided by ${m}?`,
      hints: [
        `Powers of ${a} repeat when divided by ${m}.`,
        `${pow(a, k)} leaves a remainder of 1 when divided by ${m}.`,
        `${fmt(n)} = ${k} × ${q} + ${r}.`,
      ],
      answer: powMod(a, n, m),
    }
  },
  'last-two': (rand) => {
    const a = pick(rand, [3, 7, 9, 11, 13, 17, 19, 21, 23, 27, 29, 31, 33, 37, 39, 41, 43, 47])
    const n = between(rand, 1000, 9999)
    const k = order(a, 100)
    const answer = powMod(a, n, 100)
    if (answer < 10 || k < 4) return null
    return {
      text: `What are the last two digits of ${pow(a, n)}?`,
      hints: [
        `Look at powers of ${a} modulo 100.`,
        `${pow(a, k)} ends in 01.`,
        `${fmt(n)} = ${k} × ${Math.floor(n / k)} + ${n % k}.`,
      ],
      answer,
    }
  },
  'trailing-zeros': (rand) => {
    const n = between(rand, 10_000, 99_999)
    const parts: string[] = []
    for (let p = 5; p <= n; p *= 5) parts.push(`${Math.floor(n / p)}`)
    return {
      text: `How many zeros are at the end of ${fmt(n)}! (${fmt(n)} factorial)?`,
      hints: [
        'Each trailing zero needs a factor of 5; there are always more 2s.',
        'Count the multiples of 5, then of 25, of 125, and so on.',
        `Those counts are ${parts.join(', ')}.`,
      ],
      answer: trailingZeros(n),
    }
  },
  divisors: (rand) => {
    const primes = shuffled(rand, [2, 3, 5, 7, 11, 13, 17]).slice(0, between(rand, 3, 4))
    let n = 1
    for (const p of primes) n *= p ** between(rand, 1, p <= 3 ? 5 : 2)
    if (n > 5_000_000 || n < 1000) return null
    return {
      text: `How many positive whole numbers divide ${fmt(n)} exactly?`,
      hints: [
        'Factor it into primes first.',
        `${fmt(n)} = ${factorText(n)}.`,
        'For p^a × q^b × …, the count is (a + 1)(b + 1)….',
      ],
      answer: countDivisors(n),
    }
  },
  either: (rand) => {
    const [a, b, c] = shuffled(rand, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]).slice(0, 3) as [
      number,
      number,
      number,
    ]
    if ([a, b, c].some((x) => [a, b, c].some((y) => x !== y && x % y === 0))) return null
    const n = between(rand, 2000, 20_000)
    const lcm = (...xs: number[]) => xs.reduce((l, x) => (l * x) / gcd(l, x), 1)
    const f = (d: number) => Math.floor(n / d)
    const pairs = [lcm(a, b), lcm(a, c), lcm(b, c)]
    const all = lcm(a, b, c)
    const [ab = 0, ac = 0, bc = 0] = pairs.map(f)
    return {
      text: `How many whole numbers from 1 to ${fmt(n)} are divisible by ${a}, ${b} or ${c}?`,
      hints: [
        'Add the three counts, take away each overlap of two, then add back the overlap of all three.',
        `The overlaps are multiples of ${pairs.join(', ')} and, for all three, ${all}.`,
        `${f(a)} + ${f(b)} + ${f(c)} − ${ab} − ${ac} − ${bc} + ${f(all)}.`,
      ],
      answer: f(a) + f(b) + f(c) - ab - ac - bc + f(all),
    }
  },
  paths: (rand) => {
    const m = between(rand, 6, 11)
    const n = between(rand, 5, 9)
    return {
      text: `A robot walks from the bottom-left to the top-right corner of a ${m} by ${n} grid of squares, one unit right or up at a time. How many different routes can it take?`,
      hints: [
        'Every route is a string of rights and ups.',
        `Each route has ${m + n} steps: ${m} right and ${n} up.`,
        `Choose which ${m} of the ${m + n} steps go right.`,
      ],
      answer: latticePaths(m, n),
    }
  },
  totient: (rand) => {
    const primes = shuffled(rand, [2, 3, 5, 7, 11, 13, 17, 19, 23]).slice(0, between(rand, 3, 4))
    let n = 1
    for (const p of primes) n *= p ** between(rand, 1, p <= 3 ? 3 : 2)
    if (n < 1000 || n > 200_000) return null
    return {
      text: `How many whole numbers from 1 to ${fmt(n)} share no common factor with ${fmt(n)} other than 1?`,
      hints: [
        `That is Euler's totient of ${fmt(n)}.`,
        `${fmt(n)} = ${factorText(n)}.`,
        'Multiply n by (1 − 1/p) for each prime p that divides it.',
      ],
      answer: totient(n),
    }
  },
}

export const FAMILIES = Object.keys(MAKERS) as Family[]

/**
 * A fight's problems: one per family in a shuffled order, so no two in a row are alike, all drawn
 * from `seed`. A family that rolls numbers it cannot use rolls again.
 */
export function drawProblems(seed: number, count: number): Problem[] {
  const rand = random(seed)
  const order = shuffled(rand, FAMILIES)
  const out: Problem[] = []
  for (let i = 0; out.length < count; i++) {
    const family = order[i % order.length] as Family
    let problem: Problem | null = null
    for (let tries = 0; !problem && tries < 50; tries++) problem = MAKERS[family](rand)
    if (problem && !out.some((p) => p.text === problem.text)) out.push(problem)
  }
  return out
}
