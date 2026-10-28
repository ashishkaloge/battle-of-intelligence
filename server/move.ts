import type { Reply } from '../src/games/reply.ts'
import type { Fighter } from '../src/games/ring/arena.ts'
import { type AskOptions, type AskResult, failureHint } from './cli.ts'

export function throwIfStopped(signal: AbortSignal) {
  if (signal.aborted) throw new Error('stopped')
}

/** Wait for both processes to stop before a caller removes their temporary directory. */
export async function together<T>(calls: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(calls)
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  return results.map((result) => (result as PromiseFulfilledResult<T>).value)
}

/** Not worth starting a call with less than this left on the shot clock. */
const MIN_CALL_MS = 5_000

/** Why the referee, not the model, settled a decision. */
export type Missed = 'late' | 'unusable' | 'tools' | 'error' | 'capped'

export type Decision<T> = {
  seconds: number
  calls: number
} & ({ ok: true; value: T } | { ok: false; ruling: Missed; error?: string })

/**
 * One decision from one corner, the way every live round asks for it: a call under the shot clock,
 * one retry if the reply could not be used, and never past the corner's call cap. A late reply is
 * not retried. When the cap or the clock rules out the retry, the first failure is what counts.
 * `parse` decides what "usable" means, so a round can reject an illegal bet the same way as
 * broken JSON, and the model gets the reason on its retry.
 */
export async function decide<T>(options: {
  ask: (options: AskOptions) => Promise<AskResult>
  lab: Fighter
  model: string
  effort: string
  prompt: string
  parse: (text: string) => Reply<T>
  cwd: string
  signal: AbortSignal
  shotClockMs: number
  /** Calls this corner has made so far in the round, and how many it may make. Updated in place. */
  budget: { used: number; cap: number }
  /** Provider outages cannot become scored fallback moves in a named launch broadcast. */
  abortOnProviderError?: boolean
  now: () => number
}): Promise<Decision<T>> {
  const { ask, lab, model, effort, parse, cwd, signal, budget, now } = options
  throwIfStopped(signal)
  const start = now()
  const deadline = start + options.shotClockMs
  let prompt = options.prompt
  let calls = 0
  const wrap = <D extends object>(decision: D) => ({
    ...decision,
    seconds: Math.round((now() - start) / 100) / 10,
    calls,
  })
  const missed = (ruling: Missed, error?: string) => {
    if (ruling === 'error' && options.abortOnProviderError) {
      const hint = failureHint(error ?? '')
      const reason =
        hint === 'the provider refused this request' ? 'request refused' : 'provider unavailable'
      throw new Error(`${lab} ${reason}; broadcast round not saved (${hint})`)
    }
    return wrap({ ok: false as const, ruling, ...(error ? { error } : {}) })
  }

  let failed: { ruling: 'unusable' | 'error'; error: string } | null = null
  for (;;) {
    throwIfStopped(signal)
    if (budget.used >= budget.cap)
      return failed ? missed(failed.ruling, failed.error) : missed('capped')
    const left = deadline - now()
    if (left < MIN_CALL_MS) return failed ? missed(failed.ruling, failed.error) : missed('late')
    budget.used += 1
    calls += 1
    const result = await ask({
      lab,
      model,
      effort,
      prompt,
      cwd,
      signal,
      timeoutMs: left,
    }).catch((error: unknown) =>
      error instanceof Error ? error : new Error('the model call failed'),
    )
    throwIfStopped(signal)

    if (result instanceof Error) {
      if (result.name === 'TimeoutError') return missed('late')
      if (
        options.abortOnProviderError &&
        failureHint(result.message) === 'the provider refused this request'
      )
        return missed('error', result.message)
      if (calls >= 2) return missed('error', result.message)
      failed = { ruling: 'error', error: result.message }
      continue
    }
    if (now() > deadline) return missed('late')
    if (result.toolUse.length > 0) return missed('tools', `used ${result.toolUse.join(', ')}`)
    const parsed = parse(result.text)
    if (parsed.ok) return wrap({ ok: true as const, value: parsed.value })
    if (calls >= 2) return missed('unusable', parsed.error)
    failed = { ruling: 'unusable', error: parsed.error }
    prompt = `${options.prompt}\n\nYour last reply could not be used: ${parsed.error}. Reply with only the JSON object.`
  }
}
