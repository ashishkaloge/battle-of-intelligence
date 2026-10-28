import { CORNERS } from '../../arena/corners.ts'
import type { Line } from '../commentary.ts'
import type { Reply } from '../reply.ts'
import {
  type Arena,
  CLASSIC_RULES,
  FIGHTERS,
  type Fighter,
  idx,
  initialState,
  KNOCKDOWN_POINTS,
  KO_AT,
  type Move,
  nextBout,
  other,
  type Pos,
  posOf,
  type RingEvent,
  type RingRules,
  type RingState,
  resolveTurn,
  type Step,
  samePos,
  swapCorners,
  TAKEDOWN_POINTS,
  type Tile,
  tileAt,
} from './arena.ts'
import type { DemoBout, DemoSide } from './demo.ts'

/**
 * Live Ring fights: what each model is told every turn, how its reply is read, the limits both
 * corners play under, and the record a fight leaves behind. The referee in server/ring.ts drives
 * the CLIs; this file is pure, so the prompt and parsing are tested, and a saved fight replays
 * through the same engine and broadcast as the demo.
 */

export const MOVES: readonly Move[] = ['up', 'down', 'left', 'right', 'wait']

export type Limits = {
  bouts: number
  turnsPerBout: number
  /** Wall clock for one move, retries included. A late fighter holds still. */
  shotClockMs: number
  /** CLI calls one corner may make in the whole round: one per move plus a few retries. */
  callsPerCorner: number
  /** Wall clock for the whole round. When it runs out the fight ends at the current score. */
  roundMs: number
}

/** The same for both corners, always. Together they cap how long a fight runs and what it spends. */
export const LIMITS: Limits = {
  bouts: 3,
  turnsPerBout: 8,
  shotClockMs: 60_000,
  callsPerCorner: 30,
  roundMs: 30 * 60_000,
}

/**
 * The turn prompt's version, saved with each fight. 1 had no move guide; 2 adds it. Fights saved
 * before versions existed were all played on 1. Version 3 requests final actions only.
 */
export const PROMPT_VERSION = 3

/** How the referee settled a corner's move. Anything but `played` means the fighter held still. */
export type Ruling = 'played' | 'down' | 'late' | 'unusable' | 'tools' | 'error' | 'capped'

export type CornerTurn = {
  move: Move
  /** Action caption in current records; legacy model explanations are ignored on playback. */
  think: string
  say?: string
  ruling: Ruling
  /** Wall clock from the first call to the decision. */
  seconds: number
  /** CLI calls this move took; none while down. */
  calls: number
  /** Legacy field only. New fights neither request nor store reasoning. */
  reasoning?: string
  /** What went wrong, when the ruling is not `played`. */
  error?: string
}

export type RecordTurn = Record<Fighter, CornerTurn>

export type EndReason = 'ko' | 'bouts' | 'round-clock'

/** Everything a fight leaves behind. The moves alone replay it; the engine recomputes the rest. */
export type RingRecord = {
  /** Optional five-round recording session; historical fights have no session. */
  broadcast?: string
  version: 1
  id: string
  playedAt: string
  models: Record<Fighter, { name: string; id: string }>
  effort: Record<Fighter, string>
  limits: Limits
  arena: Arena
  /** Missing on fights recorded before rules were versioned, which played the classic rules. */
  rules?: RingRules
  /** The turn prompt's version (see PROMPT_VERSION); missing means 1. */
  prompt?: number
  /** Who starts the fight in the left corner; missing means Claude. Fights alternate it. */
  opener?: Fighter
  bouts: RecordTurn[][]
  end: {
    reason: EndReason
    winner: Fighter | null
    score: Record<Fighter, number>
    knockdowns: Record<Fighter, number>
  }
  calls: Record<Fighter, number>
  seconds: number
  /** Commentary written after the fight (`pnpm commentate --fight`), keyed like the demo's. */
  commentary?: Record<string, Line>
  /** New optional commentary is generated from final actions and referee events only. */
  commentaryProtocol?: 'actions-v1'
}

const NAME: Record<Fighter, string> = { claude: CORNERS.claude.name, gpt: CORNERS.gpt.name }
const BELT: Record<Step, string> = { up: '^', down: 'v', left: '<', right: '>' }
const TILE_NAME: Record<Tile['kind'], string> = {
  empty: 'floor',
  wall: 'pillar',
  conveyor: 'belt',
  teleport: 'teleport pad',
  trap: 'trap',
}

