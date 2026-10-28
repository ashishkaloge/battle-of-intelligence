import { CORNERS as LABS } from '../../arena/corners.ts'
import type { Line } from '../commentary.ts'
import type { Reply } from '../reply.ts'
import { FIGHTERS, type Fighter, other } from '../ring/arena.ts'
import { type Cause, MAX_TICKS, type Rules } from './cycles.ts'
import {
  BOOSTS,
  type Bout,
  type Corner,
  type CornerSide,
  type Job,
  jobsFor,
  OPEN,
  type Outcome,
  RING,
  type ScriptedMatch,
  type TestRun,
} from './demo.ts'
import { HEIGHT, WIDTH } from './maps.ts'
import { LIMITS as SANDBOX } from './sandbox.ts'

/**
 * Live Bot Brawl: what each model is told in the corner, how its code and notes are read, the
 * limits both corners play under, and the record a fight leaves behind. The referee in
 * server/brawl.ts drives the CLIs and runs every bot in the sandbox; this file is pure, so prompts
 * and parsing are tested. A record keeps the code and the seeds, never the ticks: the broadcast
 * replays every test and match in the browser's own sandbox, which plays them the same way.
 */

export type Limits = {
  /** Wall clock for one corner decision: writing or patching a whole bot takes longer than a move. */
  shotClockMs: number
  callsPerCorner: number
  roundMs: number
  matchesToWin: number
  /** A bout that has not been decided after this many matches goes to the leader. */
  maxMatches: number
}

export const LIMITS: Limits = {
  shotClockMs: 150_000,
  callsPerCorner: 10,
  roundMs: 40 * 60_000,
  matchesToWin: 3,
  maxMatches: 7,
}

/** Version 4 requests code, a structured match claim and a shipping decision only. */
export const PROMPT_VERSION = 4

/** The three bouts and the rule each adds, the same as the demo's. */
export const SCHEDULE: readonly { name: string; rules: Rules; detail: string }[] = [
  {
    name: 'Open floor',
    rules: OPEN,
    detail: 'Two light cycles leave solid trails. Hit a wall or any trail and you crash.',
  },
  {
    name: 'Boosts',
    rules: BOOSTS,
    detail: 'Three boosts per match. A boost moves two cells in one tick.',
  },
  {
    name: 'Closing ring',
    rules: RING,
    detail: 'Every 25 ticks the outer ring turns to wall. Anyone still on it crashes.',
  },
]

/** The referee's sparring partners for corner tests. */
export const HOUSE = ['house-hugger', 'house-greedy'] as const

export type Ruling = 'played' | 'late' | 'unusable' | 'tools' | 'error' | 'capped'

export type LiveTest = TestRun & { fault?: string }

export type LiveCornerSide = {
  bot: string
  from: string | null
  note: string
  claim?: { match: number; cause: Cause; text: string }
  /** The tests of the bot that shipped. */
  tests: LiveTest[]
  verdict: string
  /** True when the model sent a fix after seeing its first tests. */
  fixed: boolean
  ruling: Ruling
  seconds: number
  calls: number
  error?: string
}

export type LiveMatch = { seed: number; flip: boolean; winner: Fighter | null; cause: Cause | null }

export type BrawlRecord = {
  /** Optional five-round recording session; historical fights have no session. */
  broadcast?: string
  version: 1
  round: 'brawl'
  id: string
  playedAt: string
  models: Record<Fighter, { name: string; id: string }>
  effort: Record<Fighter, string>
  limits: Limits
  seed: number
  prompt: number
  left: Fighter
  /** Every bot's source by name: each lab's versions and the house bots. */
  code: Record<string, string>
  corners: Record<Fighter, LiveCornerSide>[]
  bouts: { matches: LiveMatch[] }[]
  end: { winner: Fighter | null; bouts: Record<Fighter, number> }
  calls: Record<Fighter, number>
  seconds: number
  commentary?: Record<string, Line>
}

const NAME: Record<Fighter, string> = { claude: LABS.claude.name, gpt: LABS.gpt.name }

export const CAUSES: readonly Cause[] = [
  'wall',
  'own-trail',
  'their-trail',
  'head-on',
  'ring',
  'bug',
]

