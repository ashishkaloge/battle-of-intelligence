import { describe, expect, it } from 'vitest'
import {
  type Arena,
  CONTACT_RULES,
  type Fighter,
  initialState,
  type Move,
  type Pos,
  type RingState,
  resolveTurn,
  type Step,
  samePos,
  type Tile,
} from './arena.ts'
import { FLOORS } from './floors.ts'

const STEPS: readonly Step[] = ['up', 'down', 'left', 'right']
const TURN: Record<Step, Step> = { up: 'down', down: 'up', left: 'right', right: 'left' }

/** A state on `arena` with the fighters placed where a test needs them. */
function placed(arena: Arena, claude: Pos, gpt: Pos): RingState {
  const state = initialState(arena, CONTACT_RULES)
  return {
    ...state,
    fighters: {
      claude: { ...state.fighters.claude, pos: claude },
      gpt: { ...state.fighters.gpt, pos: gpt },
    },
  }
}

const step = (pos: Pos, dir: Step): Pos => ({
  x: pos.x + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0),
  y: pos.y + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0),
})

/** Moves both, and reports what happened to `who`. */
function play(state: RingState, moves: Record<Fighter, Move>, who: Fighter) {
  const { state: after, events } = resolveTurn(state, moves)
  const down = events.some((e) => e.type === 'knockdown' && e.fighter === who)
  return { after, events, at: after.fighters[who].pos, down }
}

describe.each(Object.entries(FLOORS))('the %s floor', (_name, make) => {
  const arena = make()

  it('is a mirror image through the center, so neither corner has the better side', () => {
    const turn = (tile: Tile): Tile =>
      tile.kind === 'conveyor' ? { kind: 'conveyor', dir: TURN[tile.dir] } : tile
    for (let y = 0; y < arena.height; y++) {
      for (let x = 0; x < arena.width; x++) {
        const here = arena.tiles[y * arena.width + x]
        const there = arena.tiles[(arena.height - 1 - y) * arena.width + (arena.width - 1 - x)]
        expect(there && turn(there), `(${x},${y})`).toEqual(here)
      }
    }
    expect(arena.starts.gpt).toEqual({
      x: arena.width - 1 - arena.starts.claude.x,
      y: arena.height - 1 - arena.starts.claude.y,
    })
  })
})

/** Ways off the center that end on another cell with the fighter still standing. */
function exits(arena: Arena) {
  const far = { x: 0, y: 0 }
  return STEPS.filter((dir) => {
    const { at, down } = play(
      placed(arena, arena.center, far),
      { claude: dir, gpt: 'wait' },
      'claude',
    )
    return !down && !samePos(at, arena.center)
  })
}

/** Cells beside the center where a challenger, walking in from further out, can stand its ground. */
function attackSpots(arena: Arena) {
  return STEPS.filter((dir) => {
    const spot = step(arena.center, dir)
    const from = step(spot, dir)
    const holder = placed(arena, from, arena.center)
    const { at, down } = play(holder, { claude: TURN[dir], gpt: 'wait' }, 'claude')
    return !down && samePos(at, spot)
  })
}

describe('Crossroads against the demo floor', () => {
  const crossroads = FLOORS.crossroads()
  const cage = FLOORS.cage()

  it('lets the center holder step off any way, where the demo floor traps it', () => {
    expect(exits(crossroads)).toEqual(['up', 'down', 'left', 'right'])
    expect(exits(cage)).toEqual([])
  })

  it('gives a challenger four cells to attack from, where the demo floor gives two', () => {
    expect(attackSpots(crossroads)).toHaveLength(4)
    expect(attackSpots(cage)).toHaveLength(2)
  })

  it('still brings a straight rush together in the middle on the third turn', () => {
    let state = initialState(crossroads, CONTACT_RULES)
    state = resolveTurn(state, { claude: 'right', gpt: 'left' }).state
    state = resolveTurn(state, { claude: 'right', gpt: 'left' }).state
    expect(state.fighters.claude.pos).toEqual({ x: 3, y: 2 })
    expect(state.fighters.gpt.pos).toEqual({ x: 5, y: 2 })
    const { events } = resolveTurn(state, { claude: 'right', gpt: 'left' })
    expect(events.some((e) => e.type === 'clash')).toBe(true)
  })

  it('puts a trap behind a challenger who comes from above', () => {
    // Claude holds the center; GPT stands above it. Claude strikes up.
    const state = placed(crossroads, crossroads.center, { x: 4, y: 1 })
    const { events } = play(state, { claude: 'up', gpt: 'wait' }, 'gpt')
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'knockdown', fighter: 'gpt', by: 'claude', cause: 'trap' }),
    )
  })

  it('makes a holder who strikes sideways give up its seat', () => {
    // GPT stands beside the center; Claude shoves it onto the belt, which cannot throw it back.
    const state = placed(crossroads, crossroads.center, { x: 3, y: 2 })
    const { after } = play(state, { claude: 'left', gpt: 'wait' }, 'gpt')
    expect(after.fighters.gpt.pos).toEqual({ x: 2, y: 2 })
    expect(after.fighters.claude.pos).toEqual({ x: 3, y: 2 })
  })
})
