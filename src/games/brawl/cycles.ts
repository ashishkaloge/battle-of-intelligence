import { FIGHTERS, type Fighter, other } from '../ring/arena.ts'

/**
 * Bot Brawl's arena: two light cycles on one grid. Each tick both bots pick a direction and the
 * cycles move together, leaving solid trail behind them. Hit a wall, the edge or any trail and you
 * crash; the last cycle running wins. Boosts and a closing ring arrive in later bouts. Pure and
 * deterministic, so every match can be replayed and checked.
 */

export type Dir = 'up' | 'down' | 'left' | 'right'
export type Pos = { x: number; y: number }

export const DIRS: readonly Dir[] = ['up', 'right', 'down', 'left']
export const DELTA: Record<Dir, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

/** What changes from bout to bout. */
export type Rules = {
  /** Boosts per cycle per match. A boost moves two cells in one tick. */
  boosts: number
  /** Every this many ticks the outermost open ring of the floor turns to wall. */
  closeEvery: number | null
}

export type MapSpec = {
  width: number
  height: number
  walls: Pos[]
  starts: Record<Fighter, { pos: Pos; dir: Dir }>
}

export const EMPTY = 0
export const WALL = 1
/** Trail cells carry their owner, so bots and the view can tell them apart. */
export const TRAIL: Record<Fighter, number> = { claude: 2, gpt: 3 }

export type Cause = 'wall' | 'own-trail' | 'their-trail' | 'head-on' | 'ring' | 'bug'
export type Crash = { tick: number; at: Pos; cause: Cause; detail?: string }

export type Rider = { pos: Pos; dir: Dir; boosts: number; alive: boolean; crash: Crash | null }

export type Match = {
  map: MapSpec
  rules: Rules
  cells: number[]
  riders: Record<Fighter, Rider>
  tick: number
  /** How many rings have closed. */
  closed: number
  /** Set once the match is over. `winner` is null for a draw. */
  result: { winner: Fighter | null } | null
}

export type Intent = { dir: Dir; boost: boolean } | { bug: string }

export type TickEvent =
  | { type: 'move'; fighter: Fighter; cells: Pos[]; boost: boolean }
  | { type: 'crash'; fighter: Fighter; crash: Crash }
  | { type: 'close'; ring: number }
  | { type: 'end'; winner: Fighter | null }

/** A match that runs this long without a crash is a draw. */
export const MAX_TICKS = 600

export const index = (map: MapSpec, pos: Pos) => pos.y * map.width + pos.x
const inside = (map: MapSpec, pos: Pos) =>
  pos.x >= 0 && pos.y >= 0 && pos.x < map.width && pos.y < map.height
const step = (pos: Pos, dir: Dir): Pos => ({ x: pos.x + DELTA[dir][0], y: pos.y + DELTA[dir][1] })
const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y
/** Distance from the nearest edge: the outer ring is 0. */
export const ringOf = (map: MapSpec, pos: Pos) =>
  Math.min(pos.x, pos.y, map.width - 1 - pos.x, map.height - 1 - pos.y)

const maxRings = (map: MapSpec) =>
  Math.max(0, Math.floor((Math.min(map.width, map.height) - 3) / 2))

export function startMatch(map: MapSpec, rules: Rules): Match {
  const cells = new Array<number>(map.width * map.height).fill(EMPTY)
  for (const wall of map.walls) cells[index(map, wall)] = WALL
  const riders = {} as Record<Fighter, Rider>
  for (const fighter of FIGHTERS) {
    const { pos, dir } = map.starts[fighter]
    cells[index(map, pos)] = TRAIL[fighter]
    riders[fighter] = { pos, dir, boosts: rules.boosts, alive: true, crash: null }
  }
  return { map, rules, cells, riders, tick: 0, closed: 0, result: null }
}

/**
 * Advances one tick. Moves happen in two half-steps so a boosted cycle's second cell lands after
 * everyone's first: in each half-step, every cycle still moving tries its next cell, and crashes
 * on a wall, the edge or any trail. Two cycles entering the same cell, or swapping places, is
 * head-on and both crash. A bot that errors crashes where it stands.
 */
