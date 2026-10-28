import { CORNERS } from '../../arena/corners.ts'
import { between, pick, type Rand, random } from '../../lib/random.ts'
import type { Line } from '../commentary.ts'
import { formatGrid, type Grid, sameGrid } from '../forge/grid.ts'
import { type Move, runProgram, TOOLBOX } from '../forge/moves.ts'
import { generatePool } from '../forge/pool.ts'
import { checkPuzzle } from '../forge/solver.ts'
import { formatMove, parseMove, SYNTAX_EXAMPLES } from '../forge/syntax.ts'
import type { Reply } from '../reply.ts'
import { FIGHTERS, type Fighter, other } from '../ring/arena.ts'
import type { ScriptedTurn } from './demo.ts'
import {
  type Base,
  BUDGET,
  type MirrorRules,
  type Play,
  TOP_OUT,
  type TurnResult,
} from './versus.ts'

/**
 * Live Mirror fights: the base puzzles a fight is drawn from, what each model is told every turn,
 * how its reply is read, the limits both corners play under, and the record a fight leaves behind.
 * The referee in server/mirror.ts drives the CLIs; this file is pure, so prompts and parsing are
 * tested, and a saved fight replays through the same engine and broadcast as the demo.
 */

export type Limits = { turns: number; shotClockMs: number; callsPerCorner: number; roundMs: number }

/** Five turns like the demo. Grid puzzles get a longer shot clock than a Ring move. */
export const LIMITS: Limits = {
  turns: 5,
  shotClockMs: 90_000,
  callsPerCorner: 12,
  roundMs: 30 * 60_000,
}

/** Version 4 requests the final rule and attack only. */
export const PROMPT_VERSION = 4

export type Ruling = 'played' | 'late' | 'unusable' | 'tools' | 'error' | 'capped'

export type LiveSide = {
  hypothesis: Move[]
  /** Only kept when the side cleared: the engine refuses an attack from a miss. */
  attack?: Move
  think: string
  attackThink?: string
  ruling: Ruling
  seconds: number
  calls: number
  reasoning?: string
  error?: string
}

export type MirrorRecord = {
  /** Optional five-round recording session; historical fights have no session. */
  broadcast?: string
  version: 1
  round: 'mirror'
  id: string
  playedAt: string
  models: Record<Fighter, { name: string; id: string }>
  effort: Record<Fighter, string>
  limits: Limits
  seed: number
  prompt: number
  left: Fighter
  /** Omitted by historical records that checked attacks only against the next base. */
  rules?: MirrorRules
  bases: Base[]
  turns: Record<Fighter, LiveSide>[]
  /** The engine's verdicts, saved so the broadcast needs no solver; tests replay them. */
  result: { turns: TurnResult[]; ko: Fighter | null; winner: Fighter | null }
  calls: Record<Fighter, number>
  seconds: number
  commentary?: Record<string, Line>
}

const NAME: Record<Fighter, string> = { claude: CORNERS.claude.name, gpt: CORNERS.gpt.name }

/**
 * Base moves a turn can hide. Geometric moves only: they act on any palette, so the base rule and
 * every attack stacked on it always apply, which a colour move cannot promise.
 */
const BASE_MOVES: readonly Move[] = [
  { op: 'rotate', turns: 1 },
  { op: 'rotate', turns: 2 },
  { op: 'rotate', turns: 3 },
  { op: 'mirror', axis: 'left-right' },
  { op: 'mirror', axis: 'top-bottom' },
  { op: 'gravity', dir: 'up' },
  { op: 'gravity', dir: 'down' },
  { op: 'gravity', dir: 'left' },
  { op: 'gravity', dir: 'right' },
  { op: 'extend', dir: 'up' },
  { op: 'extend', dir: 'down' },
  { op: 'extend', dir: 'left' },
  { op: 'extend', dir: 'right' },
  { op: 'crop' },
  { op: 'scale' },
]

function drawBase(rand: Rand, used: Set<string>): Base | null {
  const pool = generatePool(between(rand, 1, 2 ** 30), 6)
  const [a, b, c, test] = pool
  const move = pick(rand, BASE_MOVES)
  if (!a || !b || !c || !test || used.has(formatMove(move))) return null
  const base = { program: [move], examples: [a, b, c], test }
  // The base puzzle alone must be fair: exactly one one-move rule fits it.
  return checkPuzzle(base, 1).valid ? base : null
}

