/** Every effect a game can cue. */
export type Sound =
  | 'step'
  | 'belt'
  | 'teleport'
  | 'thud'
  | 'clash'
  | 'trap'
  | 'roar'
  | 'bigroar'
  | 'ko'
  | 'crash'
  | 'boost'
  | 'bug'
  | 'close'
  | 'chips'
  | 'flip'
  | 'buzzer'
  | 'wrong'

/**
 * Sound for every round. Effects and the crowd are synthesised with Web Audio, so there are no sample
 * files or licences to track. Commentary plays from the rendered Piper files. Browsers only allow
 * audio after a click, so nothing sounds until `unlock` runs from the Play button.
 */

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
let muted = false
let paused = false
const muteListeners = new Set<() => void>()

export const getMuted = () => muted

export function subscribeMuted(listener: () => void): () => void {
  muteListeners.add(listener)
  return () => {
    muteListeners.delete(listener)
  }
}

export function unlock() {
  if (!ctx) {
    // A viewer with unavailable audio can still watch the captions and replay.
    if (typeof AudioContext === 'undefined') return
    try {
      ctx = new AudioContext()
    } catch {
      return
    }
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 0.55
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -10
    master.connect(limiter).connect(ctx.destination)
    noise = makeNoise(ctx)
  }
  if (!paused) void ctx.resume().catch(() => {})
}

export function setMuted(next: boolean) {
  const changed = next !== muted
  muted = next
  if (ctx && master) master.gain.setTargetAtTime(next ? 0 : 0.55, ctx.currentTime, 0.05)
  // Muting mid-line ends the line, so a turn waiting on it moves on instead of hanging.
  if (next) active?.()
  if (changed) for (const listener of muteListeners) listener()
}

/** Pause the current voice and its silent caption fallback with the rest of the show. */
export function pauseAudio(next: boolean) {
  if (paused === next) return
  paused = next
  if (ctx) void (next ? ctx.suspend() : ctx.resume()).catch(() => {})
  activePause?.(next)
}

function makeNoise(context: AudioContext) {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
  const data = buffer.getChannelData(0)
  // Pink-ish noise (Paul Kellet's filter): softer than white, closer to a room full of people.
  let b0 = 0
  let b1 = 0
  let b2 = 0
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1
    b0 = 0.99765 * b0 + white * 0.099046
    b1 = 0.963 * b1 + white * 0.2965164
    b2 = 0.57 * b2 + white * 1.0526913
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2
  }
  return buffer
}

function env(param: AudioParam, at: number, peak: number, attack: number, release: number) {
  param.setValueAtTime(0.0001, at)
  param.exponentialRampToValueAtTime(peak, at + attack)
  param.exponentialRampToValueAtTime(0.0001, at + attack + release)
}

function tone(type: OscillatorType, from: number, to: number, peak: number, length: number) {
  if (!ctx || !master) return
  const at = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(from, at)
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), at + length)
  env(gain.gain, at, peak, 0.004, length)
  osc.connect(gain).connect(master)
  osc.start(at)
  osc.stop(at + length + 0.05)
}

function burst(
  filter: BiquadFilterType,
  freq: number,
  peak: number,
  length: number,
  sweepTo?: number,
) {
  if (!ctx || !master || !noise) return
  const at = ctx.currentTime
  const source = ctx.createBufferSource()
  source.buffer = noise
  const shape = ctx.createBiquadFilter()
  shape.type = filter
  shape.frequency.setValueAtTime(freq, at)
  if (sweepTo) shape.frequency.exponentialRampToValueAtTime(sweepTo, at + length)
  const gain = ctx.createGain()
  env(gain.gain, at, peak, 0.01, length)
  source.connect(shape).connect(gain).connect(master)
  source.start(at, Math.random())
  source.stop(at + length + 0.05)
}

/** The crowd rising and falling back, for big moments. */
function swell(power: number) {
  if (!ctx || !master || !noise) return
  const at = ctx.currentTime
  const source = ctx.createBufferSource()
  source.buffer = noise
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.setValueAtTime(500, at)
  band.frequency.linearRampToValueAtTime(900, at + 0.4)
  band.Q.value = 0.5
  const gain = ctx.createGain()
  env(gain.gain, at, 0.22 * power, 0.25, 1.4 + power * 0.5)
  source.connect(band).connect(gain).connect(master)
  source.start(at, Math.random())
  source.stop(at + 2.6 + power)
}

/** A boxing bell: a few inharmonic partials with a long ring. */
export function bell(times = 3) {
  if (!ctx || !master) return
  for (let n = 0; n < times; n++) {
    const at = ctx.currentTime + n * 0.2
    for (const [ratio, level] of [
      [1, 0.28],
      [2.76, 0.12],
      [5.4, 0.05],
      [8.93, 0.02],
    ] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 820 * ratio
      env(gain.gain, at, level, 0.003, 1.3 / Math.sqrt(ratio))
      osc.connect(gain).connect(master)
      osc.start(at)
      osc.stop(at + 1.5)
    }
  }
}

export function lockTick() {
  tone('sine', 1500, 1400, 0.08, 0.04)
}

export function revealClack() {
  burst('highpass', 2500, 0.18, 0.05)
  tone('triangle', 700, 500, 0.08, 0.06)
}