const at = (pos: Pos) => `(${pos.x},${pos.y})`

/** Clips at a word boundary so a long reply never cuts a word in half. */
function clip(text: string, max: number) {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`
}

const clean = (value: unknown, max: number) =>
  typeof value === 'string' ? clip(value.replace(/\s+/g, ' ').trim(), max) : ''

/** What happened in one turn, as short neutral clauses. Feeds the prompt history and commentary. */
export function describeTurn(events: RingEvent[], before: RingState, after: RingState): string[] {
  const out: string[] = []
  for (const e of events) {
    if (e.type === 'reveal') {
      const tile = after.arena.tiles[e.index]
      const name =
        tile?.kind === 'conveyor' ? `belt pointing ${tile.dir}` : TILE_NAME[tile?.kind ?? 'empty']
      out.push(`a hidden ${name} shows itself at ${at(posOf(after.arena, e.index))}`)
    } else if (e.type === 'shove') {
      // Under rope slams a pinned shove is a knockdown, and that clause tells it.
      if (!e.pinned) {
        const takedown = after.rules.takedowns ? ' for a takedown' : ''
        out.push(`${NAME[e.by]} shoves ${NAME[e.target]} off its cell${takedown}`)
      } else if (!after.rules.ropeSlams) {
        out.push(`${NAME[e.by]} shoves ${NAME[e.target]}, but it is pinned and nobody moves`)
      }
    } else if (e.type === 'clash') {
      out.push('both go for the same cell and bounce off each other')
    } else if (e.type === 'guard') {
      out.push(`the referee stops ${NAME[e.by]} hitting ${NAME[e.target]} while it is down`)
    } else if (e.type === 'knockdown') {
      const count = `knockdown ${e.count} of ${KO_AT}`
      if (e.cause !== 'trap') {
        const into = e.cause === 'ropes' ? 'the ropes' : 'a pillar'
        out.push(
          `${NAME[e.by ?? other(e.fighter)]} slams ${NAME[e.fighter]} into ${into}, ${count}`,
        )
      } else {
        const by = e.by ? ` by ${NAME[e.by]}` : ''
        out.push(`${NAME[e.fighter]} is knocked down on a trap${by}, ${count}`)
      }
    } else if (e.type === 'bounty') {
      out.push(`${NAME[e.to]} takes ${NAME[e.from]}'s center bounty of ${e.points}`)
    } else if (e.type === 'ko') {
      out.push(`${NAME[e.fighter]} is knocked out`)
    } else if (e.type === 'center') {
      out.push(`${NAME[e.fighter]} holds the center`)
    } else if (e.type === 'claim' && e.stolen) {
      out.push(`${NAME[e.fighter]} paints over a ${NAME[other(e.fighter)]} cell`)
    }
  }
  for (const f of FIGHTERS) {
    const moved = !samePos(before.fighters[f].pos, after.fighters[f].pos)
    const named = events.some((e) => e.type !== 'move' && 'fighter' in e && e.fighter === f)
    if (!moved && !named) out.push(`${NAME[f]} stays put`)
  }
  return out
}

const RULING_TEXT: Record<Exclude<Ruling, 'played'>, string> = {
  down: 'was down',
  late: 'ran out the shot clock',
  unusable: 'gave no usable move',
  tools: 'broke the no-tools rule',
  error: 'could not be reached',
  capped: 'hit the call cap',
}

/** One line of history for the next prompt: both moves, what happened, where everyone ended up. */
export function historyLine(
  bout: number,
  turn: number,
  sides: RecordTurn,
  before: RingState,
  after: RingState,
  events: RingEvent[],
): string {
  const moves = FIGHTERS.map((f) => {
    const side = sides[f]
    return side.ruling === 'played'
      ? `${NAME[f]} ${side.move}`
      : `${NAME[f]} ${RULING_TEXT[side.ruling]} and held`
  }).join(', ')
  const what = describeTurn(events, before, after).join('; ')
  const where = FIGHTERS.map((f) => `${NAME[f]} ${at(after.fighters[f].pos)}`).join(', ')
  return `Bout ${bout + 1} turn ${turn + 1}: ${moves}. ${what}. Now: ${where}.`
}

