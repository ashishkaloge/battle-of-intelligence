type Timer = {
  callback: () => void
  remaining: number
  repeat: number | null
  started: number
  handle: ReturnType<typeof setTimeout> | null
}

/** A replay clock: pausing preserves each cue's remaining time instead of skipping the beat. */
export class PlaybackClock {
  private timers = new Map<number, Timer>()
  private animations = new Set<Animation>()
  private nextId = 0
  private paused = false

  setTimeout(callback: () => void, ms: number): number {
    return this.schedule(callback, ms, null)
  }

  setInterval(callback: () => void, ms: number): number {
    return this.schedule(callback, ms, Math.max(1, ms))
  }

  clearTimeout(id: number) {
    const timer = this.timers.get(id)
    if (timer?.handle !== null && timer?.handle !== undefined) clearTimeout(timer.handle)
    this.timers.delete(id)
  }

  clearInterval(id: number) {
    this.clearTimeout(id)
  }

  track(animation: Animation): Animation {
    this.animations.add(animation)
    if (this.paused) animation.pause()
    const forget = () => this.animations.delete(animation)
    animation.addEventListener('finish', forget, { once: true })
    animation.addEventListener('cancel', forget, { once: true })
    return animation
  }

  setPaused(paused: boolean) {
    if (this.paused === paused) return
    this.paused = paused
    for (const [id, timer] of this.timers) {
      if (paused) {
        if (timer.handle !== null) {
          clearTimeout(timer.handle)
          timer.remaining = Math.max(0, timer.remaining - (performance.now() - timer.started))
          timer.handle = null
        }
      } else {
        this.arm(id, timer)
      }
    }
    for (const animation of this.animations) {
      if (paused) animation.pause()
      else animation.play()
    }
  }

  clear() {
    for (const id of this.timers.keys()) this.clearTimeout(id)
    for (const animation of this.animations) animation.cancel()
    this.animations.clear()
  }

  private schedule(callback: () => void, ms: number, repeat: number | null): number {
    const id = ++this.nextId
    const timer = { callback, remaining: Math.max(0, ms), repeat, started: 0, handle: null }
    this.timers.set(id, timer)
    if (!this.paused) this.arm(id, timer)
    return id
  }

  private arm(id: number, timer: Timer) {
    timer.started = performance.now()
    timer.handle = setTimeout(() => {
      timer.handle = null
      if (timer.repeat === null) this.timers.delete(id)
      timer.callback()
      if (timer.repeat !== null && this.timers.has(id)) {
        timer.remaining = timer.repeat
        if (!this.paused) this.arm(id, timer)
      }
    }, timer.remaining)
  }
}