export function playSound(sound: Sound) {
  switch (sound) {
    case 'step':
      tone('sine', 190, 120, 0.12, 0.06)
      return
    case 'belt':
      burst('bandpass', 400, 0.25, 0.25, 1700)
      return
    case 'teleport':
      tone('sine', 300, 1800, 0.12, 0.3)
      return
    case 'thud':
      tone('sine', 150, 45, 0.9, 0.24)
      burst('lowpass', 900, 0.45, 0.09)
      return
    case 'clash':
      tone('sine', 130, 40, 0.75, 0.26)
      burst('highpass', 1800, 0.35, 0.14)
      tone('square', 1300, 900, 0.05, 0.06)
      return
    case 'trap':
      tone('sawtooth', 900, 90, 0.22, 0.3)
      tone('sine', 120, 38, 0.9, 0.3)
      burst('lowpass', 600, 0.4, 0.12)
      return
    case 'roar':
      swell(0.8)
      return
    case 'bigroar':
      swell(1.6)
      return
    case 'ko':
      bell(6)
      swell(2.4)
      return
    case 'crash':
      tone('sine', 120, 35, 1, 0.42)
      burst('lowpass', 1400, 0.6, 0.35, 120)
      return
    case 'boost':
      burst('bandpass', 300, 0.22, 0.22, 2400)
      tone('sawtooth', 220, 660, 0.05, 0.18)
      return
    case 'bug':
      // A broken machine: a choppy, falling square wave.
      for (let i = 0; i < 4; i++) {
        window.setTimeout(() => tone('square', 900 - i * 180, 700 - i * 180, 0.07, 0.07), i * 70)
      }
      tone('sine', 110, 40, 0.8, 0.4)
      return
    case 'close':
      tone('sine', 70, 40, 0.5, 0.6)
      burst('lowpass', 400, 0.3, 0.5)
      return
    case 'chips':
      // Clay chips landing: a few quick, bright clicks.
      for (let i = 0; i < 4; i++) {
        window.setTimeout(() => {
          burst('bandpass', 3200 + i * 300, 0.18, 0.03)
          tone('triangle', 2600 - i * 200, 2400 - i * 200, 0.04, 0.03)
        }, i * 45)
      }
      return
    case 'flip':
      burst('highpass', 1800, 0.2, 0.08, 5000)
      return
    case 'buzzer':
      // A game-show buzzer: a short, rough square-wave blast.
      tone('square', 330, 320, 0.16, 0.32)
      tone('sawtooth', 165, 160, 0.1, 0.32)
      return
    case 'wrong':
      tone('square', 220, 110, 0.12, 0.5)
      tone('sine', 110, 55, 0.4, 0.5)
      return
  }
}

let active: (() => void) | null = null
let activePause: ((next: boolean) => void) | null = null

/**
 * Plays one commentary line and resolves when it ends. If the file is missing, playback is blocked
 * or sound is off, it waits roughly as long as the line takes to read, so captions keep their pace.
 */
export function speak(url: string, text: string): { done: Promise<void>; stop: () => void } {
  // A new line cuts the previous one, so the booth never talks over itself.
  active?.()
  // Silent fallback (no rendered audio yet): read it at a brisk pace, but never stall the show.
  const readMs = Math.min(2400, 650 + text.length * 34)
  let resolveDone = () => {}
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  let timer = 0
  let loadTimer = 0
  let audio: HTMLAudioElement | null = null
  let stopped = false
  let reading = false
  let remaining = readMs
  let deadline = 0
  let playAttempt = 0
  const finish = () => {
    if (stopped) return
    stopped = true
    window.clearTimeout(timer)
    window.clearTimeout(loadTimer)
    audio?.removeEventListener('ended', finish)
    audio?.removeEventListener('error', fallback)
    audio?.removeEventListener('waiting', waitForAudio)
    audio?.removeEventListener('playing', playing)
    resolveDone()
  }
  const scheduleReading = () => {
    if (paused || stopped) return
    deadline = Date.now() + remaining
    timer = window.setTimeout(finish, remaining)
  }
  const fallback = () => {
    if (stopped || reading) return
    reading = true
    audio?.pause()
    window.clearTimeout(timer)
    window.clearTimeout(loadTimer)
    scheduleReading()
  }
  const playing = () => window.clearTimeout(loadTimer)
  const waitForAudio = () => {
    window.clearTimeout(loadTimer)
    if (!stopped && !paused && !reading) loadTimer = window.setTimeout(fallback, 15_000)
  }
  const play = () => {
    if (stopped) return
    const attempt = ++playAttempt
    waitForAudio()
    void audio?.play().then(
      () => {
        if (attempt === playAttempt) playing()
      },
      () => {
        // Pausing before the browser starts playback rejects that attempt with AbortError.
        // Only a current attempt may fall back; resuming can still play the original recording.
        if (attempt === playAttempt) fallback()
      },
    )
  }
  const pause = (next: boolean) => {
    if (stopped) return
    if (reading) {
      if (next) {
        window.clearTimeout(timer)
        remaining = Math.max(0, deadline ? deadline - Date.now() : remaining)
      } else scheduleReading()
    } else if (next) {
      playAttempt++
      window.clearTimeout(loadTimer)
      audio?.pause()
    } else play()
  }

  if (muted || !ctx) {
    fallback()
  } else {
    audio = new Audio(url)
    audio.addEventListener('ended', finish)
    audio.addEventListener('error', fallback)
    audio.addEventListener('waiting', waitForAudio)
    audio.addEventListener('playing', playing)
    if (!paused) play()
  }

  const stop = () => {
    if (stopped) return
    audio?.pause()
    finish()
  }
  active = stop
  activePause = pause
  void done.then(() => {
    if (active === stop) {
      active = null
      activePause = null
    }
  })
  return { done, stop }
}
