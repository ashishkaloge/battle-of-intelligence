/**
 * The Ring: two fighters on one shared grid whose tiles hide their rules. Each turn both pick a
 * direction and the moves resolve together. They shove each other, discover conveyors and
 * teleports, and get knocked down on traps; three knockdowns is a knockout. This is the engine; it
 * is pure and deterministic, so a scripted demo and a real model-driven match run through the exact
 * same code.
 */

export type Fighter = 'claude' | 'gpt'
export type Step = 'up' | 'down' | 'left' | 'right'
export type Move = Step | 'wait'

export type Tile =
  | { kind: 'empty' }
  | { kind: 'wall' }
  | { kind: 'conveyor'; dir: Step }
  | { kind: 'teleport'; link: number }
  | { kind: 'trap' }

export type Pos = { x: number; y: number }

export type Arena = {
  /** The floor's name, for live fights that pick one. */
  name?: string
  width: number
  height: number
  tiles: Tile[]
  center: Pos
  starts: Record<Fighter, Pos>
}

/**
 * `stunned` counts the turns a knocked-down fighter still has to sit out. `bounty` is the center
 * points banked in the current unbroken hold, at stake under the center bounty rule.
 */
export type FighterState = {
  pos: Pos
  score: number
  stunned: number
  knockdowns: number
  bounty: number
}

/**
 * Rules a ring can add on top of the core ones. A fight's record keeps the rules it was played
 * under, so every saved fight replays exactly as it happened.
 */
export type RingRules = {
  /**
   * Center points banked in one unbroken hold are a bounty. Knock the holder off the center, or
   * down, and you take the whole bounty. Leaving the center any other way, or the bell, banks it.
   */
  centerBounty: boolean
  /** A shove stopped by the ropes or a pillar slams the fighter into them: a knockdown. */
  ropeSlams: boolean
  /**
   * A shove that moves the rival off its cell is a takedown, worth TAKEDOWN_POINTS to the shover on
   * top of anything else it earns. Missing on fights recorded before it existed.
   */
  takedowns?: boolean
  /** The fighters change corners at every bell, as players change ends. Missing on older fights. */
  changeCorners?: boolean
}

/** What a takedown is worth, as in wrestling. */
export const TAKEDOWN_POINTS = 2

/** The rules the demo was written for. */
export const CLASSIC_RULES: RingRules = { centerBounty: false, ropeSlams: false }
/** Live fights: a camped center becomes a prize, the ropes hurt, and contact pays. */
export const CONTACT_RULES: RingRules = {
  centerBounty: true,
  ropeSlams: true,
  takedowns: true,
  changeCorners: true,
}

export type RingState = {
  arena: Arena
  rules: RingRules
  /** Who has painted each cell, by tile index. */
  owner: (Fighter | null)[]
  /** Hidden tiles become visible once triggered. */
  revealed: boolean[]
  fighters: Record<Fighter, FighterState>
  turn: number
  /** The first fighter knocked out. Ends the match; both may go out on the same turn. */
  ko: Fighter | null
}

/** Knockdowns that end the match. */
export const KO_AT = 3
/** Points lost for being knocked down, and won by the fighter who shoved you there. */
export const KNOCKDOWN_POINTS = 2

/** How a fighter reached its cell this turn. Drives the move animation. */
export type Via = 'walk' | 'conveyor' | 'teleport' | 'shoved' | 'blocked' | 'still'

export type ScoreReason =
  | 'claim'
  | 'steal'
  | 'center'
  | 'trap'
  | 'slam'
  | 'knockdown'
  | 'bounty'
  | 'takedown'

/** What put a fighter down: a trap, or a shove into the ropes or a pillar. */
export type DownCause = 'trap' | 'ropes' | 'pillar'

