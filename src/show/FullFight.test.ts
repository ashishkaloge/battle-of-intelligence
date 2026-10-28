import { describe, expect, it } from 'vitest'
import { clock, FightRuntime, series } from './FullFight.tsx'

describe('the full fight', () => {
  it('prints the runtime as m:ss, and h:mm:ss past an hour', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(59_999)).toBe('0:59')
    expect(clock(12 * 60_000 + 5_000)).toBe('12:05')
    expect(clock(3_600_000 + 61_000)).toBe('1:01:01')
  })

  it('counts rounds won, with a drawn round for nobody', () => {
    expect(series(['claude', 'gpt', null, 'claude'])).toEqual({ claude: 2, gpt: 1 })
    expect(series([])).toEqual({ claude: 0, gpt: 0 })
  })

  it('freezes runtime during pauses and excludes every pause after resuming', () => {
    const runtime = new FightRuntime()
    runtime.start(1_000)
    expect(runtime.elapsed(6_000)).toBe(5_000)

    runtime.setPlaying(false, 6_000)
    runtime.setPlaying(false, 10_000)
    expect(runtime.paused).toBe(true)
    expect(runtime.elapsed(66_000)).toBe(5_000)

    runtime.setPlaying(true, 66_000)
    runtime.setPlaying(true, 67_000)
    expect(runtime.elapsed(70_000)).toBe(9_000)
    runtime.setPlaying(false, 70_000)
    runtime.setPlaying(true, 80_000)
    expect(runtime.elapsed(85_000)).toBe(14_000)
    expect(runtime.paused).toBe(false)
  })

  it('discards paused time when stopping or starting another fight', () => {
    const runtime = new FightRuntime()
    runtime.setPlaying(false, 1_000)
    expect(runtime.active).toBe(false)
    expect(runtime.elapsed(5_000)).toBe(0)
    runtime.start(5_000)
    runtime.setPlaying(false, 8_000)
    runtime.reset()
    expect(runtime.paused).toBe(false)
    expect(runtime.elapsed(20_000)).toBe(0)
    runtime.start(20_000)
    expect(runtime.elapsed(23_000)).toBe(3_000)
  })
})