const API = [
  'Your bot is one JavaScript script that defines `function move(state)`. The referee calls it once per tick and it must return a direction: "up", "down", "left" or "right", or an object `{ dir, boost, say }` where `boost: true` spends a boost and `say` is a taunt of up to 24 characters shown on screen.',
  '`state` is:',
  '- `width`, `height`: the floor size. x runs 0 to width - 1 left to right, y runs 0 to height - 1 top to bottom, so "up" lowers y.',
  '- `tick`: the number of completed ticks, starting at 0 before the first move.',
  "- `grid[y][x]`: 0 empty, 1 wall or pillar, 2 your trail, 3 the other bot's trail. Both heads are trail cells.",
  '- `you`: `{ x, y, dir, boosts }`, where `dir` is the way you are facing and `boosts` how many you have left.',
  '- `them`: `{ x, y, dir, boosts, alive }`.',
  '- `closing`: `{ in, ring }` when a ring will close in `in` ticks (ring 0 is the outer edge, 1 the next one in), or null.',
  `- Both cycles move at once every tick and leave trail behind. Entering a wall, the edge, a pillar or any trail is a crash. Two cycles entering the same cell, or swapping cells, both crash (head-on). Reversing straight back into your own trail is a crash too. The last cycle running wins the match; ${MAX_TICKS} ticks with both alive is a draw.`,
  `- The floor is ${WIDTH} by ${HEIGHT} with pillars mirrored through the center, so both starts see the same floor. Starts are (3,8) facing right and (${WIDTH - 4},8) facing left.`,
  `- The sandbox: plain JavaScript (QuickJS), no imports, no network, no files, ${SANDBOX.memoryBytes / 1024 / 1024} MB of memory and a fixed step budget per tick (about ${SANDBOX.checksPerTick * 10}k basic operations). Globals persist between ticks of one match. Throwing an error, running out of steps or returning anything but a direction is a bug: your cycle crashes where it stands.`,
  '- Math.random uses the same seeded sequence for both bots and resets every match. Date and wall-clock APIs are unavailable; use state.tick for time.',
  '- Regular expressions are unavailable; use ordinary string and array operations.',
]

const RULES_NOW = (bout: number) => {
  const step = SCHEDULE[bout]
  if (!step) return ''
  const r = step.rules
  return `Bout ${bout + 1} of ${SCHEDULE.length}: ${step.name}. ${step.detail}${r.boosts ? ` Each cycle has ${r.boosts} boosts per match.` : ' No boosts.'}${r.closeEvery ? ` A ring closes every ${r.closeEvery} ticks, from the outside in.` : ''}`
}

const header = (me: Fighter) =>
  `You are ${NAME[me]}, fighting ${NAME[other(me)]} at Bot Brawl, the coding round of Battle of Intelligence. An audience is watching live. You do not play: your code does. Write a light-cycle bot that beats ${NAME[other(me)]}'s.`

const FORMAT = (fields: string) => [
  'Reply with a JSON object first, then your complete bot in one ```js code block, and nothing else:',
  fields,
  '```js',
  'function move(state) { ... }',
  '```',
  'Do not use any tools, run code or read files.',
]

/** The build: write a bot from the rules alone. */
export function buildPrompt(me: Fighter, limits: Limits): string {
  return [
    header(me),
    '',
    'How it works',
    `- ${SCHEDULE.length} bouts. A bout is first to ${limits.matchesToWin} match wins between your bot and ${NAME[other(me)]}'s; two bouts win the round. The rules add something each bout: boosts in bout 2, a closing ring in bout 3.`,
    '- Between bouts you are back in the corner: you see how each match ended and patch your code. The referee tests every bot you ship against its sparring bots and shows you the results first.',
    '',
    'The bot API',
    ...API,
    '',
    RULES_NOW(0),
    '',
    ...FORMAT('{}'),
  ].join('\n')
}

/** What the corner shows a model about one match it just played. */
export function matchReport(
  index: number,
  me: Fighter,
  match: { winner: Fighter | null; ticks: number },
  board: string,
): string {
  const result = match.winner === me ? 'you won' : match.winner ? 'you lost' : 'a draw'
  return [
    `Match ${index + 1}: ${result}, after ${match.ticks} ticks. The final floor (Y your head, X theirs, # wall, + your trail, - theirs):`,
    board,
  ].join('\n')
}

