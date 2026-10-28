import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CORNERS, type Tier } from '../src/arena/corners.ts'
import {
  type BuzzerRecord,
  historyLine,
  LIMITS,
  type Limits,
  type LiveTurn,
  PROMPT_VERSION,
  parseTurnReply,
  type RecordTossup,
  turnPrompt,
} from '../src/games/buzzer/live.ts'
import { drawProblems } from '../src/games/buzzer/problems.ts'
import { type Decision, type Problem, playTossup, REVEALS } from '../src/games/buzzer/quiz.ts'
import { FIGHTERS, type Fighter, other } from '../src/games/ring/arena.ts'
import { type AskOptions, type AskResult, askCli } from './cli.ts'
import { decide, throwIfStopped, together } from './move.ts'

export type BuzzerReport =
  | {
      kind: 'reveal'
      tossup: number
      reveal: number
      problem: Problem
      sides: Partial<Record<Fighter, LiveTurn>>
    }
  | { kind: 'tossup'; tossup: number; summary: string; score: Record<Fighter, number> }

/**
 * Plays one real Buzzer round between Claude and GPT. At every reveal, every model still in the
 * race is asked at the same moment with the same prompt; the tossup engine judges the buzzes. A
 * model that buzzed wrong is locked out and not asked again that tossup. The round ends after the
 * last tossup or when the round clock runs out.
 */
export async function playBuzzer(options: {
  tier: Tier
  effort: Record<Fighter, string>
  signal: AbortSignal
  seed: number
  limits?: Limits
  left?: Fighter
  problems?: readonly Problem[]
  /** Named broadcasts stop when provider access fails after its retry. */
  abortOnProviderError?: boolean
  ask?: (options: AskOptions) => Promise<AskResult>
  onReport?: (report: BuzzerReport) => void
  now?: () => number
}): Promise<BuzzerRecord> {
  const { tier, effort, signal, seed, limits = LIMITS, left = 'claude', ask = askCli } = options
  throwIfStopped(signal)
  const now = options.now ?? (() => performance.now())
  const problems = options.problems ?? drawProblems(seed, limits.tossups)
  const count = Math.min(limits.tossups, problems.length)
  const models = {
    claude: { ...CORNERS.claude.models[tier] },
    gpt: { ...CORNERS.gpt.models[tier] },
  }
  const started = now()
  const budgets: Record<Fighter, { used: number; cap: number }> = {
    claude: { used: 0, cap: limits.callsPerCorner },
    gpt: { used: 0, cap: limits.callsPerCorner },
  }
  const score: Record<Fighter, number> = { claude: 0, gpt: 0 }
  const history: string[] = []
  const tossups: RecordTossup[] = []
  const cwd = await mkdtemp(join(tmpdir(), 'boi-buzzer-'))
  let reason: BuzzerRecord['end']['reason'] = 'tossups'

  try {
    for (let t = 0; t < count; t++) {
      throwIfStopped(signal)
      if (now() - started >= limits.roundMs) {
        reason = 'round-clock'
        break
      }
      const problem = problems[t] as Problem
      const double = t === count - 1
      const turns: Partial<Record<Fighter, LiveTurn>>[] = []
      const out: Partial<Record<Fighter, { answer: number; reveal: number }>> = {}
      for (let r = 0; r < REVEALS; r++) {
        throwIfStopped(signal)
        if (now() - started >= limits.roundMs) {
          reason = 'round-clock'
          break
        }
        const racing = FIGHTERS.filter((f) => !out[f])
        if (racing.length === 0) break
        const sides: Partial<Record<Fighter, LiveTurn>> = {}
        await together(
          racing.map(async (f) => {
            const decision = await decide({
              abortOnProviderError: options.abortOnProviderError ?? false,
              ask,
              lab: f,
              model: models[f].id,
              effort: effort[f],
              prompt: turnPrompt({
                me: f,
                problem,
                tossup: t,
                reveal: r,
                double,
                score,
                rivalOut: out[other(f)] ?? null,
                limits,
                history,
              }),
              parse: parseTurnReply,
              cwd,
              signal,
              shotClockMs: Math.min(limits.shotClockMs, started + limits.roundMs - now()),
              budget: budgets[f],
              now,
            })
            const timing = {
              seconds: decision.seconds,
              calls: decision.calls,
            }
            sides[f] = decision.ok
              ? { ...decision.value, ruling: 'played', ...timing }
              : {
                  think: '',
                  decision: { kind: 'wait' },
                  ruling: decision.ruling,
                  ...timing,
                  ...(decision.error ? { error: decision.error } : {}),
                }
          }),
        )
        turns.push(sides)
        options.onReport?.({ kind: 'reveal', tossup: t, reveal: r, problem, sides })
        const buzzes = racing.flatMap((f) => {
          const d: Decision | undefined = sides[f]?.decision
          return d?.kind === 'buzz' ? [{ f, answer: d.answer }] : []
        })
        if (buzzes.some((b) => b.answer === problem.answer)) break
        for (const b of buzzes) out[b.f] = { answer: b.answer, reveal: r }
      }
      const result = playTossup(
        problem,
        turns.map((sides) => {
          const d: Partial<Record<Fighter, Decision>> = {}
          for (const f of FIGHTERS) {
            const side = sides[f]
            if (side) d[f] = side.decision
          }
          return d
        }),
        double,
      )
      score.claude += result.points.claude
      score.gpt += result.points.gpt
      tossups.push({ problem, double, turns })
      const summary = historyLine(t, problem, result.events)
      history.push(summary)
      options.onReport?.({ kind: 'tossup', tossup: t, summary, score: { ...score } })
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }

  throwIfStopped(signal)
  return {
    version: 1,
    round: 'buzzer',
    id: '',
    playedAt: new Date().toISOString(),
    models,
    effort: { ...effort },
    limits,
    seed,
    prompt: PROMPT_VERSION,
    left,
    tossups,
    end: {
      reason,
      winner: score.claude === score.gpt ? null : score.claude > score.gpt ? 'claude' : 'gpt',
      score: { ...score },
    },
    calls: { claude: budgets.claude.used, gpt: budgets.gpt.used },
    seconds: Math.round((now() - started) / 1000),
  }
}
