import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackClock } from './playback.ts'

describe('replay clock', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('freezes a cue and resumes with its remaining delay', () => {
    const clock = new PlaybackClock()
    const cue = vi.fn()
    clock.setTimeout(cue, 1000)
    vi.advanceTimersByTime(400)
    clock.setPaused(true)
    vi.advanceTimersByTime(5000)
    expect(cue).not.toHaveBeenCalled()
    clock.setPaused(false)
    vi.advanceTimersByTime(599)
    expect(cue).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(cue).toHaveBeenCalledOnce()
  })

  it('holds newly scheduled cues while paused and cancels abandoned runs', () => {
    const clock = new PlaybackClock()
    const cue = vi.fn()
    clock.setPaused(true)
    clock.setTimeout(cue, 100)
    vi.advanceTimersByTime(1000)
    expect(cue).not.toHaveBeenCalled()
    clock.clear()
    clock.setPaused(false)
    vi.advanceTimersByTime(1000)
    expect(cue).not.toHaveBeenCalled()
  })

  it('pauses match ticks without catching up or duplicating intervals', () => {
    const clock = new PlaybackClock()
    const tick = vi.fn()
    const timer = clock.setInterval(tick, 100)
    vi.advanceTimersByTime(250)
    expect(tick).toHaveBeenCalledTimes(2)
    clock.setPaused(true)
    vi.advanceTimersByTime(5000)
    clock.setPaused(false)
    clock.setPaused(false)
    vi.advanceTimersByTime(50)
    expect(tick).toHaveBeenCalledTimes(3)
    clock.clearInterval(timer)
    vi.advanceTimersByTime(1000)
    expect(tick).toHaveBeenCalledTimes(3)
  })
})