/** The map as each fighter sees it: only tiles someone has set off are shown. */
export function boardText(state: RingState, me: Fighter): string {
  const { arena } = state
  const them = other(me)
  const head = `     ${Array.from({ length: arena.width }, (_, x) => x).join(' ')}`
  const floor = [head]
  const paint = [head]
  for (let y = 0; y < arena.height; y++) {
    const marks: string[] = []
    const owners: string[] = []
    for (let x = 0; x < arena.width; x++) {
      const pos = { x, y }
      const i = idx(arena, pos)
      const tile = arena.tiles[i] ?? { kind: 'wall' }
      let mark = '.'
      if (tile.kind === 'wall') mark = '#'
      else if (state.revealed[i] && tile.kind === 'conveyor') mark = BELT[tile.dir]
      else if (state.revealed[i] && tile.kind === 'trap') mark = '!'
      else if (state.revealed[i] && tile.kind === 'teleport') mark = 'o'
      else if (samePos(pos, arena.center)) mark = '*'
      if (samePos(pos, state.fighters[me].pos)) mark = 'Y'
      else if (samePos(pos, state.fighters[them].pos)) mark = 'X'
      marks.push(mark)
      const owner = state.owner[i]
      owners.push(tile.kind === 'wall' ? '#' : owner === me ? '+' : owner === them ? '-' : '.')
    }
    floor.push(`y=${y}  ${marks.join(' ')}`)
    paint.push(`y=${y}  ${owners.join(' ')}`)
  }
  return `Floor:\n${floor.join('\n')}\n\nPaint (+ yours, - ${NAME[them]}'s):\n${paint.join('\n')}`
}

/** What a fighter stands on, when it has been found. */
function underfoot(state: RingState, fighter: Fighter): string {
  const pos = state.fighters[fighter].pos
  const i = idx(state.arena, pos)
  const tile = state.arena.tiles[i]
  if (state.revealed[i] && tile && tile.kind !== 'empty' && tile.kind !== 'wall') {
    return tile.kind === 'conveyor'
      ? ` (on a belt pointing ${tile.dir})`
      : ` (on a ${TILE_NAME[tile.kind]})`
  }
  return samePos(pos, state.arena.center) ? ' (on the center)' : ''
}

const STEPS: readonly Step[] = ['up', 'down', 'left', 'right']
const DELTA: Record<Step, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}
const toward = (pos: Pos, dir: Step): Pos => ({
  x: pos.x + DELTA[dir][0],
  y: pos.y + DELTA[dir][1],
})
const inside = (state: RingState, pos: Pos) =>
  pos.x >= 0 && pos.y >= 0 && pos.x < state.arena.width && pos.y < state.arena.height
const touching = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1

type Known =
  | { kind: 'ropes' }
  | { kind: 'pillar' }
  | { kind: 'trap' }
  | { kind: 'belt'; dir: Step }
  | { kind: 'pad'; to: Pos }
  /** `safe` once someone has stood there, since a hidden tile would have fired. */
  | { kind: 'floor'; safe: boolean }

/** A cell as the fighters can know it: what has been found there, never what has not. */
function knownAt(state: RingState, pos: Pos): Known {
  if (!inside(state, pos)) return { kind: 'ropes' }
  const { arena } = state
  const tile = tileAt(arena, pos)
  if (tile.kind === 'wall') return { kind: 'pillar' }
  const i = idx(arena, pos)
  if (state.revealed[i]) {
    if (tile.kind === 'trap') return { kind: 'trap' }
    if (tile.kind === 'conveyor') return { kind: 'belt', dir: tile.dir }
    if (tile.kind === 'teleport') return { kind: 'pad', to: posOf(arena, tile.link) }
  }
  return { kind: 'floor', safe: state.owner[i] !== null }
}

