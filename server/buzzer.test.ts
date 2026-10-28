import { describe, expect, it } from 'vitest'
import { LIMITS, parseTurnReply, recordTossups, turnPrompt } from '../src/games/buzzer/live.ts'
import type { Problem } from '../src/games/buzzer/quiz.ts'
import type { Fighter } from '../src/games/ring/arena.ts'
import { playBuzzer } from './buzzer.ts'
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

const problems: Problem[] = [
  { text: 'What is 6 × 7?', hints: ['Six sevens.', 'Five sevens are 35.', '35 + 7.'], answer: 42 },
  { text: 'What is 2 + 2?', hints: ['Count.', 'Two pairs.', 'Four.'], answer: 4 },
]

const hintsShown = (prompt: string) => (prompt.match(/^Hint \d:/gm) ?? []).length
const quick = { ...LIMITS, tossups: 2 }
const base = {
  tier: 'third' as const,
  effort: { claude: 'low', gpt: 'low' },
  signal: new AbortController().signal,
  seed: 1,
  limits: quick,
  problems,
}

describe('live Buzzer prompts and replies', () => {
  it('shows only the hints revealed so far and the value of a buzz now', () => {
    const prompt = turnPrompt({
      me: 'gpt',
      problem: problems[0] as Problem,
      tossup: 6,
      reveal: 2,
      double: true,
      score: { claude: 30, gpt: 25 },
      rivalOut: { answer: 41, reveal: 1 },
      limits: LIMITS,
      history: [],
    })
    expect(hintsShown(prompt)).toBe(2)
    expect(prompt).toContain('a right buzz now is worth 10; a wrong one costs 10')
    expect(prompt).toContain('Claude buzzed 41 on hint 1 and was wrong')
    expect(prompt).not.toContain('35 + 7')
  })

  it('reads a buzz or a wait, and rejects a buzz without a whole number', () => {
    expect(parseTurnReply('{"action":"buzz","answer":"1,458","think":"done"}')).toEqual({
      ok: true,
      value: { decision: { kind: 'buzz', answer: 1458 }, think: 'Buzzes with 1458.' },
    })
    expect(parseTurnReply('{"action":"wait","answer":null}').ok).toBe(true)
    expect(parseTurnReply('{"action":"buzz","answer":"about 40"}').ok).toBe(false)
    expect(parseTurnReply('{"action":"buzz","answer":4.5}').ok).toBe(false)
  })
})

describe('the Buzzer referee', () => {
  it('asks both at every reveal until a right buzz, and judges with the engine', async () => {
    // Claude waits for two hints, then answers; GPT always waits.
    const { ask, calls } = fake({
      claude: (o) =>
        hintsShown(o.prompt) >= 2
          ? text({ action: 'buzz', answer: o.prompt.includes('6 × 7') ? 42 : 4, think: 'got it' })
          : text({ action: 'wait', think: 'more' }),
      gpt: () => text({ action: 'wait', think: 'thinking' }),
    })
    const record = await playBuzzer({ ...base, ask })
    expect(record.tossups[0]?.turns).toHaveLength(3)
    expect(record.end.score).toEqual({ claude: 5 + 10, gpt: 0 })
    expect(calls.claude).toHaveLength(6)
    expect(calls.gpt).toHaveLength(6)
    expect(record.tossups[1]?.double).toBe(true)
    for (const call of [...calls.claude, ...calls.gpt]) expect(call.effort).toBe('low')
  })

  it('locks a wrong buzzer out and tells the other it is racing nobody', async () => {
    const { ask, calls } = fake({
      claude: () => text({ action: 'buzz', answer: 1, think: 'guess' }),
      gpt: () => text({ action: 'wait', think: 'patience' }),
    })
    const record = await playBuzzer({ ...base, limits: { ...quick, tossups: 1 }, ask })
    expect(calls.claude).toHaveLength(1)
    expect(calls.gpt).toHaveLength(4)
    expect(calls.gpt[1]?.prompt).toContain('Claude buzzed 1 on the problem alone and was wrong')
    // The only tossup is the double, so the neg is doubled too.
    expect(record.end.score).toEqual({ claude: -10, gpt: 0 })
    const { tossups, outro } = recordTossups({ ...record, id: 'x' })
    expect(tossups[0]?.line.text).toContain('Claude buzzed wrong')
    expect(outro.text).toContain('Wrong buzzes: Claude 1, GPT 0')
  })

  it('lets the referee wait for a corner whose reply cannot be used', async () => {
    const { ask } = fake({
      claude: () => ({ text: 'no idea', seconds: 1, toolUse: [] }),
      gpt: (o) => text({ action: 'buzz', answer: o.prompt.includes('6 × 7') ? 42 : 4 }),
    })
    const record = await playBuzzer({ ...base, ask })
    const first = record.tossups[0]?.turns[0]
    expect(first?.claude?.ruling).toBe('unusable')
    expect(first?.claude?.decision.kind).toBe('wait')
    expect(record.end.score.gpt).toBe(15 + 30)
    const { tossups } = recordTossups({ ...record, id: 'x' })
    expect(tossups[0]?.turns[0]?.claude?.think).toContain('could not be used')
  })
})