export function stepMatch(
  prev: Match,
  intents: Record<Fighter, Intent>,
): { match: Match; events: TickEvent[] } {
  if (prev.result) return { match: prev, events: [] }
  const { map, rules } = prev
  const cells = prev.cells.slice()
  const riders: Record<Fighter, Rider> = {
    claude: { ...prev.riders.claude },
    gpt: { ...prev.riders.gpt },
  }
  const tick = prev.tick + 1
  const events: TickEvent[] = []
  const crash = (fighter: Fighter, at: Pos, cause: Cause, detail?: string) => {
    const rider = riders[fighter]
    rider.alive = false
    rider.crash = detail ? { tick, at, cause, detail } : { tick, at, cause }
    events.push({ type: 'crash', fighter, crash: rider.crash })
  }

  const steps: Record<Fighter, number> = { claude: 0, gpt: 0 }
  const moved: Record<Fighter, Pos[]> = { claude: [], gpt: [] }
  const boosted: Record<Fighter, boolean> = { claude: false, gpt: false }
  for (const fighter of FIGHTERS) {
    const rider = riders[fighter]
    if (!rider.alive) continue
    const intent = intents[fighter]
    if ('bug' in intent) {
      crash(fighter, rider.pos, 'bug', intent.bug)
      continue
    }
    rider.dir = intent.dir
    boosted[fighter] = intent.boost && rider.boosts > 0
    if (boosted[fighter]) rider.boosts -= 1
    steps[fighter] = boosted[fighter] ? 2 : 1
  }

  for (let half = 0; half < 2; half++) {
    const movers = FIGHTERS.filter((f) => riders[f].alive && steps[f] > half)
    const next = {} as Record<Fighter, Pos>
    for (const fighter of movers) next[fighter] = step(riders[fighter].pos, riders[fighter].dir)

    const [a, b] = FIGHTERS as [Fighter, Fighter]
    const headOn =
      movers.length === 2 &&
      (same(next[a], next[b]) || (same(next[a], riders[b].pos) && same(next[b], riders[a].pos)))
    if (headOn) {
      for (const fighter of movers) crash(fighter, next[fighter], 'head-on')
      continue
    }

    for (const fighter of movers) {
      const to = next[fighter]
      if (!inside(map, to)) {
        crash(fighter, riders[fighter].pos, 'wall')
        continue
      }
      const cell = cells[index(map, to)]
      if (cell === WALL) crash(fighter, to, 'wall')
      else if (cell === TRAIL[fighter]) crash(fighter, to, 'own-trail')
      else if (cell !== EMPTY) crash(fighter, to, 'their-trail')
    }
    for (const fighter of movers) {
      const rider = riders[fighter]
      if (!rider.alive) continue
      rider.pos = next[fighter]
      cells[index(map, rider.pos)] = TRAIL[fighter]
      moved[fighter].push(rider.pos)
    }
  }

  for (const fighter of FIGHTERS) {
    if (moved[fighter].length > 0) {
      events.push({ type: 'move', fighter, cells: moved[fighter], boost: boosted[fighter] })
    }
  }

  let closed = prev.closed
  // The ring stops closing before the floor gets too small to move on.
  if (rules.closeEvery && tick % rules.closeEvery === 0 && closed < maxRings(map)) {
    const ring = closed
    closed += 1
    for (let i = 0; i < cells.length; i++) {
      const pos = { x: i % map.width, y: Math.floor(i / map.width) }
      if (ringOf(map, pos) === ring) cells[i] = WALL
    }
    events.push({ type: 'close', ring })
    for (const fighter of FIGHTERS) {
      const rider = riders[fighter]
      if (rider.alive && ringOf(map, rider.pos) === ring) crash(fighter, rider.pos, 'ring')
    }
  }

  const alive = FIGHTERS.filter((f) => riders[f].alive)
  let result: Match['result'] = null
  if (alive.length < 2 || tick >= MAX_TICKS) {
    result = { winner: alive.length === 1 ? (alive[0] ?? null) : null }
    events.push({ type: 'end', winner: result.winner })
  }
  return { match: { map, rules, cells, riders, tick, closed, result }, events }
}

/** The floor as one bot sees it: its own trail is 2 and the other's is 3, whichever side it is. */
export type BotView = {
  width: number
  height: number
  tick: number
  grid: number[][]
  you: { x: number; y: number; dir: Dir; boosts: number }
  them: { x: number; y: number; dir: Dir; boosts: number; alive: boolean }
  /** When the ring closes next and which ring goes (0 is the outer edge), or null. */
  closing: { in: number; ring: number } | null
}

export function viewFor(match: Match, fighter: Fighter): BotView {
  const { map } = match
  const mine = TRAIL[fighter]
  const grid: number[][] = []
  for (let y = 0; y < map.height; y++) {
    const row: number[] = []
    for (let x = 0; x < map.width; x++) {
      const cell = match.cells[y * map.width + x] ?? WALL
      row.push(cell === EMPTY || cell === WALL ? cell : cell === mine ? 2 : 3)
    }
    grid.push(row)
  }
  const me = match.riders[fighter]
  const foe = match.riders[other(fighter)]
  const every = match.rules.closeEvery
  return {
    width: map.width,
    height: map.height,
    tick: match.tick,
    grid,
    you: { ...me.pos, dir: me.dir, boosts: me.boosts },
    them: { ...foe.pos, dir: foe.dir, boosts: foe.boosts, alive: foe.alive },
    closing:
      every && match.closed < maxRings(map)
        ? { in: every - (match.tick % every), ring: match.closed }
        : null,
  }
}
