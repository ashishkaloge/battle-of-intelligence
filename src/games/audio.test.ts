import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class Recording extends EventTarget {
  static all: Recording[] = []
  play = vi.fn(async () => {})
  pause = vi.fn()

  constructor(_url: string) {
    super()
    Recording.all.push(this)
  }
}

const node = () => ({
  gain: { value: 0, setTargetAtTime: vi.fn() },
  threshold: { value: 0 },
  connect: vi.fn(function (this: unknown) {
    return this
  }),
})

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  Recording.all = []
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('Audio', Recording)
  vi.stubGlobal(
    'AudioContext',
    class {
      sampleRate = 4
      currentTime = 0
      destination = {}
      createGain = node
      createDynamicsCompressor = node
      createBuffer = () => ({ getChannelData: () => new Float32Array(8) })
      resume = async () => {}
      suspend = async () => {}
    },
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('commentary playback lifetime', () => {
  it.each(['missing', 'unavailable'])(
    'keeps caption playback working when audio is %s',
    async (mode) => {
      vi.stubGlobal(
        'AudioContext',
        mode === 'missing'
          ? undefined
          : class {
              constructor() {
                throw new Error('Audio device unavailable')
              }
            },
      )
      const { speak, unlock } = await import('./audio.ts')
      expect(unlock).not.toThrow()
      const voice = speak('/voice/first.mp3', 'Hi')
      await vi.advanceTimersByTimeAsync(718)
      await voice.done
      expect(Recording.all).toHaveLength(0)
    },
  )

  it('shares the mute state and notifies subscribers only when it changes', async () => {
    const { getMuted, setMuted, subscribeMuted } = await import('./audio.ts')
    const changed = vi.fn()
    const unsubscribe = subscribeMuted(changed)
    expect(getMuted()).toBe(false)
    setMuted(true)
    setMuted(true)
    expect(getMuted()).toBe(true)
    expect(changed).toHaveBeenCalledOnce()
    unsubscribe()
    setMuted(false)
    expect(changed).toHaveBeenCalledOnce()
  })

  it('pauses and resumes a recording without completing the line', async () => {
    const { pauseAudio, speak, unlock } = await import('./audio.ts')
    unlock()
    const voice = speak('/voice/first.mp3', 'First line.')
    const ended = vi.fn()
    void voice.done.then(ended)
    pauseAudio(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(ended).not.toHaveBeenCalled()
    expect(Recording.all[0]?.pause).toHaveBeenCalledOnce()
    pauseAudio(false)
    expect(Recording.all[0]?.play).toHaveBeenCalledTimes(2)
    Recording.all[0]?.dispatchEvent(new Event('ended'))
    await voice.done
  })

  it('preserves the silent fallback time left while paused', async () => {
    const { pauseAudio, speak } = await import('./audio.ts')
    const voice = speak('/voice/missing.mp3', 'Hi')
    const ended = vi.fn()
    void voice.done.then(ended)
    await vi.advanceTimersByTimeAsync(200)
    pauseAudio(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(ended).not.toHaveBeenCalled()
    pauseAudio(false)
    await vi.advanceTimersByTimeAsync(517)
    expect(ended).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await voice.done
    expect(ended).toHaveBeenCalledOnce()
  })

  it('keeps narration available when pausing rejects a pending play attempt', async () => {
    let rejectPlay = (_reason: Error) => {}
    const pending = new Promise<void>((_resolve, reject) => {
      rejectPlay = reject
    })
    const { pauseAudio, speak, unlock } = await import('./audio.ts')
    unlock()
    const voice = speak('/voice/first.mp3', 'First line.')
    const recording = Recording.all[0]
    recording?.play.mockReturnValueOnce(pending)
    pauseAudio(true)
    pauseAudio(false)
    pauseAudio(true)
    rejectPlay(Object.assign(new Error('play interrupted'), { name: 'AbortError' }))
    await Promise.resolve()
    pauseAudio(false)
    const ended = vi.fn()
    void voice.done.then(ended)
    await vi.advanceTimersByTimeAsync(5000)
    expect(ended).not.toHaveBeenCalled()
    expect(recording?.play).toHaveBeenCalledTimes(3)
    recording?.dispatchEvent(new Event('ended'))
    await voice.done
  })

  it('falls back when media stalls without cutting off a playable long recording', async () => {
    const { speak, unlock } = await import('./audio.ts')
    unlock()
    const voice = speak('/voice/slow.mp3', 'Hi')
    const ended = vi.fn()
    void voice.done.then(ended)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(ended).not.toHaveBeenCalled()
    Recording.all[0]?.dispatchEvent(new Event('waiting'))
    await vi.advanceTimersByTimeAsync(15_000 + 718)
    await voice.done
    expect(ended).toHaveBeenCalledOnce()
    expect(Recording.all[0]?.pause).toHaveBeenCalledOnce()
  })
  it('plays until the recording ends, independent of animation-length timers', async () => {
    const { speak, unlock } = await import('./audio.ts')
    unlock()
    const voice = speak('/voice/long-call.mp3', 'A call longer than one animation beat.')
    const ended = vi.fn()
    void voice.done.then(ended)

    await vi.advanceTimersByTimeAsync(1220)
    expect(ended).not.toHaveBeenCalled()
    expect(Recording.all[0]?.pause).not.toHaveBeenCalled()

    Recording.all[0]?.dispatchEvent(new Event('ended'))
    await voice.done
    expect(ended).toHaveBeenCalledOnce()
  })

  it('replaces a line without letting an old cleanup stop the new recording', async () => {
    const { speak, unlock } = await import('./audio.ts')
    unlock()
    const old = speak('/voice/first.mp3', 'First line.')
    const current = speak('/voice/next.mp3', 'Next line.')
    await old.done
    expect(Recording.all[0]?.pause).toHaveBeenCalledOnce()

    old.stop()
    expect(Recording.all[1]?.pause).not.toHaveBeenCalled()

    current.stop()
    await current.done
    expect(Recording.all[1]?.pause).toHaveBeenCalledOnce()
  })

  it('stops the active line when muted or explicitly disposed', async () => {
    const { setMuted, speak, unlock } = await import('./audio.ts')
    unlock()
    const voice = speak('/voice/first.mp3', 'First line.')
    setMuted(true)
    await voice.done
    expect(Recording.all[0]?.pause).toHaveBeenCalledOnce()

    setMuted(false)
    const next = speak('/voice/next.mp3', 'Next line.')
    next.stop()
    await next.done
    expect(Recording.all[1]?.pause).toHaveBeenCalledOnce()
  })

  it('does not schedule fallback work after a stopped recording fails', async () => {
    const { speak, unlock } = await import('./audio.ts')
    unlock()
    const voice = speak('/voice/first.mp3', 'First line.')
    voice.stop()
    Recording.all[0]?.dispatchEvent(new Event('error'))
    await voice.done
    expect(vi.getTimerCount()).toBe(0)
  })
})