/** The corner between bouts: diagnose a match, then patch for the next rule. */
export function patchPrompt(input: {
  me: Fighter
  bout: number
  limits: Limits
  code: string
  version: number
  reports: readonly string[]
  score: Record<Fighter, number>
}): string {
  const { me, bout, limits, code, version, reports, score } = input
  return [
    header(me),
    '',
    'The bot API',
    ...API,
    '',
    `Bouts so far: you ${score[me]}, ${NAME[other(me)]} ${score[other(me)]}. Bout ${bout} is over. Here is how each match ended:`,
    ...reports,
    '',
    `Next: ${RULES_NOW(bout)} First to ${limits.matchesToWin} match wins again.`,
    '',
    `Your bot v${version}, which just played:`,
    '```js',
    code,
    '```',
    '',
    'Submit the ending cause of one match as a structured claim, then ship v' +
      `${version + 1}: your whole patched bot, ready for the new rule.`,
    ...FORMAT(`{"claim":{"match":the match number,"cause":"one of ${CAUSES.join(', ')}"}}`),
  ].join('\n')
}

const outcomeText = (test: LiveTest) =>
  test.expect === 'crash' ? `crashed: ${test.fault ?? 'bug'}` : test.expect

/** After the referee's tests: ship as it is, or send a fix. */
export function verdictPrompt(input: {
  me: Fighter
  version: number
  tests: readonly LiveTest[]
  labels: Record<string, string>
}): string {
  const { me, version, tests, labels } = input
  return [
    header(me),
    '',
    `The referee tested your bot v${version} under the next bout's rules. Your bot started on the left each time:`,
    ...tests.map(
      (t, i) => `- Test ${i + 1}, against ${labels[t.against] ?? t.against}: ${outcomeText(t)}.`,
    ),
    '',
    'Ship it as it is, or send a fixed version. A bug in a real match is a knockdown on the broadcast.',
    'Reply with a JSON object, then, only if you are fixing it, your complete fixed bot in one ```js code block:',
    '{"ship":true or false}',
    'Do not use any tools, run code or read files.',
  ].join('\n')
}

const claimCaption = (match: number, cause: Cause) =>
  `Match ${match}: ${cause.replaceAll('-', ' ')}.`

/** The largest bot a corner may ship. Real bots are a few kilobytes. */
export const MAX_CODE = 12_000

/** Splits a reply into its JSON object and the bot in its last ```js block. */
function split(text: string): { data: Record<string, unknown> | null; code: string | null } {
  const fences = [...text.matchAll(/```(?:js|javascript)?\s*\n([\s\S]*?)```/g)]
  const fence = fences.at(-1)
  const code = fence?.[1]?.trim() ?? null
  const rest = fence ? text.slice(0, fence.index) : text
  const start = rest.indexOf('{')
  const end = rest.lastIndexOf('}')
  let data: Record<string, unknown> | null = null
  if (start >= 0 && end > start) {
    try {
      const value: unknown = JSON.parse(rest.slice(start, end + 1))
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        data = value as Record<string, unknown>
      }
    } catch {
      data = null
    }
  }
  return { data, code }
}

