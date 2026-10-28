import { describe, expect, it } from 'vitest'
import { calibrate } from './calibration.ts'
import {
  actPrompt,
  type BluffRecord,
  holePrompt,
  LIMITS,
  optionsText,
  parseActReply,
  parseHoleReply,
  recordHands,
  replayRecord,
} from './live.ts'
import { newTable, type Question, startHand } from './table.ts'

describe('saved Bluff fights', () => {
  const saved = import.meta.glob<BluffRecord>('./fights/*.json', { eager: true, import: 'default' })

  it('reproduces every recorded final stack and winner', () => {
    expect(Object.keys(saved).length).toBeGreaterThan(0)
    for (const record of Object.values(saved)) {
      const final = replayRecord(record).at(-1)?.after
      expect(final?.stacks, record.id).toEqual(record.end.stacks)
      if (!final) continue
      const winner =
        final.stacks.claude === final.stacks.gpt
          ? null
          : final.stacks.claude > final.stacks.gpt
            ? 'claude'
            : 'gpt'
      expect(winner, record.id).toBe(record.end.winner)
    }
  })
})

const question: Question = {
  text: 'What is the SI unit of magnetic flux?',
  answer: 'weber',
  accept: ['Wb'],
}

describe('live Bluff prompts and replies', () => {
  it('asks for a secret answer without showing the rival anything', () => {
    const prompt = holePrompt({
      me: 'claude',
      question,
      hand: 0,
      table: newTable(),
      limits: LIMITS,
      history: [],
    })
    expect(prompt).toContain('The question: What is the SI unit of magnetic flux?')
    expect(prompt).toContain('Chips: you 60, GPT 60. Ante this hand: 2.')
    expect(prompt).not.toContain('weber')
  })

  it('reads a secret answer and rejects one without a usable confidence', () => {
    expect(parseHoleReply('ok {"answer":"weber","confidence":"80%","think":"flux"}')).toEqual({
      ok: true,
      value: { answer: 'weber', confidence: 80, think: 'Answers "weber" with 80% confidence.' },
    })
    expect(parseHoleReply('{"answer":"weber","confidence":180}').ok).toBe(false)
    expect(parseHoleReply('{"answer":"","confidence":50}').ok).toBe(false)
    expect(parseHoleReply('no json').ok).toBe(false)
  })

  it('only accepts what the table allows at that moment', () => {
    const hand = startHand(newTable(), 'claude')
    const open = hand.status()
    expect(optionsText(open).join(' ')).toContain('bet 1 to 20')
    expect(parseActReply('{"action":"call"}', 'claude', open).ok).toBe(false)
    expect(
      parseActReply('{"action":"claim","answer":"weber","amount":25}', 'claude', open).ok,
    ).toBe(false)
    const claim = parseActReply(
      '{"action":"claim","answer":"weber","amount":6,"think":"sure"}',
      'claude',
      open,
    )
    expect(claim).toEqual({
      ok: true,
      value: {
        action: { by: 'claude', kind: 'claim', answer: 'weber', bet: 6 },
        think: 'Claude claimed "weber" and bet 6.',
        say: '',
      },
    })
    if (!claim.ok) throw new Error('claim')
    hand.act(claim.value.action)
    const facing = hand.status()
    expect(
      parseActReply('{"action":"counter","answer":"Weber","amount":4}', 'gpt', facing).ok,
    ).toBe(false)
    expect(
      parseActReply('{"action":"counter","answer":"tesla","amount":4}', 'gpt', facing).ok,
    ).toBe(true)
    const prompt = actPrompt({
      me: 'gpt',
      question,
      hand: 0,
      hole: { answer: 'tesla', confidence: 40, think: '' },
      status: facing,
      done: [claim.value.action],
      limits: LIMITS,
      history: [],
    })
    expect(prompt).toContain('Your secret answer: "tesla", 40% sure.')
    expect(prompt).toContain('This hand so far: Claude claimed "weber" and bet 6.')
    expect(prompt).toContain('"call": put in 6')
  })

  it('turns a record into the demo shape, with the referee standing in for a missed decision', () => {
    const record: BluffRecord = {
      version: 1,
      round: 'bluff',
      id: 'test',
      playedAt: '2026-10-23T10:00:00.000Z',
      models: {
        claude: { name: 'Claude Haiku 5.5', id: 'h' },
        gpt: { name: 'GPT-6 Luna', id: 'l' },
      },
      effort: { claude: 'low', gpt: 'low' },
      limits: { ...LIMITS, hands: 1 },
      seed: 1,
      prompt: 1,
      left: 'gpt',
      hands: [
        {
          question,
          opener: 'gpt',
          hole: {
            claude: {
              answer: 'weber',
              confidence: 70,
              think: 'flux',
              ruling: 'played',
              seconds: 3,
              calls: 1,
            },
            gpt: { answer: '', confidence: 0, think: '', ruling: 'late', seconds: 60, calls: 1 },
          },
          moves: [
            {
              action: { by: 'gpt', kind: 'pass' },
              think: '',
              ruling: 'late',
              seconds: 60,
              calls: 1,
            },
            {
              action: { by: 'claude', kind: 'claim', answer: 'weber', bet: 5 },
              think: 'sure',
              ruling: 'played',
              seconds: 2,
              calls: 1,
            },
            {
              action: { by: 'gpt', kind: 'fold' },
              think: 'no idea',
              ruling: 'played',
              seconds: 2,
              calls: 1,
            },
          ],
        },
      ],
      end: { reason: 'hands', winner: 'claude', stacks: { claude: 62, gpt: 58 } },
      calls: { claude: 2, gpt: 3 },
      seconds: 130,
    }
    const { hands, intro, calibration } = recordHands(record)
    expect(hands[0]?.hole.gpt.think).toContain('No reply inside the shot clock')
    expect(hands[0]?.hole.gpt.submitted).toBe(false)
    expect(calibrate(hands, 'gpt').points).toEqual([])
    expect(calibration.text).toContain('GPT submitted no private answers')
    expect(calibration.text).not.toContain('GPT said 0')
    expect(hands[0]?.moves[0]?.think).toContain('The referee passes for it')
    expect(hands[0]?.line.text).toContain('GPT folds, and Claude takes 9 without a showdown')
    expect(intro.text).toContain('Claude Haiku 5.5 against GPT-6 Luna')
    expect(calibration.text).toContain('Claude said 70 percent and was right 100 percent')
    const first = hands[0]
    if (!first) throw new Error('expected the recorded hand')
    const mixed = [
      ...hands,
      {
        ...first,
        hole: {
          ...first.hole,
          gpt: { answer: 'weber', confidence: 80, think: '', submitted: true },
        },
      },
    ]
    expect(calibrate(mixed, 'gpt')).toEqual({
      points: [{ hand: 2, confidence: 80, right: true }],
      said: 80,
      right: 100,
      hits: 1,
    })
  })
})
