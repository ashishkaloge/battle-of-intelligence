import { describe, expect, it } from 'vitest'
import {
  type Action,
  chipsInPlay,
  IllegalAction,
  isRight,
  newTable,
  playHand,
  type Question,
  START_STACK,
  startHand,
  type TableState,
} from './table.ts'

const Q: Question = { text: 'Capital of Burkina Faso?', answer: 'Ouagadougou' }
const claim = (by: 'claude' | 'gpt', answer: string, bet: number): Action => ({
  by,
  kind: 'claim',
  answer,
  bet,
})

describe('answers', () => {
  it('never changes a numeric answer by stripping its sign, decimal point or units', () => {
    const numeric = { text: 'Number?', answer: '17' }
    for (const answer of [
      '-17',
      '−17',
      '1.7',
      '.17',
      '+.17',
      '-.17',
      '−.17',
      '17e0',
      '1.7e1',
      '.17e2',
      '0x11',
      '17%',
      '1,7',
      '17 things',
      '(17)',
      '[17]',
      '$17$',
      '17/1',
    ]) {
      expect(isRight(numeric, answer), answer).toBe(false)
    }
    expect(isRight(numeric, '+0017')).toBe(true)
    expect(isRight({ text: '', answer: '1009' }, '1,009')).toBe(true)
    expect(isRight({ text: '', answer: '-17' }, '−17')).toBe(true)
    expect(isRight({ text: '', answer: 'Challenger Deep' }, '  The Challenger-Deep  ')).toBe(true)
    for (const answer of ['-.17', '−.17', '.1.7', '- .17']) {
      expect(isRight({ text: '', answer: '.17' }, answer), answer).toBe(false)
    }
  })

  it('ignores case, accents, punctuation and a leading "the"', () => {
    expect(isRight({ text: '', answer: 'Selma Lagerlöf' }, 'selma lagerlof')).toBe(true)
    expect(isRight({ text: '', answer: 'Challenger Deep' }, 'The Challenger-Deep')).toBe(true)
    expect(isRight({ text: '', answer: '1,009' }, '1009')).toBe(true)
    expect(isRight({ text: '', answer: 'Q', accept: ['the letter Q'] }, 'The letter Q')).toBe(true)
    expect(isRight(Q, 'Bamako')).toBe(false)
  })
})