/** Where a fighter stepping onto `pos` ends up, as far as anyone knows. */
function landingText(state: RingState, me: Fighter, pos: Pos): string {
  const known = knownAt(state, pos)
  const them = NAME[other(me)]
  switch (known.kind) {
    case 'ropes':
      return 'the ropes: you stay put, and a fighter who stays put can be shoved'
    case 'pillar':
      return `a pillar at ${at(pos)}: you stay put, and a fighter who stays put can be shoved`
    case 'trap':
      return `${at(pos)}, a found trap: you go down`
    case 'belt': {
      const next = toward(pos, known.dir)
      const end = knownAt(state, next)
      if (end.kind === 'ropes' || end.kind === 'pillar') {
        return `${at(pos)}, a found belt pointing ${known.dir}, blocked beyond, so you stop on it`
      }
      const blocked = samePos(next, state.fighters[other(me)].pos)
        ? `, unless ${them} is still there`
        : ''
      return `${at(pos)}, a found belt pointing ${known.dir}, which carries you on to ${at(next)}${blocked}`
    }
    case 'pad':
      return `${at(pos)}, a found teleport pad, which sends you to ${at(known.to)}`
    case 'floor': {
      const owner = state.owner[idx(state.arena, pos)]
      const paint =
        owner === me ? 'your paint' : owner ? `${them}'s paint, +2 to take` : 'unpainted, +1'
      const center = samePos(pos, state.arena.center) ? ', the center' : ''
      return `${at(pos)}${center}, ${known.safe ? 'plain floor' : 'unexplored'}, ${paint}`
    }
  }
}

/**
 * What a shove in direction `dir` does to `target`, as far as anyone knows. `scorer` is who the
 * points go to, named from the reader's side ("you" or the rival's name).
 */
function shoveText(state: RingState, target: Fighter, dir: Step, scorer: string): string {
  const to = toward(state.fighters[target].pos, dir)
  const known = knownAt(state, to)
  if (known.kind === 'ropes' || known.kind === 'pillar') {
    const into = known.kind === 'ropes' ? 'the ropes' : 'a pillar'
    return state.rules.ropeSlams
      ? `slammed into ${into}: a knockdown`
      : `pinned against ${into}, and nobody moves`
  }
  const takedown = state.rules.takedowns ? `a takedown, +${TAKEDOWN_POINTS} to ${scorer}` : ''
  if (known.kind === 'trap') {
    return `shoved onto the found trap at ${at(to)}: ${takedown ? 'a takedown and ' : ''}a knockdown`
  }
  const where =
    known.kind === 'belt'
      ? `shoved onto the found belt at ${at(to)}, pointing ${known.dir}`
      : `shoved to ${at(to)}`
  return takedown ? `${where}: ${takedown}` : where
}

/**
 * Where each move takes a fighter and what is known to be there, worked out by the referee so the
 * fight turns on strategy rather than coordinate arithmetic. It only repeats what the map already
 * shows: a cell nobody has stood on or found anything on is unexplored, never safe.
 */
export function moveGuide(state: RingState, me: Fighter): string[] {
  const them = other(me)
  const Them = NAME[them]
  const mine = state.fighters[me]
  const theirs = state.fighters[them]
  const bounty = state.rules.centerBounty
  const onCenter = samePos(mine.pos, state.arena.center)
  const banks =
    bounty && onCenter && mine.bounty > 0
      ? ` You leave the center and bank your bounty of ${mine.bounty}.`
      : ''
  const moves = STEPS.map((dir) => {
    const to = toward(mine.pos, dir)
    if (samePos(to, theirs.pos)) {
      if (theirs.stunned > 0) return `- ${dir}: into ${Them}, who is down: the referee stops you.`
      const prize = samePos(theirs.pos, state.arena.center)
        ? `, and you take the center${bounty && theirs.bounty > 0 ? ` and ${Them}'s bounty of ${theirs.bounty}` : ''}`
        : ', and you take its cell'
      return `- ${dir}: into ${Them}. If ${Them} stays put, it is ${shoveText(state, them, dir, 'you')}${prize}. If ${Them} steps toward you, you collide.${banks}`
    }
    const known = knownAt(state, to)
    const stays = known.kind === 'ropes' || known.kind === 'pillar'
    const clash =
      theirs.stunned === 0 && !stays && touching(to, theirs.pos)
        ? ` ${Them} can step there too; if it does, you collide.`
        : ''
    return `- ${dir}: to ${landingText(state, me, to)}.${clash}${stays ? '' : banks}`
  })
  let wait = `- wait: stay at ${at(mine.pos)}${onCenter ? ', +1 for the center' : ''}.`
  if (theirs.stunned > 0) {
    wait += ` ${Them} is down, so it cannot shove you this turn.`
  } else if (touching(mine.pos, theirs.pos)) {
    const dir = STEPS.find((d) => samePos(toward(theirs.pos, d), mine.pos))
    if (dir) {
      const loses =
        bounty && onCenter && mine.bounty > 0 ? `, and you lose your bounty of ${mine.bounty}` : ''
      wait += ` If ${Them} steps into you, you are ${shoveText(state, me, dir, Them)}${loses}.`
    }
  } else {
    wait += ` ${Them} is not next to you, so it cannot shove you this turn.`
  }
  return [...moves, wait]
}