const codeError = (code: string | null) =>
  !code
    ? 'no ```js code block with the bot'
    : code.length > MAX_CODE
      ? `the bot is longer than ${MAX_CODE} characters`
      : !/function\s+move\s*\(/.test(code)
        ? 'the bot must define function move(state)'
        : null

export type BuildReply = { code: string; note: string }
export type PatchReply = BuildReply & { claim: { match: number; cause: Cause; text: string } }
export type VerdictReply = { verdict: string; code: string | null }

export function parseBuildReply(text: string): Reply<BuildReply> {
  const { code } = split(text)
  const bad = codeError(code)
  if (bad) return { ok: false, error: bad }
  return { ok: true, value: { code: code as string, note: 'Submits a bot.' } }
}

export function parsePatchReply(text: string, matches: number): Reply<PatchReply> {
  const built = parseBuildReply(text)
  if (!built.ok) return built
  const { data } = split(text)
  const raw = data?.claim
  const claim =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  const match =
    typeof claim?.match === 'number'
      ? claim.match
      : typeof claim?.match === 'string' && /^\d+$/.test(claim.match.trim())
        ? Number(claim.match)
        : Number.NaN
  const cause = String(claim?.cause ?? '')
    .trim()
    .toLowerCase() as Cause
  if (!Number.isInteger(match) || match < 1 || match > matches) {
    return { ok: false, error: `"claim.match" must be a match number from 1 to ${matches}` }
  }
  if (!CAUSES.includes(cause))
    return { ok: false, error: `"claim.cause" must be one of ${CAUSES.join(', ')}` }
  return {
    ok: true,
    value: { ...built.value, claim: { match, cause, text: claimCaption(match, cause) } },
  }
}

export function parseVerdictReply(text: string): Reply<VerdictReply> {
  const { data, code } = split(text)
  if (!data) return { ok: false, error: 'no JSON object in the reply' }
  if (typeof data.ship !== 'boolean') {
    return { ok: false, error: '"ship" must be true or false' }
  }
  if (data.ship === false) {
    const bad = codeError(code)
    if (bad) return { ok: false, error: `a fix needs the whole bot: ${bad}` }
    return { ok: true, value: { verdict: 'Submits a revised bot.', code } }
  }
  return { ok: true, value: { verdict: 'Ships the tested bot.', code: null } }
}

/** A floor as text for the corner: walls, both trails and both heads. */
export function boardText(
  grid: readonly (readonly number[])[],
  me: Fighter,
  heads: Record<Fighter, { x: number; y: number }>,
  mine: number,
): string {
  return grid
    .map((row, y) =>
      row
        .map((cell, x) => {
          if (heads[me].x === x && heads[me].y === y) return 'Y'
          if (heads[other(me)].x === x && heads[other(me)].y === y) return 'X'
          return cell === 0 ? '.' : cell === 1 ? '#' : cell === mine ? '+' : '-'
        })
        .join(''),
    )
    .join('\n')
}

const TRUTH: Record<Cause, (who: string, foe: string) => string> = {
  wall: (who) => `${who} runs into a wall`,
  'own-trail': (who) => `${who} turns into its own trail`,
  'their-trail': (who, foe) => `${who} runs into ${foe}'s trail`,
  'head-on': () => 'Head-on! Both go down',
  ring: (who) => `the closing ring catches ${who}`,
  bug: (who) => `${who}'s bot throws an error and stops dead. A bug! Knockdown`,
}

/** The call after a match, from the engine's result. */
export function matchLine(match: LiveMatch, wins: Record<Fighter, number>, limits: Limits): Line {
  if (!match.winner) {
    const text =
      match.cause === 'head-on'
        ? 'Head-on! Both go down. A draw.'
        : match.cause
          ? 'Both crash on the same tick! A draw.'
          : `Nobody crashes in ${MAX_TICKS} ticks. A draw.`
    return { voice: 'color', text }
  }
  const loser = other(match.winner)
  const what = TRUTH[match.cause ?? 'wall'](NAME[loser], NAME[match.winner])
  const lead =
    wins[match.winner] >= limits.matchesToWin
      ? ` ${NAME[match.winner]} takes the bout!`
      : wins.claude === wins.gpt
        ? ` ${wins.claude} all.`
        : ` ${NAME[wins.claude > wins.gpt ? 'claude' : 'gpt']} leads ${Math.max(wins.claude, wins.gpt)} to ${Math.min(wins.claude, wins.gpt)}.`
  return { voice: 'play', text: `${what[0]?.toUpperCase()}${what.slice(1)}!${lead}` }
}

/** The analyst in the corner: whose claim holds, and who shipped a failing test. */
export function cornerLine(
  c: number,
  sides: Record<Fighter, LiveCornerSide>,
  previous: LiveMatch[] | undefined,
): Line {
  if (c === 0) {
    return {
      voice: 'color',
      text: 'The build. Each model writes a bot from the rules alone, and the referee tests it before the bell.',
    }
  }
  const parts: string[] = []
  for (const f of FIGHTERS) {
    const side = sides[f]
    const claim = side.claim
    const match = claim ? previous?.[claim.match - 1] : undefined
    if (claim && match && match.winner !== f && match.cause) {
      parts.push(
        claim.cause === match.cause
          ? `${NAME[f]} read match ${claim.match} right.`
          : `${NAME[f]} blames ${claim.cause.replace('-', ' ')} for match ${claim.match}; the engine says ${match.cause.replace('-', ' ')}.`,
      )
    }
    const crashed = side.tests.some((t) => t.expect === 'crash')
    if (crashed) parts.push(`${NAME[f]}'s own test crashed, and it shipped anyway!`)
    else if (side.fixed) parts.push(`${NAME[f]} saw its tests and sent a fix.`)
  }
  return {
    voice: 'color',
    text: parts.length ? parts.join(' ') : 'Both corners patch for the new rule.',
  }
}

/** The bout's replay: its first bug if there is one, otherwise the match that decided it. */
export function highlightOf(matches: readonly LiveMatch[]): number {
  const bug = matches.findIndex((m) => m.cause === 'bug')
  return bug >= 0 ? bug : Math.max(0, matches.length - 1)
}

const versionOf = (bot: string) => Number(bot.split('-')[1] ?? 1)

/** Who won each bout, by the record's matches. */
export function boutWinner(matches: readonly LiveMatch[]): Fighter | null {
  const wins = { claude: 0, gpt: 0 }
  for (const m of matches) if (m.winner) wins[m.winner] += 1
  return wins.claude === wins.gpt ? null : wins.claude > wins.gpt ? 'claude' : 'gpt'
}

export const lineId = {
  intro: 'brawl-intro',
  corner: (c: number) => `brawl-c${c}`,
  bell: (b: number) => `brawl-b${b + 1}-bell`,
  match: (b: number, m: number) => `brawl-b${b + 1}-m${m + 1}`,
  replay: (b: number) => `brawl-b${b + 1}-replay`,
}

/** A saved fight as the corners, bouts and sandbox jobs the broadcast plays. */
export function recordSchedule(record: BrawlRecord): {
  corners: Corner[]
  bouts: Bout[]
  jobs: Job[]
  intro: Line
} {
  const corners = record.corners.map((sides, c): Corner => {
    const step = SCHEDULE[c] ?? SCHEDULE[0]
    const side = (f: Fighter): CornerSide => {
      const s = sides[f]
      const note =
        s.ruling === 'played'
          ? `Submits bot v${versionOf(s.bot)}.`
          : 'No usable bot in time. The referee keeps the last one.'
      return {
        bot: s.bot,
        from: s.from,
        note,
        ...(s.claim
          ? {
              claim: {
                match: s.claim.match,
                cause: s.claim.cause,
                text: claimCaption(s.claim.match, s.claim.cause),
              },
            }
          : {}),
        tests: s.tests.map(({ against, seed, expect }) => ({ against, seed, expect })),
        verdict: s.fixed
          ? 'Submits a revised bot.'
          : s.ruling === 'played'
            ? 'Ships the tested bot.'
            : 'Keeps the previous bot.',
      }
    }
    return {
      rule: step?.name ?? '',
      detail: step?.detail ?? '',
      claude: side('claude'),
      gpt: side('gpt'),
      line: cornerLine(c, sides, record.bouts[c - 1]?.matches),
    }
  })
  const bouts = record.bouts.map((bout, b): Bout => {
    const step = SCHEDULE[b] ?? SCHEDULE[0]
    const wins = { claude: 0, gpt: 0 }
    const matches = bout.matches.map((m): ScriptedMatch => {
      if (m.winner) wins[m.winner] += 1
      return {
        seed: m.seed,
        flip: m.flip,
        expect: { winner: m.winner, cause: m.cause ?? 'wall' },
        line: matchLine(m, { ...wins }, record.limits),
      }
    })
    const highlight = highlightOf(bout.matches)
    const top = bout.matches[highlight]
    const loser = top?.winner ? other(top.winner) : null
    const winner = boutWinner(bout.matches)
    return {
      name: step?.name ?? '',
      rules: step?.rules ?? OPEN,
      bell: {
        voice: 'play',
        text:
          b === SCHEDULE.length - 1
            ? `Final bout! ${step?.detail}`
            : `Bout ${b + 1}! ${step?.name}. First to ${record.limits.matchesToWin}.`,
      },
      matches,
      highlight,
      replay: {
        voice: 'color',
        text:
          top?.cause === 'bug' && loser
            ? `Watch that bug again. ${NAME[loser]}'s code stopped, and its cycle went straight down.`
            : winner
              ? `${NAME[winner]} takes bout ${b + 1}. Watch how it ended.`
              : `Bout ${b + 1} ends level. Watch the last one again.`,
      },
    }
  })
  return {
    corners,
    bouts,
    jobs: jobsFor(corners, bouts),
    intro: {
      voice: 'play',
      text: `Welcome to Bot Brawl! ${record.models.claude.name} against ${record.models.gpt.name}, live. The models do not play this one. Their code does.`,
    },
  }
}

export type { Outcome }
export { versionOf }