export type RingEvent =
  /** `path` lists every cell entered after `from`, in order, ending at `to`. */
  | { type: 'move'; fighter: Fighter; from: Pos; to: Pos; path: Pos[]; via: Via }
  | { type: 'reveal'; index: number }
  /** Both went for the same cell, or tried to swap. Both bounce back. */
  | { type: 'clash'; at: Pos }
  /** `pinned` when a wall or the edge stopped the push: neither fighter moves. */
  | { type: 'shove'; by: Fighter; target: Fighter; from: Pos; to: Pos; pinned: boolean }
  /** Tried to hit a fighter who is down. The referee steps in and nothing happens. */
  | { type: 'guard'; by: Fighter; target: Fighter }
  | {
      type: 'knockdown'
      fighter: Fighter
      at: Pos
      by: Fighter | null
      count: number
      cause: DownCause
    }
  /** The center holder was knocked off or down by its rival, who takes the holder's bounty. */
  | { type: 'bounty'; from: Fighter; to: Fighter; points: number }
  | { type: 'ko'; fighter: Fighter }
  | { type: 'claim'; fighter: Fighter; index: number; stolen: boolean }
  | { type: 'center'; fighter: Fighter }
  | { type: 'score'; fighter: Fighter; delta: number; reason: ScoreReason }

const DELTA: Record<Step, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

export const FIGHTERS: readonly Fighter[] = ['claude', 'gpt']
export const other = (fighter: Fighter): Fighter => (fighter === 'claude' ? 'gpt' : 'claude')

export const idx = (arena: Arena, pos: Pos) => pos.y * arena.width + pos.x
export const posOf = (arena: Arena, index: number): Pos => ({
  x: index % arena.width,
  y: Math.floor(index / arena.width),
})
export const tileAt = (arena: Arena, pos: Pos): Tile =>
  arena.tiles[idx(arena, pos)] ?? { kind: 'wall' }
export const samePos = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y

/** One step, blocked by the edge or a wall. Shoves and conveyor pushes reuse it. */
function stepOnce(arena: Arena, pos: Pos, move: Move): Pos {
  if (move === 'wait') return pos
  const [dx, dy] = DELTA[move]
  const next = { x: pos.x + dx, y: pos.y + dy }
  if (next.x < 0 || next.y < 0 || next.x >= arena.width || next.y >= arena.height) return pos
  if (tileAt(arena, next).kind === 'wall') return pos
  return next
}

export function initialState(arena: Arena, rules: RingRules = CLASSIC_RULES): RingState {
  const owner = new Array<Fighter | null>(arena.width * arena.height).fill(null)
  const fighters = {} as Record<Fighter, FighterState>
  for (const fighter of FIGHTERS) {
    const pos = arena.starts[fighter]
    owner[idx(arena, pos)] = fighter
    fighters[fighter] = { pos, score: 1, stunned: 0, knockdowns: 0, bounty: 0 }
  }
  return {
    arena,
    rules,
    owner,
    revealed: new Array<boolean>(arena.tiles.length).fill(false),
    fighters,
    turn: 0,
    ko: null,
  }
}

/** The same floor with the two starting corners exchanged. */
export const swapCorners = (arena: Arena): Arena => ({
  ...arena,
  starts: { claude: arena.starts.gpt, gpt: arena.starts.claude },
})

/** The fighter whose corner is on the left of the floor. */
export const leftCorner = (arena: Arena): Fighter =>
  arena.starts.claude.x <= arena.starts.gpt.x ? 'claude' : 'gpt'

/**
 * The bell between bouts: both fighters go back to a corner and get up, changing corners if the
 * rules say so. The painted floor, the tiles already discovered, scores and knockdowns all carry
 * over, so what a fighter learned in one bout pays off in the next. The bell banks any bounty.
 */
export function nextBout(state: RingState): RingState {
  const arena = state.rules.changeCorners ? swapCorners(state.arena) : state.arena
  const fighters = {} as Record<Fighter, FighterState>
  for (const fighter of FIGHTERS) {
    fighters[fighter] = {
      ...state.fighters[fighter],
      pos: arena.starts[fighter],
      stunned: 0,
      bounty: 0,
    }
  }
  return { ...state, arena, fighters }
}

