import { describe, expect, it } from 'vitest'
import type { Fighter, Move } from '../src/games/ring/arena.ts'
import { LIMITS, type Limits } from '../src/games/ring/live.ts'
import type { AskOptions, AskResult } from './cli.ts'
import { playRing } from './ring.ts'

type Script = (options: AskOptions, call: number) => Promise<AskResult> | AskResult

const reply = (move: Move, think = 'plan'): AskResult => ({
  text: JSON.stringify({ move, think, say: '' }),
  seconds: 1,
  toolUse: [],
})

/** A fake CLI per corner, counting every call it gets. */
function fake(scripts: Record<Fighter, Script>) {
  const calls: Record<Fighter, AskOptions[]> = { claude: [], gpt: [] }
  const ask = async (options: AskOptions) => {
    const list = calls[options.lab]
    list.push(options)
    return scripts[options.lab](options, list.length)
  }
  return { ask, calls }
}

const quick: Limits = { ...LIMITS, bouts: 1, turnsPerBout: 2 }

const fight = (
  ask: (options: AskOptions) => Promise<AskResult>,
  limits = quick,
  now?: () => number,
) =>
  playRing({
    tier: 'third',
    effort: { claude: 'low', gpt: 'low' },
    signal: new AbortController().signal,
    limits,
    ask,
    ...(now ? { now } : {}),
  })

