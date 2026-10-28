import type { Job } from './demo.ts'
import { makeMap } from './maps.ts'
import { playMatch } from './match.ts'
import { loadQuickJS } from './sandbox.ts'

/**
 * The referee, off the main thread: plays each job in order with both bots in their sandboxes and
 * posts every result as soon as it is ready, so the broadcast never stutters while bots think.
 */
// The app's types describe a window; inside a worker only these two members matter.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ jobs: Job[]; code: Record<string, string> }>) => void) | null
  postMessage: (message: unknown) => void
}

scope.onmessage = async (event) => {
  try {
    const qjs = await loadQuickJS()
    const { jobs, code: source } = event.data
    for (const job of jobs) {
      const code = { claude: source[job.bots.claude] ?? '', gpt: source[job.bots.gpt] ?? '' }
      const played = playMatch(qjs, makeMap(job.seed, job.flip), job.rules, code)
      scope.postMessage({ id: job.id, played })
    }
  } catch {
    scope.postMessage({ error: 'referee failed' })
  }
}
