import { describe, expect, it } from 'vitest'
import { LIMITS, recordHands, replayRecord } from '../src/games/bluff/live.ts'
import { chipsInPlay, type Question } from '../src/games/bluff/table.ts'
import type { Fighter } from '../src/games/ring/arena.ts'
import { playBluff } from './bluff.ts'
import type { AskOptions, AskResult } from './cli.ts'

type Script = (options: AskOptions, call: number) => Promise<AskResult> | AskResult

const text = (value: object): AskResult => ({
  text: JSON.stringify(value),
  seconds: 1,
  toolUse: [],
})

function fake(scripts: Record<Fighter, Script>) {
  const calls: Record<Fighter, AskOptions[]> = { claude: [], gpt: [] }
  const ask = async (options: AskOptions) => {
    const list = calls[options.lab]
    list.push(options)
    return scripts[options.lab](options, list.length)
  }
  return { ask, calls }
}

const questions: Question[] = [
  { text: 'What is the atomic number of rhenium?', answer: '75' },
  { text: 'What is the capital of Bhutan?', answer: 'Thimphu' },
]

/** A player who always knows the answer and claims it, and calls anything it is shown. */
const sure: Script = (options) => {
  const answer = options.prompt.includes('rhenium') ? '75' : 'Thimphu'
  if (options.prompt.includes('answer it in secret')) {
    return text({ answer, confidence: 90, think: 'I know this' })
  }
  if (options.prompt.includes('"claim"'))
    return text({ action: 'claim', answer, amount: 5, think: 'sure' })
  return text({ action: 'call', think: 'checking' })
}

const quick = { ...LIMITS, hands: 2 }

describe('the Bluff referee', () => {
  it('ends an equal simultaneous bust as a draw and returns the unclaimed pot', async () => {
    const wrong: Script = (options) => {
      if (options.prompt.includes('answer it in secret')) {
        return text({ answer: 'wrong', confidence: 10 })
      }
      const bet = /"claim":.+?bet 1 to (\d+)/.exec(options.prompt)?.[1]
      if (bet)
        return text({
          action: 'claim',
          answer: 'wrong',
          amount: Math.max(1, Math.floor(Number(bet) / 2)),
        })
      const raise = /"counter":.+?raise 1 to (\d+)/.exec(options.prompt)?.[1]
      if (raise) return text({ action: 'counter', answer: 'also wrong', amount: Number(raise) })
      return text({ action: 'call' })
    }
    const record = await playBluff({
      tier: 'third',
      effort: { claude: 'low', gpt: 'low' },
      signal: new AbortController().signal,
      seed: 7,
      questions: Array.from({ length: 8 }, () => ({ text: 'Question?', answer: 'right' })),
      ask: fake({ claude: wrong, gpt: wrong }).ask,
    })
    expect(record.end).toEqual({ reason: 'ko', winner: null, stacks: { claude: 60, gpt: 60 } })
    expect(record.hands.length).toBeLessThan(8)
    const replayed = replayRecord(record).at(-1)
    expect(replayed?.after).toMatchObject({ draw: true, carry: 0, stacks: record.end.stacks })
    expect(replayed?.events.filter((event) => event.type === 'bust')).toHaveLength(2)
    const line = recordHands(record).hands.at(-1)?.line.text
    expect(line).toContain('Both wrong')
    expect(line).toContain('The round is a draw')
  })

  it('asks both for a secret answer, then each player in turn, under the same limits', async () => {
    const { ask, calls } = fake({ claude: sure, gpt: sure })
    const record = await playBluff({
      tier: 'third',
      effort: { claude: 'low', gpt: 'low' },
      signal: new AbortController().signal,
      seed: 7,
      limits: quick,
      left: 'gpt',
      questions,
      ask,
    })
    expect(record.left).toBe('gpt')
    expect(record.hands.map((h) => h.opener)).toEqual(['gpt', 'claude'])
    // Hole answers come first and are asked of both with the same question.
    expect(calls.claude[0]?.prompt).toContain('First, answer it in secret')
    expect(calls.gpt[0]?.prompt).toContain('First, answer it in secret')
    for (const call of [...calls.claude, ...calls.gpt]) {
      expect(call.effort).toBe('low')
      expect(call.timeoutMs).toBeLessThanOrEqual(quick.shotClockMs)
    }
    // Hand 1: GPT claims 75, Claude calls, GPT is right.
    expect(record.hands[0]?.moves.map((m) => m.action.kind)).toEqual(['claim', 'call'])
    expect(record.end.stacks.claude + record.end.stacks.gpt).toBe(120)
    expect(record.end.reason).toBe('hands')
    expect(record.calls).toEqual({ claude: 4, gpt: 4 })
  })

  it('retries a broken reply once, then lets the referee pass or fold', async () => {
    const { ask, calls } = fake({
      claude: sure,
      gpt: (options) =>
        options.prompt.includes('answer it in secret')
          ? text({ answer: '76', confidence: 40, think: 'guess' })
          : { text: 'I would rather not say', seconds: 1, toolUse: [] },
    })
    const record = await playBluff({
      tier: 'third',
      effort: { claude: 'low', gpt: 'low' },
      signal: new AbortController().signal,
      seed: 7,
      limits: { ...quick, hands: 1 },
      left: 'gpt',
      questions,
      ask,
    })
    const [pass, claim, fold] = record.hands[0]?.moves ?? []
    expect(pass?.ruling).toBe('unusable')
    expect(pass?.action.kind).toBe('pass')
    expect(pass?.calls).toBe(2)
    expect(calls.gpt[2]?.prompt).toContain('Your last reply could not be used')
    expect(claim?.action.kind).toBe('claim')
    expect(fold?.action.kind).toBe('fold')
    expect(record.end.winner).toBe('claude')
  })

  it('ends on a knockout and keeps every chip accounted for', async () => {
    const allIn: Script = (options) => {
      if (options.prompt.includes('answer it in secret'))
        return text({ answer: 'x', confidence: 99, think: '' })
      if (options.prompt.includes('"claim"'))
        return text({ action: 'claim', answer: 'x', amount: 20 })
      if (options.prompt.includes('"counter"'))
        return text({ action: 'counter', answer: 'y', amount: 20 })
      return text({ action: 'call' })
    }
    const long = Array.from({ length: 8 }, (_, i) => ({
      text: `Q${i}?`,
      answer: i % 2 ? 'x' : 'y',
    }))
    const record = await playBluff({
      tier: 'third',
      effort: { claude: 'low', gpt: 'low' },
      signal: new AbortController().signal,
      seed: 1,
      left: 'claude',
      questions: long,
      ask: fake({ claude: allIn, gpt: allIn }).ask,
    })
    expect(record.end.reason).toBe('ko')
    expect(record.end.winner).not.toBeNull()
    expect(chipsInPlay({ ...record.end, carry: 0, hand: 0, out: null })).toBe(120)
  })
})