export const isKnockedOut = (state: RingState, fighter: Fighter) =>
  state.fighters[fighter].knockdowns >= KO_AT

/** A simultaneous knockout is a draw. Otherwise a KO wins, then score breaks the tie. */
export function winner(state: RingState): Fighter | null {
  if (FIGHTERS.every((fighter) => isKnockedOut(state, fighter))) return null
  if (state.ko) return other(state.ko)
  const { claude, gpt } = state.fighters
  if (claude.score === gpt.score) return null
  return claude.score > gpt.score ? 'claude' : 'gpt'
}

/**
 * Resolves one turn for both fighters at once and returns the next state plus the events that
 * happened, in order, for the UI to animate. Order of play within a turn:
 *
 * 1. Each fighter aims one step; walls and the edge block it. A fighter who is down stays put.
 * 2. Contact. Going for the same cell, or swapping, is a clash: both bounce back. Stepping into a
 *    fighter who stays put is a shove: they are pushed one cell the same way and the shover takes
 *    their cell, and under takedowns scores for it. A fighter who is down cannot be shoved.
 * 3. Conveyors push one more cell and teleports warp to their pad. A tile cannot throw a fighter
 *    onto the other one; if both tiles aim at the same cell, that is a clash too.
 * 4. Entering a trap is a knockdown: sit out the next turn and lose points, which go to whoever
 *    shoved you there. Under rope slams, a shove the ropes or a pillar stopped is one too. The
 *    third knockdown is a knockout and ends the match.
 * 5. Under the center bounty, a holder its rival knocked off the center or down hands over its
 *    bounty.
 * 6. Fighters still standing paint their cell, and the center pays a point a turn.
 */