describe('the Ring referee', () => {
  it('asks both corners for each move with the same tier, effort and shot clock', async () => {
    const { ask, calls } = fake({ claude: () => reply('right'), gpt: () => reply('left') })
    const record = await fight(ask)
    expect(record.models.claude.id).toBe('claude-haiku-5-5')
    expect(record.models.gpt.id).toBe('gpt-6-luna')
    expect(calls.claude).toHaveLength(2)
    expect(calls.gpt).toHaveLength(2)
    for (const call of [...calls.claude, ...calls.gpt]) {
      expect(call.effort).toBe('low')
      expect(call.timeoutMs).toBeLessThanOrEqual(quick.shotClockMs)
    }
    expect(record.bouts[0]?.map((turn) => turn.claude.move)).toEqual(['right', 'right'])
    expect(record.calls).toEqual({ claude: 2, gpt: 2 })
    expect(record.rules).toEqual({
      centerBounty: true,
      ropeSlams: true,
      takedowns: true,
      changeCorners: true,
    })
    expect(record.opener).toBe('claude')
    expect(record.arena.name).toBe('Crossroads')
    expect(record.prompt).toBe(3)
    expect(calls.claude[0]?.prompt).toContain('Your moves, worked out from what is known')
    expect(calls.claude[0]?.prompt).toContain('The center is a bounty.')
  })

  it('tells both corners at the bell that everyone is back on their feet', async () => {
    const { ask, calls } = fake({ claude: () => reply('wait'), gpt: () => reply('wait') })
    await fight(ask, { ...quick, bouts: 2, turnsPerBout: 1 })
    expect(calls.claude[0]?.prompt).not.toContain('Bell: bout')
    expect(calls.claude[1]?.prompt).toContain('Bell: bout 2 starts')
    expect(calls.gpt[1]?.prompt).toContain('Bell: bout 2 starts')
  })

  it('starts the opener on the left and changes corners at every bell', async () => {
    const { ask, calls } = fake({ claude: () => reply('wait'), gpt: () => reply('wait') })
    const record = await playRing({
      tier: 'third',
      effort: { claude: 'low', gpt: 'low' },
      signal: new AbortController().signal,
      limits: { ...quick, bouts: 2, turnsPerBout: 1 },
      opener: 'gpt',
      ask,
    })
    expect(record.opener).toBe('gpt')
    expect(calls.gpt[0]?.prompt).toContain('You are at (0,2)')
    expect(calls.claude[0]?.prompt).toContain('You are at (8,2)')
    expect(calls.gpt[1]?.prompt).toContain('You are at (8,2)')
    expect(calls.gpt[1]?.prompt).toContain('The fighters have changed corners')
  })

  it('holds a fighter still when its reply misses the shot clock', async () => {
    const timeout = Object.assign(new Error('no reply within 60 seconds'), { name: 'TimeoutError' })
    const { ask } = fake({
      claude: () => {
        throw timeout
      },
      gpt: () => reply('left'),
    })
    const record = await fight(ask)
    const first = record.bouts[0]?.[0]
    expect(first?.claude).toMatchObject({ move: 'wait', ruling: 'late', calls: 1 })
    expect(first?.gpt.ruling).toBe('played')
  })

  it('retries an unusable reply once, then holds', async () => {
    const { ask, calls } = fake({
      claude: () => ({ text: 'I think I will go left', seconds: 1, toolUse: [] }),
      gpt: () => reply('wait'),
    })
    const record = await fight(ask, { ...quick, turnsPerBout: 1 })
    expect(calls.claude).toHaveLength(2)
    expect(calls.claude[1]?.prompt).toContain('could not be used')
    expect(record.bouts[0]?.[0]?.claude).toMatchObject({ move: 'wait', ruling: 'unusable' })
  })

  it('never goes past the call cap', async () => {
    const { ask, calls } = fake({
      claude: () => ({ text: 'no', seconds: 1, toolUse: [] }),
      gpt: () => reply('wait'),
    })
    const record = await fight(ask, { ...quick, turnsPerBout: 4, callsPerCorner: 3 })
    expect(calls.claude).toHaveLength(3)
    expect(record.bouts[0]?.map((turn) => turn.claude.ruling)).toEqual([
      'unusable',
      'unusable',
      'capped',
      'capped',
    ])
    expect(record.bouts[0]?.[1]?.claude.calls).toBe(1)
  })

  it('treats a tool call as a broken rule', async () => {
    const { ask } = fake({
      claude: () => ({ ...reply('left'), toolUse: ['command_execution'] }),
      gpt: () => reply('wait'),
    })
    const record = await fight(ask, { ...quick, turnsPerBout: 1 })
    expect(record.bouts[0]?.[0]?.claude).toMatchObject({ move: 'wait', ruling: 'tools' })
  })

  it('does not ask a fighter who is down', async () => {
    // On Crossroads: the belt flings Claude beside the center, it steps on, then walks down onto
    // the trap two cells below.
    const claudeMoves: Move[] = ['right', 'right', 'right', 'down', 'down', 'wait']
    const { ask, calls } = fake({
      claude: (_options, n) => reply(claudeMoves[n - 1] ?? 'wait'),
      gpt: () => reply('wait'),
    })
    const record = await fight(ask, { ...quick, turnsPerBout: 6 })
    const turns = record.bouts[0] ?? []
    const downAt = turns.findIndex((turn) => turn.claude.ruling === 'down')
    expect(downAt).toBeGreaterThan(0)
    expect(record.end.knockdowns.claude).toBe(1)
    expect(calls.claude).toHaveLength(turns.length - 1)
  })

  it('clips every decision to the remaining round clock', async () => {
    const { ask, calls } = fake({ claude: () => reply('wait'), gpt: () => reply('wait') })
    await fight(ask, { ...quick, roundMs: 10_000 }, () => 0)
    for (const call of [...calls.claude, ...calls.gpt]) expect(call.timeoutMs).toBe(10_000)
  })

  it('ends the round at the current score when the round clock runs out', async () => {
    let clock = 0
    const { ask } = fake({
      claude: () => {
        clock += 40_000
        return reply('right')
      },
      gpt: () => reply('left'),
    })
    const record = await fight(ask, { ...quick, turnsPerBout: 8, roundMs: 100_000 }, () => clock)
    expect(record.end.reason).toBe('round-clock')
    expect(record.bouts[0]).toHaveLength(3)
  })
})
