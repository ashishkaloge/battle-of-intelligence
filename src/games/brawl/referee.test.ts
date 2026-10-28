import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Job } from './demo.ts'
import type { Played } from './match.ts'
import { createReferee, type RefereeWorker } from './referee.ts'

const job: Job = {
  id: 'match',
  bots: { claude: 'a', gpt: 'b' },
  seed: 1,
  flip: false,
  rules: { boosts: 0, closeEvery: null },
}

function setup(jobs = [job]) {
  const worker: RefereeWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  }
  const makeWorker = vi.fn(() => worker)
  return { worker, makeWorker, referee: createReferee(jobs, {}, makeWorker) }
}

afterEach(() => vi.useRealTimers())

describe('Brawl referee worker lifetime', () => {
  it('shares completed results and settles all requests for the same job', async () => {
    const { worker, makeWorker, referee } = setup()
    const first = referee.get(job.id)
    const second = referee.get(job.id)
    const played = { winner: 'claude' } as Played
    worker.onmessage?.call(worker as Worker, { data: { id: job.id, played } } as MessageEvent)
    expect(await first).toBe(played)
    expect(await second).toBe(played)
    expect(await referee.get(job.id)).toBe(played)
    expect(makeWorker).toHaveBeenCalledOnce()
    referee.dispose()
  })

  it('rejects pending and subsequent requests when the worker fails', async () => {
    const { worker, referee } = setup()
    const changed = vi.fn()
    referee.subscribe(changed)
    const pending = referee.get(job.id)
    const rejected = expect(pending).rejects.toThrow('could not run')
    const preventDefault = vi.fn()
    worker.onerror?.call(worker as Worker, { preventDefault } as unknown as ErrorEvent)
    await rejected
    await expect(referee.get(job.id)).rejects.toThrow('could not run')
    expect(referee.getError()).toContain('could not run')
    expect(changed).toHaveBeenCalledOnce()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('reports worker loading and asynchronous interpreter failures', async () => {
    const failed = createReferee([job], {}, () => {
      throw new Error('blocked')
    })
    await expect(failed.get(job.id)).rejects.toThrow('could not start')
    const { worker, referee } = setup()
    const pending = referee.get(job.id)
    const rejected = expect(pending).rejects.toThrow('could not complete')
    worker.onmessage?.call(worker as Worker, { data: { error: 'referee failed' } } as MessageEvent)
    await rejected
  })

  it('settles abandoned requests and permits a fresh start after effect cleanup', async () => {
    const { makeWorker, referee } = setup()
    const pending = referee.get(job.id)
    const rejected = expect(pending).rejects.toThrow('stopped')
    referee.dispose()
    await rejected
    referee.start()
    expect(makeWorker).toHaveBeenCalledTimes(2)
    referee.dispose()
  })

  it('rejects an unknown job without starting a worker', async () => {
    const { makeWorker, referee } = setup()
    await expect(referee.get('missing')).rejects.toThrow('Unknown referee job')
    expect(makeWorker).not.toHaveBeenCalled()
  })

  it('terminates a stalled worker and settles every pending request', async () => {
    vi.useFakeTimers()
    const { worker, referee } = setup()
    const first = expect(referee.get(job.id)).rejects.toThrow('took too long')
    const second = expect(referee.get(job.id)).rejects.toThrow('took too long')
    await vi.advanceTimersByTimeAsync(30_000)
    await Promise.all([first, second])
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(referee.getError()).toContain('Reload to try again')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('renews the watchdog for progress and clears it when all jobs finish', async () => {
    vi.useFakeTimers()
    const next = { ...job, id: 'next' }
    const { worker, referee } = setup([job, next])
    referee.start()
    await vi.advanceTimersByTimeAsync(20_000)
    const played = { winner: 'claude' } as Played
    worker.onmessage?.call(worker as Worker, { data: { id: job.id, played } } as MessageEvent)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(worker.terminate).not.toHaveBeenCalled()
    worker.onmessage?.call(worker as Worker, { data: { id: next.id, played } } as MessageEvent)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(referee.getError()).toBeNull()
    referee.dispose()
  })

  it('clears the watchdog when an unfinished referee is disposed', () => {
    vi.useFakeTimers()
    const { referee } = setup()
    referee.start()
    expect(vi.getTimerCount()).toBe(1)
    referee.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
