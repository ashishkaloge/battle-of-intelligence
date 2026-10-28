import type { Job } from './demo.ts'
import type { Played } from './match.ts'

export type RefereeWorker = Pick<
  Worker,
  'onmessage' | 'onerror' | 'onmessageerror' | 'postMessage' | 'terminate'
>

/** A stalled native interpreter operation must not leave the broadcast waiting forever. */
const STALL_MS = 30_000

/** Owns one worker and settles every waiter, including when loading or running it fails. */
export function createReferee(
  jobs: readonly Job[],
  code: Record<string, string>,
  makeWorker: () => RefereeWorker = () =>
    new Worker(new URL('./referee.worker.ts', import.meta.url), { type: 'module' }),
) {
  let worker: RefereeWorker | null = null
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let error: string | null = null
  const results = new Map<string, Played>()
  const waiting = new Map<
    string,
    { resolve: (played: Played) => void; reject: (e: Error) => void }[]
  >()
  const listeners = new Set<() => void>()
  const ids = new Set(jobs.map((job) => job.id))
  const clearWatchdog = () => {
    clearTimeout(watchdog)
    watchdog = undefined
  }
  const rejectWaiting = (message: string) => {
    for (const requests of waiting.values()) {
      for (const request of requests) request.reject(new Error(message))
    }
    waiting.clear()
  }
  const fail = (message: string) => {
    clearWatchdog()
    error = message
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
    }
    worker = null
    rejectWaiting(message)
    for (const listener of listeners) listener()
  }
  const watchProgress = () => {
    clearWatchdog()
    watchdog = setTimeout(
      () => fail('The referee took too long to finish a match. Reload to try again.'),
      STALL_MS,
    )
  }
  const start = () => {
    if (worker || error || ids.size === 0) return
    try {
      const next = makeWorker()
      worker = next
      next.onerror = (event) => {
        event.preventDefault()
        fail('The referee could not run this fight. Reload to try again.')
      }
      next.onmessageerror = () => fail('The referee returned an unreadable result.')
      next.onmessage = (
        event: MessageEvent<{ id: string; played: Played } | { error: string }>,
      ) => {
        if ('error' in event.data) {
          fail('The referee could not complete this fight. Reload to try again.')
          return
        }
        const { id, played } = event.data
        if (!ids.has(id) || results.has(id)) return
        results.set(id, played)
        if (results.size === ids.size) clearWatchdog()
        else watchProgress()
        for (const request of waiting.get(id) ?? []) request.resolve(played)
        waiting.delete(id)
      }
      watchProgress()
      next.postMessage({ jobs, code })
    } catch {
      fail('The referee could not start. Reload to try again.')
    }
  }
  return {
    start,
    get(id: string): Promise<Played> {
      if (!ids.has(id)) return Promise.reject(new Error(`Unknown referee job: ${id}`))
      start()
      const ready = results.get(id)
      if (ready) return Promise.resolve(ready)
      if (error) return Promise.reject(new Error(error))
      return new Promise((resolve, reject) => {
        waiting.set(id, [...(waiting.get(id) ?? []), { resolve, reject }])
      })
    },
    peek: (id: string) => results.get(id) ?? null,
    getError: () => error,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      clearWatchdog()
      if (worker) {
        worker.onmessage = null
        worker.onerror = null
        worker.onmessageerror = null
        worker.terminate()
        worker = null
      }
      rejectWaiting('The referee was stopped.')
      results.clear()
      error = null
    },
  }
}