export function resolveTurn(
  prev: RingState,
  moves: Record<Fighter, Move>,
): { state: RingState; events: RingEvent[] } {
  if (prev.ko) return { state: prev, events: [] }
  const { arena, rules } = prev
  const events: RingEvent[] = []
  const revealed = prev.revealed.slice()
  const reveal = (index: number) => {
    if (!revealed[index]) {
      revealed[index] = true
      events.push({ type: 'reveal', index })
    }
  }
  const fighters: Record<Fighter, FighterState> = {
    claude: { ...prev.fighters.claude },
    gpt: { ...prev.fighters.gpt },
  }
  const from: Record<Fighter, Pos> = {
    claude: prev.fighters.claude.pos,
    gpt: prev.fighters.gpt.pos,
  }
  const down: Record<Fighter, boolean> = {
    claude: prev.fighters.claude.stunned > 0,
    gpt: prev.fighters.gpt.stunned > 0,
  }

  // 1. Aim.
  const aim = {} as Record<Fighter, Pos>
  for (const fighter of FIGHTERS) {
    if (down[fighter]) fighters[fighter].stunned -= 1
    aim[fighter] = down[fighter] ? from[fighter] : stepOnce(arena, from[fighter], moves[fighter])
  }
  const moving = (fighter: Fighter) => !samePos(aim[fighter], from[fighter])

  const landing: Record<Fighter, Pos> = { ...from }
  const path: Record<Fighter, Pos[]> = { claude: [], gpt: [] }
  const via = {} as Record<Fighter, Via>
  for (const fighter of FIGHTERS) {
    via[fighter] = down[fighter] || moves[fighter] === 'wait' ? 'still' : 'blocked'
  }
  const shovedBy: Partial<Record<Fighter, Fighter>> = {}
  let slammed: { target: Fighter; by: Fighter; into: DownCause } | null = null

  // 2. Contact.
  const swap =
    moving('claude') &&
    moving('gpt') &&
    samePos(aim.claude, from.gpt) &&
    samePos(aim.gpt, from.claude)
  const sameCell = moving('claude') && moving('gpt') && samePos(aim.claude, aim.gpt)
  if (swap || sameCell) {
    events.push({
      type: 'clash',
      at: sameCell
        ? aim.claude
        : { x: (from.claude.x + from.gpt.x) / 2, y: (from.claude.y + from.gpt.y) / 2 },
    })
    via.claude = 'blocked'
    via.gpt = 'blocked'
  } else {
    const contact = FIGHTERS.find(
      (f) => moving(f) && !moving(other(f)) && samePos(aim[f], from[other(f)]),
    )
    for (const fighter of FIGHTERS) {
      if (fighter === contact || fighter === (contact && other(contact))) continue
      if (moving(fighter)) {
        landing[fighter] = aim[fighter]
        path[fighter] = [aim[fighter]]
        via[fighter] = 'walk'
      }
    }
    if (contact) {
      const target = other(contact)
      const step = moves[contact]
      if (down[target]) {
        events.push({ type: 'guard', by: contact, target })
        via[contact] = 'blocked'
      } else {
        const pushed = stepOnce(arena, from[target], step)
        const pinned = samePos(pushed, from[target])
        events.push({ type: 'shove', by: contact, target, from: from[target], to: pushed, pinned })
        if (pinned) {
          via[contact] = 'blocked'
          if (rules.ropeSlams && step !== 'wait') {
            const [dx, dy] = DELTA[step]
            const beyond = { x: from[target].x + dx, y: from[target].y + dy }
            const inside =
              beyond.x >= 0 && beyond.y >= 0 && beyond.x < arena.width && beyond.y < arena.height
            slammed = { target, by: contact, into: inside ? 'pillar' : 'ropes' }
          }
        } else {
          landing[target] = pushed
          path[target] = [pushed]
          via[target] = 'shoved'
          shovedBy[target] = contact
          landing[contact] = from[target]
          path[contact] = [from[target]]
          via[contact] = 'walk'
          if (rules.takedowns) {
            fighters[contact].score += TAKEDOWN_POINTS
            events.push({
              type: 'score',
              fighter: contact,
              delta: TAKEDOWN_POINTS,
              reason: 'takedown',
            })
          }
        }
      }
    }
  }

  // 3. Tiles act on whoever entered a new cell.
  const thrown: Partial<Record<Fighter, { to: Pos; via: Via }>> = {}
  for (const fighter of FIGHTERS) {
    if (path[fighter].length === 0) continue
    const here = landing[fighter]
    const tile = tileAt(arena, here)
    if (tile.kind === 'conveyor') {
      reveal(idx(arena, here))
      const pushed = stepOnce(arena, here, tile.dir)
      if (!samePos(pushed, here)) thrown[fighter] = { to: pushed, via: 'conveyor' }
    } else if (tile.kind === 'teleport') {
      reveal(idx(arena, here))
      reveal(tile.link)
      thrown[fighter] = { to: posOf(arena, tile.link), via: 'teleport' }
    }
  }
  if (thrown.claude && thrown.gpt && samePos(thrown.claude.to, thrown.gpt.to)) {
    events.push({ type: 'clash', at: thrown.claude.to })
    delete thrown.claude
    delete thrown.gpt
  }
  // Twice, because cancelling one throw can leave the other aimed at the fighter who stayed.
  for (let pass = 0; pass < 2; pass++) {
    for (const fighter of FIGHTERS) {
      const throw_ = thrown[fighter]
      const rival = other(fighter)
      const rivalAt = thrown[rival]?.to ?? landing[rival]
      if (throw_ && samePos(throw_.to, rivalAt)) delete thrown[fighter]
    }
  }
  for (const fighter of FIGHTERS) {
    const throw_ = thrown[fighter]
    if (!throw_) continue
    landing[fighter] = throw_.to
    path[fighter].push(throw_.to)
    if (via[fighter] !== 'shoved') via[fighter] = throw_.via
  }

  for (const fighter of FIGHTERS) {
    events.push({
      type: 'move',
      fighter,
      from: from[fighter],
      to: landing[fighter],
      path: path[fighter],
      via: via[fighter],
    })
    fighters[fighter].pos = landing[fighter]
  }

  // 4. Knockdowns: slams first, since the slammed fighter never left its cell, then traps.
  const knockedDown = new Set<Fighter>()
  let ko: Fighter | null = null
  const knock = (fighter: Fighter, at: Pos, by: Fighter | null, cause: DownCause) => {
    const state = fighters[fighter]
    knockedDown.add(fighter)
    state.stunned = 1
    state.knockdowns += 1
    state.score -= KNOCKDOWN_POINTS
    events.push({ type: 'knockdown', fighter, at, by, count: state.knockdowns, cause })
    events.push({
      type: 'score',
      fighter,
      delta: -KNOCKDOWN_POINTS,
      reason: cause === 'trap' ? 'trap' : 'slam',
    })
    if (by) {
      fighters[by].score += KNOCKDOWN_POINTS
      events.push({ type: 'score', fighter: by, delta: KNOCKDOWN_POINTS, reason: 'knockdown' })
    }
    if (state.knockdowns >= KO_AT) {
      ko ??= fighter
      events.push({ type: 'ko', fighter })
    }
  }
  if (slammed) knock(slammed.target, from[slammed.target], slammed.by, slammed.into)
  for (const fighter of FIGHTERS) {
    if (path[fighter].length === 0 || tileAt(arena, landing[fighter]).kind !== 'trap') continue
    reveal(idx(arena, landing[fighter]))
    knock(fighter, landing[fighter], shovedBy[fighter] ?? null, 'trap')
  }

  // 5. The bounty changes hands when the rival knocks the holder off the center, or down.
  if (rules.centerBounty) {
    for (const fighter of FIGHTERS) {
      const points = prev.fighters[fighter].bounty
      const rival = other(fighter)
      if (points === 0 || !samePos(from[fighter], arena.center)) continue
      if (shovedBy[fighter] !== rival && slammed?.target !== fighter) continue
      fighters[fighter].score -= points
      fighters[rival].score += points
      fighters[fighter].bounty = 0
      events.push({ type: 'bounty', from: fighter, to: rival, points })
      events.push({ type: 'score', fighter, delta: -points, reason: 'bounty' })
      events.push({ type: 'score', fighter: rival, delta: points, reason: 'bounty' })
    }
  }

  // 6. Paint and the center, for fighters who are on their feet.
  const standing = (fighter: Fighter) => !down[fighter] && !knockedDown.has(fighter)
  const owner = prev.owner.slice()
  for (const fighter of FIGHTERS) {
    if (!standing(fighter)) continue
    const index = idx(arena, fighters[fighter].pos)
    if (owner[index] !== fighter) {
      const stolen = owner[index] !== null
      owner[index] = fighter
      fighters[fighter].score += stolen ? 2 : 1
      events.push({ type: 'claim', fighter, index, stolen })
      events.push({
        type: 'score',
        fighter,
        delta: stolen ? 2 : 1,
        reason: stolen ? 'steal' : 'claim',
      })
    }
  }
  for (const fighter of FIGHTERS) {
    if (standing(fighter) && samePos(fighters[fighter].pos, arena.center)) {
      fighters[fighter].score += 1
      if (rules.centerBounty) fighters[fighter].bounty += 1
      events.push({ type: 'center', fighter })
      events.push({ type: 'score', fighter, delta: 1, reason: 'center' })
    } else {
      // Off the center, or down on it: whatever was banked is safe now.
      fighters[fighter].bounty = 0
    }
  }

  return { state: { arena, rules, owner, revealed, fighters, turn: prev.turn + 1, ko }, events }
}

/** Cells each fighter owns right now, for the score line and the territory read. */
export function territory(state: RingState): Record<Fighter, number> {
  const count: Record<Fighter, number> = { claude: 0, gpt: 0 }
  for (const owner of state.owner) if (owner) count[owner] += 1
  return count
}