/**
 * The prompt for one move. Both corners get the same words apart from their own point of view.
 * The rules a fighter can know are spelled out; where the floor's tiles are is not, until found.
 */
export function turnPrompt(input: {
  state: RingState
  me: Fighter
  bout: number
  turn: number
  limits: Limits
  history: readonly string[]
}): string {
  const { state, me, bout, turn, limits, history } = input
  const { arena } = state
  const { centerBounty, ropeSlams, takedowns } = state.rules
  const them = other(me)
  const Me = NAME[me]
  const Them = NAME[them]
  const mine = state.fighters[me]
  const theirs = state.fighters[them]
  const status = [
    `You are at ${at(mine.pos)}${underfoot(state, me)}. ${Them} is at ${at(theirs.pos)}${underfoot(state, them)}. The center is ${at(arena.center)}.`,
    `Score: you ${mine.score}, ${Them} ${theirs.score}. Knockdowns: you ${mine.knockdowns} of ${KO_AT}, ${Them} ${theirs.knockdowns} of ${KO_AT}.`,
  ]
  if (centerBounty) {
    status.push(`Bounty on the center: yours ${mine.bounty}, ${Them}'s ${theirs.bounty}.`)
  }
  if (theirs.stunned > 0) status.push(`${Them} is down this turn: it cannot move or be shoved.`)
  return [
    `You are ${Me}, fighting ${Them} in The Ring, the first round of Battle of Intelligence. Play to win.`,
    '',
    'How it works',
    `- The ring is a ${arena.width} by ${arena.height} grid. x runs 0 to ${arena.width - 1} from left to right; y runs 0 to ${arena.height - 1} from top to bottom, so "up" lowers y.`,
    `- Every turn you and ${Them} each pick one move in secret: up, down, left, right or wait. Both moves happen at the same time.`,
    '- Pillars (#) and the edge of the ring block you.',
    `- Step into ${Them} while it stays put and you shove it one cell that way and take its cell.${takedowns ? ` That is a takedown: +${TAKEDOWN_POINTS} to you, on top of anything else it earns.` : ''} ${ropeSlams ? `If the edge of the ring or a pillar blocks the push, ${Them} is slammed into it and knocked down.` : 'If something blocks the push, nobody moves.'} ${Them} can do the same to you.`,
    '- If you both step into the same cell, or try to swap cells, you collide and both stay where you were.',
    '- The floor hides tiles with their own rules, and nobody is told where they are. A tile appears on the map once someone sets it off. Some carry you further. Some knock you down.',
    `- A knockdown costs ${KNOCKDOWN_POINTS} points and you miss your next move. If ${Them} caused it, ${Them} gets those points. A fighter who is down cannot be shoved. ${KO_AT} knockdowns is a knockout and loses the match.`,
    `- Points: end your move on a cell to paint it, +1 for an unpainted cell, +2 for one ${Them} painted. Every turn you stand on the center (*) earns +1. A fighter who is down paints nothing.`,
    ...(centerBounty
      ? [
          `- The center is a bounty. Every turn you hold it adds 1 to your bounty as well as your score. If ${Them} knocks you off the center or down, ${Them} takes your whole bounty out of your score. Step off yourself, or reach the bell, and your bounty is safe. ${Them}'s bounty works the same way.`,
        ]
      : []),
    `- ${limits.bouts} bouts of up to ${limits.turnsPerBout} turns. ${state.rules.changeCorners ? 'At every bell the fighters change corners' : 'Between bouts both fighters go back to their corners'}; points, paint, knockdowns and found tiles carry over. If nobody is knocked out, most points wins.`,
    '',
    `Map key: Y you, X ${Them}, # pillar, * center, . floor with nothing found. Found tiles: > < ^ v a belt that carries you one more cell that way, ! a trap, o a teleport pad.`,
    '',
    `Bout ${bout + 1} of ${limits.bouts}, turn ${turn + 1} of ${limits.turnsPerBout}.`,
    '',
    boardText(state, me),
    '',
    ...status,
    '',
    'Your moves, worked out from what is known (an unexplored cell can still hide something):',
    ...moveGuide(state, me),
    '',
    'What has happened so far, most recent last:',
    ...(history.length > 0 ? history : ['Nothing yet. This is the opening move.']),
    '',
    'Reply with only this JSON object and nothing else:',
    `{"move":"up|down|left|right|wait","say":"a short taunt to ${Them}, at most 6 words, or an empty string"}`,
    'Do not use any tools or run commands. Decide from what is written above.',
  ].join('\n')
}

