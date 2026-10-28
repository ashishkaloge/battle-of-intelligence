import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CORNERS, type Tier } from '../src/arena/corners.ts'
import { type Rules, viewFor } from '../src/games/brawl/cycles.ts'
import {
  type BrawlRecord,
  boardText,
  buildPrompt,
  HOUSE,
  LIMITS,
  type Limits,
  type LiveCornerSide,
  type LiveMatch,
  type LiveTest,
  matchReport,
  type PatchReply,
  PROMPT_VERSION,
  parseBuildReply,
  parsePatchReply,
  parseVerdictReply,
  patchPrompt,
  SCHEDULE,
  verdictPrompt,
} from '../src/games/brawl/live.ts'
import { makeMap } from '../src/games/brawl/maps.ts'
import { type Played, playMatch } from '../src/games/brawl/match.ts'
import { loadQuickJS } from '../src/games/brawl/sandbox.ts'
import type { Reply } from '../src/games/reply.ts'
import { FIGHTERS, type Fighter, other } from '../src/games/ring/arena.ts'
import { between, random } from '../src/lib/random.ts'
import { type AskOptions, type AskResult, askCli } from './cli.ts'
import { decide, throwIfStopped, together } from './move.ts'

/** The house bots, read from the files the browser bundles. */
const HOUSE_CODE: Record<string, string> = Object.fromEntries(
  HOUSE.map((name) => [
    name,
    readFileSync(new URL(`../src/games/brawl/bots/${name}.js`, import.meta.url), 'utf8'),
  ]),
)

/** Fielded when a model gives no usable bot at the build: it drives straight on. */
const STRAIGHT =
  "// The referee's stand-in: no usable bot arrived in time.\nfunction move(s) {\n  return s.you.dir\n}\n"

const LABELS: Record<string, string> = {
  'house-hugger': 'the wall hugger',
  'house-greedy': 'the greedy bot',
}

export type BrawlReport =
  | { kind: 'corner'; corner: number; sides: Record<Fighter, LiveCornerSide> }
  | { kind: 'match'; bout: number; match: number; result: LiveMatch; wins: Record<Fighter, number> }

/** Both heads, keyed by fighter, from one side's view of the floor. */
function headsOf(
  me: Fighter,
  view: ReturnType<typeof viewFor>,
): Record<Fighter, { x: number; y: number }> {
  const heads = { claude: view.you, gpt: view.you }
  heads[other(me)] = view.them
  return heads
}

const outcome = (played: Played, fighter: Fighter): Pick<LiveTest, 'expect' | 'fault'> => {
  const fault = played.faults[fighter]
  if (fault) return { expect: 'crash', fault: fault.message }
  if (played.winner === fighter) return { expect: 'win' }
  return { expect: played.winner === null ? 'draw' : 'loss' }
}

const causeOf = (played: Played) => {
  if (played.winner) return played.crashes[other(played.winner)]?.cause ?? null
  return played.crashes.claude?.cause ?? played.crashes.gpt?.cause ?? null
}

/**
 * Plays one real Bot Brawl between Claude and GPT. In each corner both models are asked at the
 * same moment: at the build for a bot from the rules alone, between bouts for a diagnosis and a
 * patch after seeing how every match ended. The referee tests what they send against its sparring
 * bots and shows them the results; each may ship or send one fix. Then the bots fight, first to
 * three, in the same sandbox the broadcast uses. Nobody's code runs outside it.
 */
