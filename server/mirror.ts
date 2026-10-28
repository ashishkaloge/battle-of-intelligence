import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CORNERS, type Tier } from '../src/arena/corners.ts'
import type { Move } from '../src/games/forge/moves.ts'
import {
  boardOf,
  drawBases,
  historyLine,
  LIMITS,
  type Limits,
  type LiveSide,
  type MirrorRecord,
  PROMPT_VERSION,
  parseTurnReply,
  playOf,
  turnPrompt,
} from '../src/games/mirror/live.ts'
import { type Base, LIVE_RULES, type Play, playMatch } from '../src/games/mirror/versus.ts'
import { FIGHTERS, type Fighter } from '../src/games/ring/arena.ts'
import { type AskOptions, type AskResult, askCli } from './cli.ts'
import { decide, throwIfStopped, together } from './move.ts'

export type MirrorReport = {
  turn: number
  sides: Record<Fighter, LiveSide>
  summary: string
  stacks: Record<Fighter, Move[]>
}

/**
 * Plays one real Mirror round between Claude and GPT. Each turn both models get the same base
 * puzzle at the same moment, each on its own board with whatever the rival stacked on it, and
 * answer with the rule they believe and the attack they would send. The engine judges the rules,
 * drops the attack of a side that missed, and runs Forge's solver on every attack before it lands.
 * The round ends at a knockout, after the last turn, or when the round clock runs out.
 */
export async function playMirror(options: {
  tier: Tier
  effort: Record<Fighter, string>
  signal: AbortSignal
  seed: number
  limits?: Limits
  left?: Fighter
  bases?: readonly Base[]
  /** Named broadcasts stop when provider access fails after its retry. */
  abortOnProviderError?: boolean
  ask?: (options: AskOptions) => Promise<AskResult>
  onReport?: (report: MirrorReport) => void
  now?: () => number
}): Promise<MirrorRecord> {
  const { tier, effort, signal, seed, limits = LIMITS, left = 'claude', ask = askCli } = options
  throwIfStopped(signal)
  const now = options.now ?? (() => performance.now())
  // One extra base: an attack sent on the last turn needs a next puzzle to be checked against.
  const bases = [...(options.bases ?? drawBases(seed, limits.turns + 1))]
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
  const turns: Record<Fighter, LiveSide>[] = []
  const plays: Record<Fighter, Play>[] = []
  let result = playMatch(bases, plays, LIVE_RULES)
  const cwd = await mkdtemp(join(tmpdir(), 'boi-mirror-'))

  try {
    for (let t = 0; t < Math.min(limits.turns, bases.length); t++) {
      throwIfStopped(signal)
      if (now() - started >= limits.roundMs) break
      const base = bases[t] as Base
      const last = result.turns.at(-1)
      const stacks = last?.stacks ?? { claude: [], gpt: [] }
      const clears = last?.clears ?? { claude: 0, gpt: 0 }
      const sides = await together(
        FIGHTERS.map(async (f): Promise<LiveSide> => {
          const decision = await decide({
            abortOnProviderError: options.abortOnProviderError ?? false,
            ask,
            lab: f,
            model: models[f].id,
            effort: effort[f],
            prompt: turnPrompt({ me: f, turn: t, base, stacks, clears, limits, history }),
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
          if (!decision.ok) {
            return {
              hypothesis: [],
              think: '',
              ruling: decision.ruling,
              ...timing,
              ...(decision.error ? { error: decision.error } : {}),
            }
          }
          const { hypothesis, attack, think, attackThink } = decision.value
          // A miss sends nothing, whatever the model asked for.
          const play = playOf(
            { hypothesis, ...(attack ? { attack } : {}) },
            boardOf(base, stacks[f]),
            base.test,
          )
          return {
            hypothesis,
            ...(play.attack ? { attack: play.attack } : {}),
            think,
            ...(play.attack && attackThink ? { attackThink } : {}),
            ruling: 'played',
            ...timing,
          }
        }),
      )
      const side = { claude: sides[0] as LiveSide, gpt: sides[1] as LiveSide }
      turns.push(side)
      plays.push({
        claude: {
          hypothesis: side.claude.hypothesis,
          ...(side.claude.attack ? { attack: side.claude.attack } : {}),
        },
        gpt: {
          hypothesis: side.gpt.hypothesis,
          ...(side.gpt.attack ? { attack: side.gpt.attack } : {}),
        },
      })
      result = playMatch(bases, plays, LIVE_RULES)
      const turn = result.turns.at(-1)
      if (!turn) throw new Error('the engine played no turn')
      const summary = historyLine(turn)
      history.push(summary)
      options.onReport?.({ turn: t, sides: side, summary, stacks: turn.stacks })
      if (result.ko) break
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }

  throwIfStopped(signal)
  return {
    version: 1,
    round: 'mirror',
    id: '',
    playedAt: new Date().toISOString(),
    models,
    effort: { ...effort },
    limits,
    seed,
    prompt: PROMPT_VERSION,
    left,
    rules: { ...LIVE_RULES },
    bases,
    turns,
    result,
    calls: { claude: budgets.claude.used, gpt: budgets.gpt.used },
    seconds: Math.round((now() - started) / 1000),
  }
}