export type MoveReply = { move: Move; think: string; say: string }

/** Broadcast text describes only the submitted action. */
const moveCaption = (move: Move) => (move === 'wait' ? 'Holds position.' : `Moves ${move}.`)

/** Reads a model's reply. Lenient about prose around the JSON, strict about the move itself. */
export function parseMoveReply(text: string): Reply<MoveReply> {
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
  const move = typeof data.move === 'string' ? data.move.trim().toLowerCase() : ''
  const known = MOVES.find((m) => m === move)
  if (!known) return { ok: false, error: `"move" must be one of ${MOVES.join(', ')}` }
  return {
    ok: true,
    value: { move: known, think: moveCaption(known), say: clean(data.say, 40) },
  }
}

export type PlayedTurn = {
  before: RingState
  after: RingState
  events: RingEvent[]
  sides: RecordTurn
}

/** The floor as the first bell finds it, with the opener in the left corner. */
export const openingArena = (record: Pick<RingRecord, 'arena' | 'opener'>): Arena =>
  record.opener === 'gpt' ? swapCorners(record.arena) : record.arena

/** Replays a saved fight through the engine, bout by bout. */
export function replayRecord(record: RingRecord): PlayedTurn[][] {
  let state = initialState(openingArena(record), record.rules ?? CLASSIC_RULES)
  return record.bouts.map((turns, b) => {
    if (b > 0) state = nextBout(state)
    return turns.map((sides) => {
      const before = state
      const result = resolveTurn(state, { claude: sides.claude.move, gpt: sides.gpt.move })
      state = result.state
      return { before, after: result.state, events: result.events, sides }
    })
  })
}

/** How much a turn is worth replaying: knockouts, then knockdowns, shoves and collisions. */
function weight(turn: PlayedTurn): number {
  let score = 0
  for (const e of turn.events) {
    if (e.type === 'ko') score = Math.max(score, 100)
    else if (e.type === 'bounty') score = Math.max(score, Math.min(95, 50 + 5 * e.points))
    else if (e.type === 'knockdown') score = Math.max(score, e.by ? 60 : 40)
    else if (e.type === 'shove') score = Math.max(score, e.pinned ? 8 : 30)
    else if (e.type === 'clash') score = Math.max(score, 20)
    else if (e.type === 'claim' && e.stolen) score = Math.max(score, 10)
    else if (e.type === 'reveal') score = Math.max(score, 5)
  }
  return score
}

/** The bout's replay: its biggest moment, the later one on a tie. */
export function highlightOf(turns: readonly PlayedTurn[]): number {
  let best = Math.max(0, turns.length - 1)
  let top = 0
  turns.forEach((turn, i) => {
    const w = weight(turn)
    if (w > 0 && w >= top) {
      top = w
      best = i
    }
  })
  return best
}

/** Repeated decisions that collide in exactly the same positions are one stalled exchange. */
function sameClash(a: PlayedTurn | undefined, b: PlayedTurn): boolean {
  const first = a?.events.find((event) => event.type === 'clash')
  const second = b.events.find((event) => event.type === 'clash')
  return Boolean(
    a &&
      first &&
      second &&
      samePos(first.at, second.at) &&
      FIGHTERS.every(
        (fighter) =>
          a.sides[fighter].move === b.sides[fighter].move &&
          samePos(a.before.fighters[fighter].pos, b.before.fighters[fighter].pos) &&
          samePos(a.after.fighters[fighter].pos, b.after.fighters[fighter].pos),
      ),
  )
}

