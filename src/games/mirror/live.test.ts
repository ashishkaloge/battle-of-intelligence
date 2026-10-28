import { describe, expect, it } from 'vitest'
import { drawBases, type MirrorRecord } from './live.ts'
import { playMatch } from './versus.ts'

describe('saved Mirror fights', () => {
  const saved = import.meta.glob<MirrorRecord>('./fights/*.json', {
    eager: true,
    import: 'default',
  })

  it('reproduces historical verdicts under each record’s original rules', () => {
    expect(Object.keys(saved).length).toBeGreaterThan(0)
    for (const record of Object.values(saved)) {
      expect(playMatch(record.bases, record.turns, record.rules), record.id).toEqual(record.result)
    }
  })
})

describe('Mirror puzzle generation bounds', () => {
  it.each([-1, 0.5, 16, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an impossible puzzle count: %s',
    (count) => {
      expect(() => drawBases(2026, count)).toThrow(RangeError)
    },
  )

  it('allows an empty requested pool', () => {
    expect(drawBases(2026, 0)).toEqual([])
  })
})