/** A fight's base puzzles, from a seed: a fresh grid pool and a different hidden move each turn. */
export function drawBases(seed: number, count: number): Base[] {
  if (!Number.isInteger(count) || count < 0 || count > BASE_MOVES.length) {
    throw new RangeError(`base puzzle count must be a whole number from 0 to ${BASE_MOVES.length}`)
  }
  const rand = random(seed)
  const used = new Set<string>()
  const out: Base[] = []
  // Even an unlucky seed must fail explicitly instead of blocking the referee forever.
  for (let attempts = 0; out.length < count && attempts < 10_000; attempts++) {
    const base = drawBase(rand, used)
    if (!base) continue
    out.push(base)
    used.add(formatMove(base.program[0] as Move))
  }
  if (out.length !== count) throw new Error('could not draw enough distinct fair base puzzles')
  return out
}

/** Each side's board this turn: its rule is the base move plus what the rival stacked on it. */
export function boardOf(base: Base, stack: readonly Move[]) {
  const program = [...base.program, ...stack]
  return {
    program,
    outputs: base.examples.map((input) => runProgram(program, input) as Grid),
    truth: runProgram(program, base.test) as Grid,
  }
}

const moves = (list: readonly Move[]) => list.map(formatMove).join(', ')

/** A finished turn as a line of history both models are shown. */
export function historyLine(result: TurnResult): string {
  const parts = FIGHTERS.map((f) => {
    const a = result.answers[f]
    if (!a.right) return `${NAME[f]} missed`
    const attack = result.attacks[f]
    if (!attack) return `${NAME[f]} cleared`
    const verdict = attack.ko
      ? 'which topped its rival out'
      : attack.landed
        ? 'which landed'
        : 'which the referee blocked'
    return `${NAME[f]} cleared and sent ${formatMove(attack.move)}, ${verdict}`
  })
  return `Turn ${result.turn}: ${parts.join('; ')}.`
}

/** The prompt for one turn. Both corners get it at the same moment, each with its own board. */
export function turnPrompt(input: {
  me: Fighter
  turn: number
  base: Base
  stacks: Record<Fighter, readonly Move[]>
  clears: Record<Fighter, number>
  limits: Limits
  history: readonly string[]
}): string {
  const { me, turn, base, stacks, clears, limits, history } = input
  const them = other(me)
  const board = boardOf(base, stacks[me])
  const letters = ['A', 'B', 'C']
  const mine = stacks[me].length
    ? `Stacked on your board by ${NAME[them]}, applied after the base move in this order: ${moves(stacks[me])}.`
    : 'Nothing is stacked on your board: its rule is the base move alone.'
  const theirs = stacks[them].length
    ? `Stacked on ${NAME[them]}'s board by you: ${moves(stacks[them])}.`
    : `Nothing is stacked on ${NAME[them]}'s board.`
  return [
    `You are ${NAME[me]}, playing ${NAME[them]} at Mirror, the reasoning round of Battle of Intelligence. An audience is watching live. Play to win.`,
    '',
    'How it works',
    `- Versus ARC. Each turn you and ${NAME[them]} get the same base puzzle on mirrored boards: three example grids with their outputs, and a test grid. A hidden rule turns each input into its output.`,
    '- Grids are rows of digits separated by "/". 0 is empty; 1 to 9 are colors. An object is a group of same-colored cells joined edge to edge.',
    `- The rule on your board is this turn's base move, one move from the toolbox, followed by every attack ${NAME[them]} has stacked on you. The rule on ${NAME[them]}'s board is the same base move followed by what you stacked on it.`,
    '- Answer with the whole rule on your board as a chain of moves. The referee runs your chain on your test grid; if it gives the exact output, you clear.',
    `- Clear and your stack is wiped, and you send one attack: a toolbox move stacked on ${NAME[them]}'s next puzzle. It lands only if the referee proves the stacked rule stays playable and has exactly one answer on every remaining base; otherwise it is blocked. Miss and your stack stays, and you send nothing.`,
    `- ${TOP_OUT} stacked attacks on a board is a knockout. After ${limits.turns} turns, most clears wins. If clears are tied, fewer attacks left on your board wins; if those are tied too, the round is a draw.`,
    '',
    `The toolbox. Rules are chains of 1 to ${BUDGET} of these moves, applied left to right:`,
    ...Object.values(TOOLBOX).map((line) => `- ${line}`),
    `Write moves exactly like: ${SYNTAX_EXAMPLES}`,
    '',
    'Earlier turns, most recent last:',
    ...(history.length > 0 ? history : ['None. This is the first turn.']),
    '',
    `Turn ${turn + 1} of ${limits.turns}. Clears: you ${clears[me]}, ${NAME[them]} ${clears[them]}.`,
    mine,
    theirs,
    '',
    'Your board:',
    ...base.examples.map(
      (grid, i) =>
        `Example ${letters[i]}: ${formatGrid(grid)} -> ${formatGrid(board.outputs[i] ?? grid)}`,
    ),
    `Test input: ${formatGrid(base.test)}`,
    '',
    'Reply with only your final rule and attack in this JSON object:',
    `{"rule":["move","..."],"attack":"one move to send if you clear"}`,
    'Do not use any tools, run code or read files.',
  ].join('\n')
}

