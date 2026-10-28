import { describe, expect, it } from 'vitest'
import { IllegalDecision, NEG, type Problem, playTossup, VALUES } from './quiz.ts'

const P: Problem = { text: '6 × 7?', hints: ['a', 'b', 'c'], answer: 42 }
const buzz = (answer: number) => ({ kind: 'buzz' as const, answer })

describe('a tossup', () => {
  it('a right buzz on the problem alone is a power', () => {
    const { points, events } = playTossup(P, [{ claude: buzz(42) }])
    expect(points).toEqual({ claude: VALUES[0], gpt: 0 })
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'score', fighter: 'claude', power: true }),
    )
  })

  it('waiting costs value: a right buzz after two hints is worth less', () => {
    const { points, reveals } = playTossup(P, [{}, {}, { gpt: buzz(42) }])
    expect(points.gpt).toBe(VALUES[2])
    expect(reveals).toBe(3)
  })

  it('a wrong buzz is a neg, a lockout, and a steal for the other side', () => {
    const { points, events } = playTossup(P, [{ gpt: buzz(41) }, { claude: buzz(42) }])
    expect(points).toEqual({ claude: VALUES[1], gpt: -NEG })
    expect(events).toContainEqual({ type: 'neg', fighter: 'gpt', points: -NEG })
    expect(() => playTossup(P, [{ gpt: buzz(41) }, { gpt: buzz(42) }])).toThrow(IllegalDecision)
  })

  it('two right buzzes on the same reveal are a dead heat', () => {
    const { points, events } = playTossup(P, [{}, { claude: buzz(42), gpt: buzz(42) }])
    expect(points).toEqual({ claude: VALUES[1], gpt: VALUES[1] })
    expect(events).toContainEqual({ type: 'dead-heat', points: VALUES[1] })
  })

  it('one right and one wrong on the same reveal: the right one scores, the wrong one negs', () => {
    const { points } = playTossup(P, [{ claude: buzz(42), gpt: buzz(40) }])
    expect(points).toEqual({ claude: VALUES[0], gpt: -NEG })
  })

  it('nobody right after the last hint: no points, the answer is shown', () => {
    const { points, events } = playTossup(P, [{}, {}, {}, {}])
    expect(points).toEqual({ claude: 0, gpt: 0 })
    expect(events.at(-1)).toEqual({ type: 'end', answer: 42, winners: [] })
  })

  it('a double tossup doubles both the prize and the neg', () => {
    const { points } = playTossup(P, [{ gpt: buzz(1) }, { claude: buzz(42) }], true)
    expect(points).toEqual({ claude: 2 * (VALUES[1] ?? 0), gpt: -2 * NEG })
  })

  it('refuses decisions after the tossup is over', () => {
    expect(() => playTossup(P, [{ claude: buzz(42) }, { gpt: buzz(42) }])).toThrow(IllegalDecision)
  })
})
