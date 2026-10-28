import { describe, expect, it, vi } from 'vitest'
import type { AskOptions } from './cli.ts'
import { decide, together } from './move.ts'

const options = () => ({
  ask: vi.fn(async () => ({ text: '{}', seconds: 1, toolUse: [] })),
  lab: 'claude' as const,
  model: 'test',
  effort: 'low',
  prompt: 'test',
  cwd: '/tmp',
  parse: () => ({ ok: true as const, value: 'wait' }),
  signal: new AbortController().signal,
  shotClockMs: 60_000,
  budget: { used: 0, cap: 2 },
  now: () => 0,
})

describe('decision lifecycle', () => {
  it('does not request or persist reasoning from the transport', async () => {
    const ask = vi.fn(async (input: AskOptions) => {
      expect(input.onThought).toBeUndefined()
      return { text: '{}', seconds: 1, toolUse: [] }
    })
    const result = await decide({ ...options(), ask })
    expect(result).toEqual({ ok: true, value: 'wait', seconds: 0, calls: 1 })
    expect(result).not.toHaveProperty('reasoning')
  })

  it('honors cancellation even after the call cap is reached', async () => {
    const controller = new AbortController()
    controller.abort()
    const base = options()
    await expect(
      decide({ ...base, signal: controller.signal, budget: { used: 2, cap: 2 } }),
    ).rejects.toThrow('stopped')
    expect(base.ask).not.toHaveBeenCalled()
  })

  it('rejects a late result even if an adapter resolves instead of timing out', async () => {
    let now = 0
    const base = options()
    const result = await decide({
      ...base,
      now: () => now,
      ask: async () => {
        now = 60_001
        return { text: '{}', seconds: 61, toolUse: [] }
      },
    })
    expect(result).toMatchObject({ ok: false, ruling: 'late', calls: 1 })
  })

  it('waits for both corners to finish before propagating a failure', async () => {
    let finish: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const settled = vi.fn()
    const result = together([Promise.reject(new Error('stopped')), pending]).catch(settled)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    finish?.()
    await result
    expect(settled).toHaveBeenCalledOnce()
  })
})

describe('named broadcast provider failures', () => {
  it('retries once, then aborts instead of turning an outage into a scored fallback', async () => {
    const base = options()
    base.ask.mockRejectedValue(new Error('private provider detail'))
    await expect(decide({ ...base, abortOnProviderError: true })).rejects.toThrow(
      'claude provider unavailable; broadcast round not saved (the CLI reported an error)',
    )
    expect(base.ask).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['the CLI reached its usage allowance', 'usage allowance'],
    ['the CLI reached a rate limit', 'rate limit'],
    ['the CLI could not authenticate its subscription', 'authenticate its subscription'],
    ['the CLI encountered a temporary provider or network failure', 'temporary provider'],
    ['the selected model is unavailable in this CLI account', 'selected model is unavailable'],
  ])('keeps the safe failure category: %s', async (reason, expected) => {
    const base = options()
    base.ask.mockRejectedValue(new Error(reason))
    const error = await decide({ ...base, abortOnProviderError: true }).catch(
      (value: Error) => value,
    )
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain(expected)
    expect(String(error)).toContain('broadcast round not saved')
  })

  it('reports a refusal without calling it provider unavailability', async () => {
    const base = options()
    base.ask.mockRejectedValue(new Error('the provider refused this request'))
    const error = await decide({ ...base, abortOnProviderError: true }).catch(
      (value: Error) => value,
    )
    expect(String(error)).toContain('claude request refused; broadcast round not saved')
    expect(String(error)).not.toContain('provider unavailable')
    expect(base.ask).toHaveBeenCalledOnce()
  })

  it('still accepts a successful retry and keeps timeouts as game rulings', async () => {
    const base = options()
    base.ask.mockRejectedValueOnce(new Error('temporary'))
    await expect(decide({ ...base, abortOnProviderError: true })).resolves.toMatchObject({
      ok: true,
      calls: 2,
    })
    const late = options()
    late.ask.mockRejectedValue(Object.assign(new Error('late'), { name: 'TimeoutError' }))
    await expect(decide({ ...late, abortOnProviderError: true })).resolves.toMatchObject({
      ok: false,
      ruling: 'late',
      calls: 1,
    })
  })

  it('does not turn invalid model decisions into provider availability failures', async () => {
    await expect(
      decide({
        ...options(),
        abortOnProviderError: true,
        parse: () => ({ ok: false, error: 'invalid move' }),
      }),
    ).resolves.toMatchObject({ ok: false, ruling: 'unusable', calls: 2 })
  })
})
