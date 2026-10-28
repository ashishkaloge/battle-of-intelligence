import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CORNERS, type Tier } from '../src/arena/corners.ts'
import {
  type ActTurn,
  actPrompt,
  type BluffRecord,
  defaultAction,
  type EndReason,
  type HoleTurn,
  historyLine,
  holePrompt,
  LIMITS,
  type Limits,
  PROMPT_VERSION,
  parseActReply,
  parseHoleReply,
  type RecordHand,
} from '../src/games/bluff/live.ts'
import { drawQuestions } from '../src/games/bluff/questions.ts'
import { newTable, type Question, startHand, type TableState } from '../src/games/bluff/table.ts'
import type { Reply } from '../src/games/reply.ts'
import { FIGHTERS, type Fighter, other } from '../src/games/ring/arena.ts'
import { type AskOptions, type AskResult, askCli } from './cli.ts'
import { type Decision, decide, throwIfStopped, together } from './move.ts'

/** A hand has at most three actions: claim, counter, call or fold. A fourth means a bug. */
const MAX_ACTIONS = 4

export type BluffReport =
  | { kind: 'hole'; hand: number; question: Question; hole: Record<Fighter, HoleTurn> }
  | { kind: 'act'; hand: number; turn: ActTurn }
  | { kind: 'hand'; hand: number; summary: string; table: TableState }

const timing = <T>(decision: Decision<T>) => ({
  seconds: decision.seconds,
  calls: decision.calls,
  ...(!decision.ok && decision.error ? { error: decision.error } : {}),
})

/**
 * Plays one real Bluff round between Claude and GPT. Each hand both corners answer the question at
 * the same moment with the same prompt; then the betting goes back and forth, one decision at a
 * time, each checked by the table engine before it counts. Openers alternate, starting with
 * `left`. The round ends at a knockout, after the last hand, or when the round clock runs out.
 */
export async function playBluff(options: {
  tier: Tier
  effort: Record<Fighter, string>
  signal: AbortSignal
  seed: number
  limits?: Limits
  /** Who sits on the left and opens hand 1. Callers alternate it from fight to fight. */
  left?: Fighter
  questions?: readonly Question[]
  /** Named broadcasts stop when provider access fails after its retry. */
  abortOnProviderError?: boolean
  ask?: (options: AskOptions) => Promise<AskResult>
  onReport?: (report: BluffReport) => void
  now?: () => number
}): Promise<BluffRecord> {
  const { tier, effort, signal, seed, limits = LIMITS, left = 'claude', ask = askCli } = options
  throwIfStopped(signal)
  const now = options.now ?? (() => performance.now())
  const questions = options.questions ?? drawQuestions(seed, limits.hands)
  const models = {
    claude: { ...CORNERS.claude.models[tier] },
    gpt: { ...CORNERS.gpt.models[tier] },
  }
  const started = now()
  const budgets: Record<Fighter, { used: number; cap: number }> = {
    claude: { used: 0, cap: limits.callsPerCorner },
    gpt: { used: 0, cap: limits.callsPerCorner },
  }
  const history: string[] = []
  const hands: RecordHand[] = []
  const cwd = await mkdtemp(join(tmpdir(), 'boi-bluff-'))
  const ask1 = <T>(fighter: Fighter, prompt: string, parse: (text: string) => Reply<T>) =>
    decide({
      abortOnProviderError: options.abortOnProviderError ?? false,
      ask,
      lab: fighter,
      model: models[fighter].id,
      effort: effort[fighter],
      prompt,
      parse,
      cwd,
      signal,
      shotClockMs: Math.min(limits.shotClockMs, started + limits.roundMs - now()),
      budget: budgets[fighter],
      now,
    })

  let table = newTable()
  let reason: EndReason = 'hands'
  try {
    for (let h = 0; h < Math.min(limits.hands, questions.length); h++) {
      throwIfStopped(signal)
      if (now() - started >= limits.roundMs) {
        reason = 'round-clock'
        break
      }
      const question = questions[h] as Question
      const opener: Fighter = h % 2 === 0 ? left : other(left)

      const holes = await together(
        FIGHTERS.map(async (f): Promise<HoleTurn> => {
          const decision = await ask1(
            f,
            holePrompt({ me: f, question, hand: h, table, limits, history }),
            parseHoleReply,
          )
          if (decision.ok) return { ...decision.value, ruling: 'played', ...timing(decision) }
          return {
            answer: '',
            confidence: 0,
            think: '',
            ruling: decision.ruling,
            ...timing(decision),
          }
        }),
      )
      const hole = { claude: holes[0] as HoleTurn, gpt: holes[1] as HoleTurn }
      options.onReport?.({ kind: 'hole', hand: h, question, hole })

      const play = startHand(table, opener)
      const moves: ActTurn[] = []
      while (play.status().phase !== 'over') {
        if (moves.length >= MAX_ACTIONS) throw new Error('a hand ran past its last action')
        const status = play.status()
        const me = status.turn
        const decision = await ask1(
          me,
          actPrompt({
            me,
            question,
            hand: h,
            hole: hole[me],
            status,
            done: moves.map((m) => m.action),
            limits,
            history,
          }),
          (text) => parseActReply(text, me, status),
        )
        const turn: ActTurn = decision.ok
          ? {
              action: decision.value.action,
              think: decision.value.think,
              ...(decision.value.say ? { say: decision.value.say } : {}),
              ruling: 'played',
              ...timing(decision),
            }
          : {
              action: defaultAction(me, status),
              think: '',
              ruling: decision.ruling,
              ...timing(decision),
            }
        play.act(turn.action)
        moves.push(turn)
        options.onReport?.({ kind: 'act', hand: h, turn })
      }

      const last = h === Math.min(limits.hands, questions.length) - 1
      const result = play.finish(question, last)
      table = result.state
      hands.push({ question, opener, hole, moves })
      const summary = historyLine(
        h,
        question,
        moves.map((m) => m.action),
        result.events,
      )
      history.push(summary)
      options.onReport?.({ kind: 'hand', hand: h, summary, table })
      if (table.out || table.draw) {
        reason = 'ko'
        break
      }
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }

  // A round cut short by the clock still has a carried pot; it goes back half and half.
  const stacks = { ...table.stacks }
  if (table.carry > 0) {
    const half = Math.floor(table.carry / 2)
    stacks.claude += half
    stacks.gpt += table.carry - half
  }
  const winner: Fighter | null = table.draw
    ? null
    : table.out
      ? other(table.out)
      : stacks.claude === stacks.gpt
        ? null
        : stacks.claude > stacks.gpt
          ? 'claude'
          : 'gpt'
  throwIfStopped(signal)
  return {
    version: 1,
    round: 'bluff',
    id: '',
    playedAt: new Date().toISOString(),
    models,
    effort: { ...effort },
    limits,
    seed,
    prompt: PROMPT_VERSION,
    left,
    hands,
    end: { reason, winner, stacks },
    calls: { claude: budgets.claude.used, gpt: budgets.gpt.used },
    seconds: Math.round((now() - started) / 1000),
  }
}