export type TurnReply = { hypothesis: Move[]; attack?: Move; think: string; attackThink: string }

const ruleCaption = (rule: readonly Move[]) => `Submits ${moves(rule)}.`
const attackCaption = (attack: Move) => `Sends ${formatMove(attack)}.`

export function parseTurnReply(text: string): Reply<TurnReply> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  let data: Record<string, unknown> | null = null
  if (start >= 0 && end > start) {
    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1))
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        data = value as Record<string, unknown>
      }
    } catch {
      data = null
    }
  }
  if (!data) return { ok: false, error: 'no JSON object in the reply' }
  const rule = Array.isArray(data.rule)
    ? data.rule
    : typeof data.rule === 'string'
      ? [data.rule]
      : []
  if (rule.length < 1 || rule.length > BUDGET) {
    return { ok: false, error: `"rule" must list 1 to ${BUDGET} moves` }
  }
  const hypothesis: Move[] = []
  for (const item of rule) {
    const parsed = parseMove(String(item))
    if (!parsed.ok) return { ok: false, error: parsed.error }
    hypothesis.push(parsed.move)
  }
  const value: TurnReply = {
    hypothesis,
    think: ruleCaption(hypothesis),
    attackThink: '',
  }
  const attackText = typeof data.attack === 'string' ? data.attack.trim() : ''
  if (attackText) {
    const parsed = parseMove(attackText)
    if (!parsed.ok) return { ok: false, error: `attack ${parsed.error}` }
    value.attack = parsed.move
    value.attackThink = attackCaption(parsed.move)
  }
  return { ok: true, value }
}

/** What the engine is given for a side: its rule, and its attack only if that rule clears. */
export function playOf(
  side: Pick<LiveSide, 'hypothesis' | 'attack'>,
  board: { truth: Grid },
  test: Grid,
): Play {
  const grid = runProgram(side.hypothesis, test)
  const right = grid !== null && sameGrid(grid, board.truth)
  return { hypothesis: side.hypothesis, ...(right && side.attack ? { attack: side.attack } : {}) }
}

const REFEREE: Record<Exclude<Ruling, 'played'>, string> = {
  late: 'No reply inside the shot clock. It misses.',
  unusable: 'Its reply had no usable rule. It misses.',
  tools: 'It reached for a tool, which is against the rules. It misses.',
  error: 'Its CLI could not answer. It misses.',
  capped: 'Out of calls for this round. It misses.',
}

/** A move as a commentator would say it. */
export function spokenMove(move: Move): string {
  switch (move.op) {
    case 'rotate':
      return move.turns === 2
        ? 'a half turn'
        : move.turns === 1
          ? 'a quarter turn'
          : 'a turn the other way'
    case 'mirror':
      return move.axis === 'diagonal' ? 'a diagonal flip' : `a ${move.axis} flip`
    case 'gravity':
      return `gravity ${move.dir}`
    case 'extend':
      return `lines shooting ${move.dir}`
    case 'shift':
      return `a shift ${move.dir}`
    case 'scale':
      return 'a scale-up'
    case 'crop':
      return 'a crop'
    case 'recolor':
    case 'swap':
      return 'a colour swap'
    case 'symmetry':
      return 'a symmetry'
    default:
      return 'a twist'
  }
}