/** Do not replay an empty turn or a low-value collision the bout already showed repeatedly. */
function redundantHighlight(turns: readonly PlayedTurn[], highlight: number): boolean {
  const turn = turns[highlight]
  if (!turn || weight(turn) === 0) return true
  if (weight(turn) !== 20) return false
  return turns.some((previous, index) => index !== highlight && sameClash(previous, turn))
}

const centerHolder = (state: RingState): Fighter | null =>
  FIGHTERS.find((f) => samePos(state.fighters[f].pos, state.arena.center)) ?? null

/** The one thing worth calling in a turn, if anything is. Quiet turns stay quiet. */
function callTurn(turn: PlayedTurn): Line | undefined {
  const { events, before, after, sides } = turn
  const find = <T extends RingEvent['type']>(type: T) =>
    events.find((e): e is Extract<RingEvent, { type: T }> => e.type === type)
  const ko = find('ko')
  if (ko) {
    if (events.filter((event) => event.type === 'ko').length === 2) {
      return {
        voice: 'play',
        text: 'Both go down for the third time! A double knockout. The Ring ends in a draw!',
      }
    }
    return {
      voice: 'play',
      text: `${NAME[ko.fighter]} goes down for the third time. Knockout! ${NAME[other(ko.fighter)]} wins the Ring!`,
    }
  }
  const bounty = find('bounty')
  if (bounty) {
    return {
      voice: 'play',
      text: `${NAME[bounty.to]} takes ${NAME[bounty.from]}'s bounty! ${bounty.points} points change hands!`,
    }
  }
  const down = find('knockdown')
  if (down && down.cause !== 'trap') {
    const into = down.cause === 'ropes' ? 'the ropes' : 'a pillar'
    return {
      voice: 'play',
      text: `${NAME[down.by ?? other(down.fighter)]} slams ${NAME[down.fighter]} into ${into}! ${NAME[down.fighter]} is down!`,
    }
  }
  if (down?.by) {
    return {
      voice: 'play',
      text: `${NAME[down.by]} drives ${NAME[down.fighter]} onto a trap! ${NAME[down.fighter]} is down!`,
    }
  }
  if (down) {
    const known = before.revealed[idx(before.arena, down.at)]
    return {
      voice: 'play',
      text: known
        ? `${NAME[down.fighter]} walks onto a trap it already knew about! Knockdown ${down.count}.`
        : `${NAME[down.fighter]} steps on a hidden trap and goes down! Knockdown ${down.count}.`,
    }
  }
  const shove = find('shove')
  if (shove && !shove.pinned) {
    return {
      voice: 'play',
      text: `${after.rules.takedowns ? 'Takedown! ' : ''}${NAME[shove.by]} shoves ${NAME[shove.target]} clean off its cell!`,
    }
  }
  if (find('clash')) {
    return { voice: 'play', text: 'They collide and bounce back.' }
  }
  if (shove) {
    return {
      voice: 'color',
      text: `${NAME[shove.target]} has its back to the ropes, so the shove goes nowhere.`,
    }
  }
  for (const f of FIGHTERS) {
    const ruling = sides[f].ruling
    if (ruling === 'late')
      return { voice: 'color', text: `${NAME[f]} ran out the shot clock, so it stands still.` }
    if (ruling === 'unusable' || ruling === 'error' || ruling === 'tools') {
      return {
        voice: 'color',
        text: `${NAME[f]} gave the referee nothing it could use, so it stands still.`,
      }
    }
  }
  const belt = events.find(
    (e) => e.type === 'reveal' && after.arena.tiles[e.index]?.kind === 'conveyor',
  )
  if (belt) return { voice: 'color', text: 'A hidden belt! The floor itself just moved a fighter.' }
  const holder = centerHolder(after)
  if (holder && holder !== centerHolder(before) && !after.fighters[holder].stunned) {
    return { voice: 'play', text: `${NAME[holder]} takes the center.` }
  }
  return undefined
}

