import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CORNERS, type Tier } from '../src/arena/corners.ts'
import {
  type Arena,
  CONTACT_RULES,
  FIGHTERS,
  type Fighter,
  initialState,
  nextBout,
  type RingRules,
  type RingState,
  resolveTurn,
  swapCorners,
  winner,
} from '../src/games/ring/arena.ts'
import { makeCrossroads } from '../src/games/ring/floors.ts'
import {
  type CornerTurn,
  type EndReason,
  historyLine,
  LIMITS,
  type Limits,
  PROMPT_VERSION,
  parseMoveReply,
  type RecordTurn,
  type RingRecord,
  turnPrompt,
} from '../src/games/ring/live.ts'
import { type AskOptions, type AskResult, askCli } from './cli.ts'
import { decide, throwIfStopped, together } from './move.ts'

/** The prompt carries this many past turns; older ones add tokens and little else. */
const HISTORY_TURNS = 6

export type TurnReport = { bout: number; turn: number; sides: RecordTurn; summary: string }

/**
 * Plays one real Ring round between Claude and GPT. Both corners are asked for every move at the
 * same moment with the same prompt and the same shot clock; the engine judges the result. A fighter
 * who is down is not asked at all. The round stops at a knockout, after the last bout, or when the
 * round clock runs out, and returns the record the broadcast replays.
 */
export async function playRing(options: {
  tier: Tier
  /** The CLI effort flag per lab. Callers pass the same level to both. */
  effort: Record<Fighter, string>
  signal: AbortSignal
  limits?: Limits
  /** Crossroads unless a caller picks another floor. */
  arena?: Arena
  /** Contact rules unless a caller asks for the classic ones. */
  rules?: RingRules
  /** Who starts in the left corner. Callers alternate it from fight to fight. */
  opener?: Fighter
  /** Named broadcasts stop when provider access fails after its retry. */
  abortOnProviderError?: boolean
  ask?: (options: AskOptions) => Promise<AskResult>
  onTurn?: (report: TurnReport) => void
  now?: () => number
}): Promise<RingRecord> {
  const {
    tier,
    effort,
    signal,
    limits = LIMITS,
    arena = makeCrossroads(),
    rules = CONTACT_RULES,
    opener = 'claude',
    ask = askCli,
    onTurn,
  } = options
  throwIfStopped(signal)
  const now = options.now ?? (() => performance.now())
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
  // An empty folder per fight, so a CLI that looks around finds nothing to read.
  const cwd = await mkdtemp(join(tmpdir(), 'boi-ring-'))

  async function decideMove(
    fighter: Fighter,
    state: RingState,
    bout: number,
    turn: number,
  ): Promise<CornerTurn> {
    if (state.fighters[fighter].stunned > 0) {
      return { move: 'wait', think: '', ruling: 'down', seconds: 0, calls: 0 }
    }
    const decision = await decide({
      abortOnProviderError: options.abortOnProviderError ?? false,
      ask,
      lab: fighter,
      model: models[fighter].id,
      effort: effort[fighter],
      prompt: turnPrompt({
        state,
        me: fighter,
        bout,
        turn,
        limits,
        history: history.slice(-HISTORY_TURNS),
      }),
      parse: parseMoveReply,
      cwd,
      signal,
      shotClockMs: Math.min(limits.shotClockMs, started + limits.roundMs - now()),
      budget: budgets[fighter],
      now,
    })
    const { seconds, calls } = decision
    const extra = { seconds, calls }
    if (!decision.ok) {
      const error = decision.error ? { error: decision.error } : {}
      return { move: 'wait', think: '', ruling: decision.ruling, ...extra, ...error }
    }
    const { move, think, say } = decision.value
    return { move, think, ...(say ? { say } : {}), ruling: 'played', ...extra }
  }

  let state = initialState(opener === 'gpt' ? swapCorners(arena) : arena, rules)
  const bouts: RecordTurn[][] = []
  let reason: EndReason = 'bouts'
  try {
    for (let b = 0; b < limits.bouts && reason === 'bouts'; b++) {
      if (b > 0) {
        state = nextBout(state)
        // Without this, a model reads the last knockdown in the history and thinks it still counts.
        history.push(
          `Bell: bout ${b + 1} starts. ${rules.changeCorners ? 'The fighters have changed corners' : 'Both fighters are back in their corners'} and are on their feet; points, paint, knockdowns and found tiles carry over.`,
        )
      }
      const turns: RecordTurn[] = []
      bouts.push(turns)
      for (let t = 0; t < limits.turnsPerBout; t++) {
        throwIfStopped(signal)
        if (now() - started >= limits.roundMs) {
          reason = 'round-clock'
          break
        }
        const [claude, gpt] = await together(FIGHTERS.map((f) => decideMove(f, state, b, t)))
        if (!claude || !gpt) throw new Error('a corner gave no decision')
        const sides: RecordTurn = { claude, gpt }
        const before = state
        const result = resolveTurn(state, { claude: claude.move, gpt: gpt.move })
        state = result.state
        turns.push(sides)
        const summary = historyLine(b, t, sides, before, state, result.events)
        history.push(summary)
        onTurn?.({ bout: b, turn: t, sides, summary })
        if (state.ko) {
          reason = 'ko'
          break
        }
      }
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }

  const field = <T>(pick: (f: Fighter) => T) => ({ claude: pick('claude'), gpt: pick('gpt') })
  throwIfStopped(signal)
  return {
    version: 1,
    id: '',
    playedAt: new Date().toISOString(),
    models,
    effort: { ...effort },
    limits,
    arena,
    rules,
    prompt: PROMPT_VERSION,
    opener,
    bouts: bouts.filter((turns) => turns.length > 0),
    end: {
      reason,
      winner: winner(state),
      score: field((f) => state.fighters[f].score),
      knockdowns: field((f) => state.fighters[f].knockdowns),
    },
    calls: { claude: budgets.claude.used, gpt: budgets.gpt.used },
    seconds: Math.round((now() - started) / 1000),
  }
}
