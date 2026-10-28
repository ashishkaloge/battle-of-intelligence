import { describe, expect, it } from 'vitest'
import {
  broadcastName,
  checkBroadcastQuality,
  fightRulings,
  fightSeed,
  withClocks,
} from './fight-setup.ts'

const fail = (message: string): never => {
  throw new Error(message)
}
const limits = { shotClockMs: 60_000, roundMs: 30 * 60_000, bouts: 3 }

describe('fight clocks from the command line', () => {
  it('keeps the defaults unless asked, and sets both corners alike', () => {
    expect(withClocks(limits, {}, fail)).toEqual(limits)
    expect(withClocks(limits, { clock: '300', 'round-minutes': '120' }, fail)).toEqual({
      shotClockMs: 300_000,
      roundMs: 120 * 60_000,
      bouts: 3,
    })
  })

  it('refuses a clock that is not a positive number', () => {
    expect(() => withClocks(limits, { clock: '0' }, fail)).toThrow('--clock')
    expect(() => withClocks(limits, { 'round-minutes': 'soon' }, fail)).toThrow('--round-minutes')
  })
})

describe('fight argument validation', () => {
  it('rejects clocks that overflow Node timers or round to zero', () => {
    for (const raw of ['1e100', 'Infinity', '0.00000001', ' '])
      expect(() => withClocks(limits, { clock: raw }, fail)).toThrow('--clock')
  })

  it('accepts only complete unsigned 32-bit seeds', () => {
    expect(fightSeed('0', fail)).toBe(0)
    expect(fightSeed('4294967295', fail)).toBe(4294967295)
    for (const raw of ['42junk', '1.5', '-1', '4294967296', '1e3', ''])
      expect(() => fightSeed(raw, fail)).toThrow('seed')
  })
})

describe('broadcast identity and quality', () => {
  it('accepts only bounded safe broadcast identifiers', () => {
    expect(broadcastName(undefined)).toBeUndefined()
    expect(broadcastName('launch-1')).toBe('launch-1')
    for (const raw of ['', '../launch', 'Launch 1', 'a'.repeat(81), '-launch', 'launch-'])
      expect(() => broadcastName(raw)).toThrow('--broadcast')
  })

  it('counts structured decisions and Bluff actors without reading model text', () => {
    const record = {
      turns: [{ claude: { ruling: 'played' }, gpt: { ruling: 'late' } }],
      hands: [{ acts: [{ ruling: 'played', action: { by: 'gpt' } }] }],
      text: '{"claude":{"ruling":"error"}}',
    }
    expect(fightRulings(record).claude).toMatchObject({ played: 1, error: 0 })
    expect(fightRulings(record).gpt).toMatchObject({ played: 1, late: 1 })
    expect(() => checkBroadcastQuality(record)).not.toThrow()
  })

  it('rejects provider failures and rounds where a corner never made a usable move', () => {
    expect(() =>
      checkBroadcastQuality({ claude: { ruling: 'played' }, gpt: { ruling: 'error' } }),
    ).toThrow('gpt provider failed')
    expect(() =>
      checkBroadcastQuality({ claude: { ruling: 'played' }, gpt: { ruling: 'late' } }),
    ).toThrow('gpt made no usable decisions')
  })
})