function bellCall(state: RingState, bout: number, bouts: number, record: RingRecord): Line {
  if (bout === 0) {
    return {
      voice: 'play',
      text: `Welcome to the Ring! ${record.models.claude.name} against ${record.models.gpt.name}, and the rules are hidden in the floor.`,
    }
  }
  const { claude, gpt } = state.fighters
  const lead =
    claude.score === gpt.score
      ? `All square at ${claude.score}.`
      : `${claude.score > gpt.score ? NAME.claude : NAME.gpt} leads ${Math.max(claude.score, gpt.score)} to ${Math.min(claude.score, gpt.score)}.`
  const edge = FIGHTERS.find((f) => state.fighters[f].knockdowns === KO_AT - 1)
  const warn = edge ? ` ${NAME[edge]} is one knockdown from the end.` : ''
  const name = bout === bouts - 1 ? 'Final bout!' : `Bout ${bout + 1}!`
  const swap = state.rules.changeCorners ? ' They change corners.' : ''
  return { voice: 'play', text: `${name}${swap} ${lead}${warn}` }
}

/** A replay call based on the engine's events, never model explanations. */
function replayCall(turn: PlayedTurn | undefined): Line {
  if (!turn) return { voice: 'color', text: 'Nothing separated them in that bout.' }
  const action = callTurn(turn)
  return {
    voice: 'color',
    text: action ? `Watch it again. ${action.text}` : 'Watch that one again.',
  }
}

/** Commentary from the engine's events alone, for fights nobody has written commentary for. */
export function templateCommentary(
  record: RingRecord,
  played: PlayedTurn[][] = replayRecord(record),
): Record<string, Line> {
  const lines: Record<string, Line> = {}
  played.forEach((turns, b) => {
    const start =
      turns[0]?.before ?? initialState(openingArena(record), record.rules ?? CLASSIC_RULES)
    lines[`b${b + 1}-bell`] = bellCall(start, b, played.length, record)
    let previous: string | undefined
    let repeated = 0
    turns.forEach((turn, t) => {
      const line = callTurn(turn)
      repeated = line && line.text === previous ? repeated + 1 : 0
      previous = line?.text
      if (line && repeated === 0) lines[`b${b + 1}-t${t + 1}`] = line
      else if (repeated === 1 && sameClash(turns[t - 1], turn))
        lines[`b${b + 1}-t${t + 1}`] = {
          voice: 'color',
          text: 'Same moves, same collision.',
        }
    })
    lines[`b${b + 1}-replay`] = replayCall(turns[highlightOf(turns)])
  })
  return lines
}

const DOWN = 'Down. Waiting out the count.'

/** Shown in place of a thought when the referee, not the model, decided the move. */
const REFEREE: Record<Exclude<Ruling, 'played' | 'down'>, { flag: string; note: string }> = {
  late: { flag: 'Shot clock', note: 'No reply inside the shot clock. The referee holds it still.' },
  unusable: { flag: 'No move', note: 'Its reply had no usable move. The referee holds it still.' },
  tools: {
    flag: 'Used tools',
    note: 'It reached for a tool, which is against the rules. It holds.',
  },
  error: { flag: 'No reply', note: 'Its CLI could not answer. The referee holds it still.' },
  capped: { flag: 'Call cap', note: 'Out of calls for this round. The referee holds it still.' },
}

function sideOf(turn: CornerTurn): DemoSide {
  if (turn.ruling === 'played')
    return {
      move: turn.move,
      think: moveCaption(turn.move),
      ...(turn.say ? { say: turn.say } : {}),
    }
  if (turn.ruling === 'down') return { move: 'wait', think: DOWN }
  const { flag, note } = REFEREE[turn.ruling]
  return { move: turn.move, think: note, flag }
}

/**
 * A saved fight in the demo's shape. Broadcast captions and commentary are derived from
 * recorded actions and engine events; legacy explanations are never read.
 */
export function recordBouts(record: RingRecord): DemoBout[] {
  const played = replayRecord(record)
  const template = templateCommentary(record, played)
  const written = record.commentaryProtocol === 'actions-v1' ? record.commentary : undefined
  const pick = (id: string): Line =>
    written?.[id] ?? template[id] ?? { voice: 'color', text: 'And the bell.' }
  return played.map((turns, b) => {
    const highlight = highlightOf(turns)
    return {
      bell: pick(`b${b + 1}-bell`),
      highlight,
      replay: pick(`b${b + 1}-replay`),
      skipReplay: redundantHighlight(turns, highlight),
      turns: turns.map((turn, t) => {
        const id = `b${b + 1}-t${t + 1}`
        const line = written ? written[id] : template[id]
        return {
          claude: sideOf(turn.sides.claude),
          gpt: sideOf(turn.sides.gpt),
          ...(line ? { line } : {}),
        }
      }),
    }
  })
}