export async function playBrawl(options: {
  tier: Tier
  effort: Record<Fighter, string>
  signal: AbortSignal
  seed: number
  limits?: Limits
  left?: Fighter
  /** Named broadcasts stop when provider access fails after its retry. */
  abortOnProviderError?: boolean
  ask?: (options: AskOptions) => Promise<AskResult>
  onReport?: (report: BrawlReport) => void
  now?: () => number
}): Promise<BrawlRecord> {
  const { tier, effort, signal, seed, limits = LIMITS, left = 'claude', ask = askCli } = options
  throwIfStopped(signal)
  const now = options.now ?? (() => performance.now())
  const rand = random(seed)
  const qjs = await loadQuickJS()
  const models = {
    claude: { ...CORNERS.claude.models[tier] },
    gpt: { ...CORNERS.gpt.models[tier] },
  }
  const started = now()
  const budgets: Record<Fighter, { used: number; cap: number }> = {
    claude: { used: 0, cap: limits.callsPerCorner },
    gpt: { used: 0, cap: limits.callsPerCorner },
  }
  const code: Record<string, string> = { ...HOUSE_CODE }
  const shipped: Record<Fighter, string | null> = { claude: null, gpt: null }
  const corners: Record<Fighter, LiveCornerSide>[] = []
  const bouts: { matches: LiveMatch[] }[] = []
  const won: Record<Fighter, number> = { claude: 0, gpt: 0 }
  let lastPlayed: Played[] = []
  const cwd = await mkdtemp(join(tmpdir(), 'boi-brawl-'))

  const run = (rules: Rules, bots: Record<Fighter, string>, matchSeed: number, flip: boolean) =>
    playMatch(qjs, makeMap(matchSeed, flip), rules, {
      claude: code[bots.claude] ?? STRAIGHT,
      gpt: code[bots.gpt] ?? STRAIGHT,
    })

  /** Three tests of `bot` under the next bout's rules, the tested bot always on the left. */
  const test = (fighter: Fighter, bot: string, rules: Rules, seeds: number[]): LiveTest[] => {
    const previous = shipped[fighter]
    const against = [HOUSE[0], HOUSE[1], previous ?? HOUSE[0]]
    return against.map((rival, t) => {
      const testSeed = seeds[t] ?? 1
      const bots = fighter === 'claude' ? { claude: bot, gpt: rival } : { claude: rival, gpt: bot }
      return {
        against: rival,
        seed: testSeed,
        ...outcome(run(rules, bots, testSeed, fighter === 'gpt'), fighter),
      }
    })
  }

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

  try {
    for (let c = 0; c < SCHEDULE.length; c++) {
      throwIfStopped(signal)
      if (now() - started >= limits.roundMs) break
      const step = SCHEDULE[c]
      if (!step) break
      const seeds = [between(rand, 1, 1e9), between(rand, 1, 1e9), between(rand, 1, 1e9)]
      const previous = bouts[c - 1]?.matches ?? []

      const sides = await together(
        FIGHTERS.map(async (f): Promise<LiveCornerSide> => {
          const was = shipped[f]
          const version = was ? Number(was.split('-')[1]) : 0
          const name = `${f}-${version + 1}`
          const first =
            c === 0
              ? await ask1(f, buildPrompt(f, limits), parseBuildReply)
              : await ask1(
                  f,
                  patchPrompt({
                    me: f,
                    bout: c,
                    limits,
                    code: code[was ?? ''] ?? STRAIGHT,
                    version,
                    score: { ...won },
                    reports: lastPlayed.map((played, m) => {
                      const view = viewFor(played.final, f)
                      return matchReport(
                        m,
                        f,
                        { winner: played.winner, ticks: played.ticks.length },
                        boardText(view.grid, f, headsOf(f, view), 2),
                      )
                    }),
                  }),
                  (text) => parsePatchReply(text, previous.length),
                )
          const timing = { seconds: first.seconds, calls: first.calls }
          if (!first.ok) {
            // No usable bot: the build fields a stand-in, a patch keeps the last version.
            const bot = was ?? name
            if (!was) code[name] = STRAIGHT
            return {
              bot,
              from: was ? was : null,
              note: '',
              tests: test(f, bot, step.rules, seeds),
              verdict: '',
              fixed: false,
              ruling: first.ruling,
              ...timing,
              ...(first.error ? { error: first.error } : {}),
            }
          }
          code[name] = first.value.code
          let tests = test(f, name, step.rules, seeds)
          const verdict = await ask1(
            f,
            verdictPrompt({
              me: f,
              version: version + 1,
              tests,
              labels: { ...LABELS, ...(was ? { [was]: `your own v${version}` } : {}) },
            }),
            parseVerdictReply,
          )
          let fixed = false
          let said = ''
          if (verdict.ok) {
            said = verdict.value.verdict
            if (verdict.value.code) {
              code[name] = verdict.value.code
              tests = test(f, name, step.rules, seeds)
              fixed = true
            }
          }
          return {
            bot: name,
            from: was,
            note: first.value.note,
            ...(c > 0 ? { claim: (first.value as PatchReply).claim } : {}),
            tests,
            verdict: said,
            fixed,
            ruling: 'played',
            seconds: Math.round((first.seconds + verdict.seconds) * 10) / 10,
            calls: first.calls + verdict.calls,
          }
        }),
      )
      const corner = { claude: sides[0] as LiveCornerSide, gpt: sides[1] as LiveCornerSide }
      corners.push(corner)
      for (const f of FIGHTERS) shipped[f] = corner[f].bot
      options.onReport?.({ kind: 'corner', corner: c, sides: corner })

      // The bout: first to `matchesToWin`, sides swapping every match, the left seat first.
      const matches: LiveMatch[] = []
      const played: Played[] = []
      const wins: Record<Fighter, number> = { claude: 0, gpt: 0 }
      for (let m = 0; m < limits.maxMatches; m++) {
        throwIfStopped(signal)
        if (now() - started >= limits.roundMs) break
        if (Math.max(wins.claude, wins.gpt) >= limits.matchesToWin) break
        const matchSeed = between(rand, 1, 1e9)
        const flip = (m % 2 === 1) !== (left === 'gpt')
        const result = run(
          step.rules,
          { claude: corner.claude.bot, gpt: corner.gpt.bot },
          matchSeed,
          flip,
        )
        if (result.winner) wins[result.winner] += 1
        const live = { seed: matchSeed, flip, winner: result.winner, cause: causeOf(result) }
        matches.push(live)
        played.push(result)
        options.onReport?.({ kind: 'match', bout: c, match: m, result: live, wins: { ...wins } })
      }
      bouts.push({ matches })
      lastPlayed = played
      const boutWinner = wins.claude === wins.gpt ? null : wins.claude > wins.gpt ? 'claude' : 'gpt'
      if (boutWinner) won[boutWinner] += 1
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }

  throwIfStopped(signal)
  return {
    version: 1,
    round: 'brawl',
    id: '',
    playedAt: new Date().toISOString(),
    models,
    effort: { ...effort },
    limits,
    seed,
    prompt: PROMPT_VERSION,
    left,
    code,
    corners,
    bouts,
    end: {
      winner: won.claude === won.gpt ? null : won.claude > won.gpt ? 'claude' : 'gpt',
      bouts: { ...won },
    },
    calls: { claude: budgets.claude.used, gpt: budgets.gpt.used },
    seconds: Math.round((now() - started) / 1000),
  }
}
