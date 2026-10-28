import { describe, expect, it } from 'vitest'
import { type BuzzerRecord, parseTurnReply, replayRecord } from './live.ts'

describe('saved Buzzer fights', () => {
  const saved = import.meta.glob<BuzzerRecord>('./fights/*.json', {
    eager: true,
    import: 'default',
  })

  it('reproduces every recorded score and winner', () => {
    expect(Object.keys(saved).length).toBeGreaterThan(0)
    for (const record of Object.values(saved)) {
      const score = replayRecord(record).at(-1)?.score
      expect(score, record.id).toEqual(record.end.score)
      if (!score) continue
      const winner = score.claude === score.gpt ? null : score.claude > score.gpt ? 'claude' : 'gpt'
      expect(winner, record.id).toBe(record.end.winner)
    }
  })
})

describe('Buzzer answer validation', () => {
  it.each(['', '   ', ',', '1 2', '4,2', '0x2a', '4.2e1', true, null, [], {}])(
    'rejects an unusable answer instead of coercing it: %j',
    (answer) => {
      expect(parseTurnReply(JSON.stringify({ action: 'buzz', answer })).ok).toBe(false)
    },
  )

  it.each([
    [0, 0],
    ['0', 0],
    [' -42 ', -42],
    ['1,458', 1458],
  ])('keeps a valid integer answer %j', (answer, expected) => {
    expect(parseTurnReply(JSON.stringify({ action: 'buzz', answer }))).toMatchObject({
      ok: true,
      value: { decision: { kind: 'buzz', answer: expected } },
    })
  })
})
