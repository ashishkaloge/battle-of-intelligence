import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Job } from './demo.ts'
import { createReferee } from './referee.ts'

/**
 * Starts the referee worker on first use and hands out results by job id. Asking for a result that
 * is not ready yet waits for it.
 */
export function useReferee(jobs: readonly Job[], code: Record<string, string>) {
  const referee = useMemo(() => createReferee(jobs, code), [jobs, code])
  const error = useSyncExternalStore(referee.subscribe, referee.getError)
  useEffect(() => () => referee.dispose(), [referee])
  return { start: referee.start, get: referee.get, peek: referee.peek, error }
}