/** The call after a turn, from the engine's verdicts. */
export function turnLine(result: TurnResult): Line {
  const ko = result.ko
  const cleared = FIGHTERS.filter((f) => result.answers[f].right)
  const blocked = FIGHTERS.filter((f) => result.attacks[f] && !result.attacks[f]?.landed)
  if (ko) {
    return {
      voice: 'play',
      text: `The third attack lands! ${NAME[ko]} tops out! ${NAME[other(ko)]} wins Mirror by knockout!`,
    }
  }
  const stackNote = FIGHTERS.filter((f) => result.stacks[f].length === TOP_OUT - 1)
    .map((f) => ` ${NAME[f]} has ${TOP_OUT - 1} stacked. One more and it is over!`)
    .join('')
  const sends = (f: Fighter) => {
    const attack = result.attacks[f]
    if (!attack) return ''
    return attack.landed
      ? ` ${NAME[f]} sends ${spokenMove(attack.move)}.`
      : ` ${NAME[f]}'s ${spokenMove(attack.move)} is blocked: it would leave more than one answer.`
  }
  if (cleared.length === 2) {
    return {
      voice: blocked.length ? 'color' : 'play',
      text: `Both clear the board!${sends('claude')}${sends('gpt')}${stackNote}`,
    }
  }
  if (cleared.length === 1) {
    const winner = cleared[0] as Fighter
    const loser = other(winner)
    const forgot =
      result.puzzles[loser].program.length > 1 &&
      result.answers[loser].hypothesis.length < result.puzzles[loser].program.length
        ? ` ${NAME[loser]} left out the attack stacked on its board.`
        : ''
    return {
      voice: forgot ? 'color' : 'play',
      text: `${NAME[winner]} clears, ${NAME[loser]} misses!${forgot}${sends(winner)}${stackNote}`,
    }
  }
  return { voice: 'color', text: `Both miss. Nobody attacks, and the stacks stay.${stackNote}` }
}

export function introLine(record: Pick<MirrorRecord, 'models' | 'limits'>): Line {
  return {
    voice: 'play',
    text: `Welcome to Mirror! ${record.models.claude.name} against ${record.models.gpt.name}, live. Same puzzle, two boards, ${record.limits.turns} turns. Solve it and you send an attack. Three stacked on you and you are out.`,
  }
}

export function outroLine(result: MirrorRecord['result']): Line {
  const last = result.turns.at(-1)
  const clears = last?.clears ?? { claude: 0, gpt: 0 }
  const landed = FIGHTERS.map((f) => result.turns.filter((t) => t.attacks[f]?.landed).length)
  const score = `Clears ${NAME.claude} ${clears.claude}, ${NAME.gpt} ${clears.gpt}. Attacks landed ${NAME.claude} ${landed[0]}, ${NAME.gpt} ${landed[1]}.`
  return {
    voice: 'color',
    text: result.winner
      ? `${NAME[result.winner]} takes Mirror. ${score}`
      : `Mirror ends level. ${score}`,
  }
}

export const lineId = {
  intro: 'mirror-intro',
  turn: (t: number) => `mirror-t${t + 1}`,
  outro: 'mirror-outro',
}

/** A saved fight in the demo's shape, so the same broadcast plays it. */
export function recordTurns(record: MirrorRecord): {
  turns: ScriptedTurn[]
  intro: Line
  outro: Line
} {
  const side = (s: LiveSide) => ({
    hypothesis: s.hypothesis,
    ...(s.attack ? { attack: s.attack } : {}),
    think: s.ruling === 'played' ? ruleCaption(s.hypothesis) : REFEREE[s.ruling],
    ...(s.attack ? { attackThink: attackCaption(s.attack) } : {}),
  })
  const turns = record.result.turns.map((result, t): ScriptedTurn => {
    const live = record.turns[t] as Record<Fighter, LiveSide>
    return {
      claude: side(live.claude),
      gpt: side(live.gpt),
      line: turnLine(result),
    }
  })
  return {
    turns,
    intro: introLine(record),
    outro: outroLine(record.result),
  }
}
