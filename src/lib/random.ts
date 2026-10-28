/** mulberry32: small, fast and the same everywhere, so a seed always draws the same fight. */
export function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Rand = () => number

export function pick<T>(rand: Rand, list: readonly T[]): T {
  const item = list[Math.floor(rand() * list.length)]
  if (item === undefined) throw new Error('empty list')
  return item
}

/** A whole number from `lo` to `hi`, both included. */
export const between = (rand: Rand, lo: number, hi: number) =>
  lo + Math.floor(rand() * (hi - lo + 1))

/** The list in a random order, by Fisher-Yates. */
export function shuffled<T>(rand: Rand, list: readonly T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const a = out[i] as T
    out[i] = out[j] as T
    out[j] = a
  }
  return out
}
