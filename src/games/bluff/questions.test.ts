import { describe, expect, it } from 'vitest'
import {
  CAPITALS,
  daysBetween,
  drawQuestions,
  ELEMENTS,
  isPrime,
  nextPrime,
  nthPrime,
  piDigits,
  primesBelow,
  weekday,
} from './questions.ts'
import { isRight } from './table.ts'

describe('the Bluff question bank', () => {
  it('has the whole periodic table in order', () => {
    expect(ELEMENTS).toHaveLength(118)
    expect(new Set(ELEMENTS.map(([symbol]) => symbol)).size).toBe(118)
    const number = (symbol: string) => ELEMENTS.findIndex(([s]) => s === symbol) + 1
    // Anchors anyone can check against a printed table.
    expect(number('H')).toBe(1)
    expect(number('C')).toBe(6)
    expect(number('Fe')).toBe(26)
    expect(number('Kr')).toBe(36)
    expect(number('Xe')).toBe(54)
    expect(number('W')).toBe(74)
    expect(number('Re')).toBe(75)
    expect(number('Au')).toBe(79)
    expect(number('Rn')).toBe(86)
    expect(number('U')).toBe(92)
    expect(number('Lr')).toBe(103)
    expect(number('Og')).toBe(118)
  })

  it('works out primes and weekdays rather than remembering them', () => {
    expect(nextPrime(1000)).toBe(1009)
    expect(nextPrime(10000)).toBe(10007)
    expect(primesBelow(100)).toBe(25)
    expect(primesBelow(1000)).toBe(168)
    expect(isPrime(7919)).toBe(true)
    expect(weekday(2000, 1, 1)).toBe('Saturday')
    expect(weekday(1969, 7, 20)).toBe('Sunday')
    expect(weekday(1900, 3, 1)).toBe('Thursday')
  })

  it('keeps the capital table free of duplicates', () => {
    expect(new Set(CAPITALS.map(([country]) => country)).size).toBe(CAPITALS.length)
  })

  it('computes pi, nth primes and day counts exactly', () => {
    expect(piDigits(50)).toBe('14159265358979323846264338327950288419716939937510')
    expect(nthPrime(1)).toBe(2)
    expect(nthPrime(1000)).toBe(7919)
    expect(daysBetween([2000, 1, 1], [2001, 1, 1])).toBe(366)
    expect(daysBetween([1999, 12, 31], [2000, 3, 1])).toBe(61)
  })

  it('draws the same fight from the same seed, a spread of kinds, and no repeats', () => {
    const a = drawQuestions(42, 8)
    expect(drawQuestions(42, 8)).toEqual(a)
    expect(drawQuestions(43, 8)).not.toEqual(a)
    expect(new Set(a.map((q) => q.text)).size).toBe(8)
    const starts = new Set(a.map((q) => q.text.split(' ').slice(0, 5).join(' ')))
    expect(starts.size).toBeGreaterThanOrEqual(7)
  })

  it('accepts the answer, its alternates and nothing empty', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const q of drawQuestions(seed, 8)) {
        expect(isRight(q, q.answer), q.text).toBe(true)
        for (const also of q.accept ?? []) if (also.trim()) expect(isRight(q, also)).toBe(true)
        expect(isRight(q, '')).toBe(false)
      }
    }
    const ohm = { text: 'SI unit of resistance?', answer: 'ohm', accept: ['Ω'] }
    expect(isRight(ohm, 'Ohm')).toBe(true)
    expect(isRight(ohm, '')).toBe(false)
  })
})