describe('a hand', () => {
  it('settles the pot exactly once', () => {
    const hand = startHand(newTable(), 'claude')
    hand.act(claim('claude', 'Ouagadougou', 5))
    hand.act({ by: 'gpt', kind: 'fold' })
    const finished = hand.finish(Q)
    const snapshot = structuredClone(finished)
    expect(() => hand.finish(Q)).toThrow('already settled')
    expect(finished).toEqual(snapshot)
    expect(chipsInPlay(finished.state)).toBe(2 * START_STACK)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    'rejects non-integer chip amounts without changing the hand: %s',
    (amount) => {
      const hand = startHand(newTable(), 'claude')
      const before = hand.status()
      expect(() => hand.act(claim('claude', 'Ouagadougou', amount))).toThrow(IllegalAction)
      expect(hand.status()).toEqual(before)
      hand.act(claim('claude', 'Ouagadougou', 5))
      const claimed = hand.status()
      expect(() =>
        hand.act({ by: 'gpt', kind: 'counter', answer: 'Bamako', raise: amount }),
      ).toThrow(IllegalAction)
      expect(hand.status()).toEqual(claimed)
    },
  )
  it('antes go in the middle and a fold gives the pot away unseen', () => {
    const { state, events } = playHand(newTable(), Q, 'claude', [
      claim('claude', 'Ouagadougou', 5),
      { by: 'gpt', kind: 'fold' },
    ])
    // Pot: 2 + 2 antes + 5 bet = 9, all to Claude.
    expect(state.stacks).toEqual({ claude: START_STACK + 2, gpt: START_STACK - 2 })
    expect(events).toContainEqual({ type: 'win', fighter: 'claude', amount: 9, shown: false })
  })

  it('a call is a showdown: a wrong claim loses the pot', () => {
    const { state, events } = playHand(newTable(), Q, 'claude', [
      claim('claude', 'Bamako', 5),
      { by: 'gpt', kind: 'call' },
    ])
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'showdown',
        answers: [{ by: 'claude', answer: 'Bamako', right: false }],
      }),
    )
    expect(state.stacks).toEqual({ claude: START_STACK - 7, gpt: START_STACK + 7 })
  })

  it('a counter raises, and the right answer takes it when called', () => {
    const { state } = playHand(newTable(), Q, 'gpt', [
      claim('gpt', 'Bamako', 4),
      { by: 'claude', kind: 'counter', answer: 'Ouagadougou', raise: 3 },
      { by: 'gpt', kind: 'call' },
    ])
    // Pot: 4 antes + 4 + (4 + 3) + 3 = 18; Claude put in 2 + 7 = 9 and gets 18 back.
    expect(state.stacks).toEqual({ claude: START_STACK + 9, gpt: START_STACK - 9 })
  })

  it('two wrong answers leave the pot for the next hand', () => {
    const { state, events } = playHand(newTable(), Q, 'gpt', [
      claim('gpt', 'Bamako', 4),
      { by: 'claude', kind: 'counter', answer: 'Niamey', raise: 2 },
      { by: 'gpt', kind: 'call' },
    ])
    expect(events).toContainEqual({ type: 'carry', amount: 16 })
    expect(state.carry).toBe(16)
    expect(chipsInPlay(state)).toBe(2 * START_STACK)
  })

  it('two passes carry the antes; a pass then lets the other side claim', () => {
    const passed = playHand(newTable(), Q, 'claude', [
      { by: 'claude', kind: 'pass' },
      { by: 'gpt', kind: 'pass' },
    ])
    expect(passed.state.carry).toBe(4)
    const taken = playHand(newTable(), Q, 'claude', [
      { by: 'claude', kind: 'pass' },
      claim('gpt', 'Ouagadougou', 3),
      { by: 'claude', kind: 'fold' },
    ])
    expect(taken.state.stacks.gpt).toBe(START_STACK + 2)
  })

  it('refuses illegal play', () => {
    const t = newTable()
    expect(() => playHand(t, Q, 'claude', [claim('gpt', 'x', 3)])).toThrow(IllegalAction)
    expect(() => playHand(t, Q, 'claude', [claim('claude', 'x', 21)])).toThrow(IllegalAction)
    expect(() => playHand(t, Q, 'claude', [{ by: 'claude', kind: 'call' }])).toThrow(IllegalAction)
    expect(() =>
      playHand(t, Q, 'claude', [
        claim('claude', 'Bamako', 3),
        { by: 'gpt', kind: 'counter', answer: 'bamako', raise: 2 },
      ]),
    ).toThrow(IllegalAction)
    expect(() => playHand(t, Q, 'claude', [claim('claude', 'x', 3)])).toThrow(IllegalAction)
  })

  it('running out of chips is a knockout', () => {
    const short: TableState = { ...newTable(), stacks: { claude: 12, gpt: 100 } }
    const { state, events } = playHand(short, Q, 'claude', [
      claim('claude', 'Bamako', 10),
      { by: 'gpt', kind: 'call' },
    ])
    expect(state.stacks.claude).toBe(0)
    expect(state.out).toBe('claude')
    expect(events).toContainEqual({ type: 'bust', fighter: 'claude' })
  })

  it('a simultaneous bust is a draw, independent of which fighter opened', () => {
    for (const opener of ['claude', 'gpt'] as const) {
      const rival = opener === 'claude' ? 'gpt' : 'claude'
      const short: TableState = { ...newTable(), stacks: { claude: 12, gpt: 12 }, carry: 96 }
      const { state, events } = playHand(short, Q, opener, [
        claim(opener, 'Bamako', 5),
        { by: rival, kind: 'counter', answer: 'Niamey', raise: 5 },
        { by: opener, kind: 'call' },
      ])
      expect(state).toMatchObject({
        stacks: { claude: 60, gpt: 60 },
        carry: 0,
        draw: true,
        out: null,
      })
      expect(events).toContainEqual({ type: 'split', amount: 120 })
      expect(events.filter((event) => event.type === 'bust')).toHaveLength(2)
      expect(chipsInPlay(state)).toBe(120)
      expect(() => startHand(state, rival)).toThrow('the round is over')
      expect(
        playHand(
          short,
          Q,
          opener,
          [
            claim(opener, 'Bamako', 5),
            { by: rival, kind: 'counter', answer: 'Niamey', raise: 5 },
            { by: opener, kind: 'call' },
          ],
          true,
        ),
      ).toEqual({ state, events })
    }
  })
})
