import { describe, expect, it } from 'vitest'
import {
  type Arena,
  CONTACT_RULES,
  type Fighter,
  initialState,
  isKnockedOut,
  KNOCKDOWN_POINTS,
  leftCorner,
  type Move,
  nextBout,
  type RingState,
  resolveTurn,
  swapCorners,
  TAKEDOWN_POINTS,
  type Tile,
  territory,
  winner,
} from './arena.ts'

/** A roomy 7×3 test arena with a center at (3,1); callers drop tiles and start cells onto it. */
function arena(
  tiles: Record<string, Tile> = {},
  starts: Record<Fighter, [number, number]> = { claude: [0, 1], gpt: [6, 1] },
): Arena {
  const width = 7
  const height = 3
  const grid: Tile[] = new Array(width * height).fill(null).map(() => ({ kind: 'empty' }))
  for (const [key, tile] of Object.entries(tiles)) {
    const [x, y] = key.split(',').map(Number)
    grid[(y ?? 0) * width + (x ?? 0)] = tile
  }
  return {
    width,
    height,
    tiles: grid,
    center: { x: 3, y: 1 },
    starts: {
      claude: { x: starts.claude[0], y: starts.claude[1] },
      gpt: { x: starts.gpt[0], y: starts.gpt[1] },
    },
  }
}

const play = (state: RingState, claude: Move, gpt: Move) => resolveTurn(state, { claude, gpt })
const at = (state: RingState, f: Fighter) => [state.fighters[f].pos.x, state.fighters[f].pos.y]

describe('movement', () => {
  it('claims the cell it lands on and scores a point', () => {
    const { state } = play(initialState(arena()), 'right', 'left')
    expect(at(state, 'claude')).toEqual([1, 1])
    expect(territory(state)).toEqual({ claude: 2, gpt: 2 })
    expect(state.fighters.claude.score).toBe(2)
  })

  it('is blocked by walls and the edge', () => {
    const { state } = play(initialState(arena({ '1,1': { kind: 'wall' } })), 'right', 'up')
    expect(at(state, 'claude')).toEqual([0, 1])
    const { state: s2 } = play(initialState(arena()), 'left', 'right')
    expect(at(s2, 'gpt')).toEqual([6, 1])
  })
})

describe('special tiles', () => {
  it('a conveyor pushes one extra cell in its hidden direction and reveals it', () => {
    const start = initialState(arena({ '1,1': { kind: 'conveyor', dir: 'right' } }))
    const { state, events } = play(start, 'right', 'left')
    expect(at(state, 'claude')).toEqual([2, 1])
    expect(events.some((e) => e.type === 'reveal')).toBe(true)
    const move = events.find((e) => e.type === 'move' && e.fighter === 'claude')
    expect(move).toMatchObject({
      via: 'conveyor',
      path: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
    })
  })

  it('a teleport warps to its linked pad', () => {
    const link = 1 * 7 + 5
    const start = initialState(
      arena({ '1,1': { kind: 'teleport', link }, '5,1': { kind: 'teleport', link: 1 * 7 + 1 } }),
    )
    const { state } = play(start, 'right', 'up')
    expect(at(state, 'claude')).toEqual([5, 1])
  })

  it('a tile never throws a fighter onto the other one', () => {
    const start = initialState(
      arena({ '2,1': { kind: 'conveyor', dir: 'right' } }, { claude: [1, 1], gpt: [3, 1] }),
    )
    const { state } = play(start, 'right', 'wait')
    expect(at(state, 'claude')).toEqual([2, 1])
    expect(at(state, 'gpt')).toEqual([3, 1])
  })

  it('two tiles aimed at the same cell are a clash', () => {
    const start = initialState(
      arena(
        { '2,1': { kind: 'conveyor', dir: 'right' }, '4,1': { kind: 'conveyor', dir: 'left' } },
        { claude: [1, 1], gpt: [5, 1] },
      ),
    )
    const { state, events } = play(start, 'right', 'left')
    expect(events.some((e) => e.type === 'clash')).toBe(true)
    expect(at(state, 'claude')).toEqual([2, 1])
    expect(at(state, 'gpt')).toEqual([4, 1])
  })
})

describe('knockdowns', () => {
  it('draws simultaneous knockouts without favoring the second corner', () => {
    const start = initialState(arena({ '1,1': { kind: 'trap' }, '5,1': { kind: 'trap' } }))
    start.fighters.claude.knockdowns = 2
    start.fighters.gpt.knockdowns = 2
    const { state, events } = play(start, 'right', 'left')
    expect(winner(state)).toBeNull()
    expect(isKnockedOut(state, 'claude')).toBe(true)
    expect(isKnockedOut(state, 'gpt')).toBe(true)
    expect(events.filter((event) => event.type === 'ko')).toEqual([
      { type: 'ko', fighter: 'claude' },
      { type: 'ko', fighter: 'gpt' },
    ])
    expect(play(state, 'right', 'left').events).toEqual([])
  })
  it('entering a trap knocks you down for a turn, once', () => {
    const start = initialState(arena({ '1,1': { kind: 'trap' } }))
    const stepped = play(start, 'right', 'left')
    const claude = stepped.state.fighters.claude
    expect(claude.stunned).toBe(1)
    expect(claude.knockdowns).toBe(1)
    // A downed fighter loses the points and does not paint the trap cell.
    expect(claude.score).toBe(1 - KNOCKDOWN_POINTS)
    expect(stepped.state.owner[1 * 7 + 1]).toBe(null)
    // Next turn claude sits out whatever it picks, and the trap does not fire again.
    const held = play(stepped.state, 'right', 'left')
    expect(at(held.state, 'claude')).toEqual([1, 1])
    expect(held.events.some((e) => e.type === 'knockdown')).toBe(false)
    expect(held.state.fighters.claude.stunned).toBe(0)
  })

  it('the third knockdown is a knockout and ends the match', () => {
    const start = initialState(arena({ '1,1': { kind: 'trap' } }))
    const twice: RingState = {
      ...start,
      fighters: { ...start.fighters, claude: { ...start.fighters.claude, knockdowns: 2 } },
    }
    const { state, events } = play(twice, 'right', 'left')
    expect(state.ko).toBe('claude')
    expect(events.some((e) => e.type === 'ko' && e.fighter === 'claude')).toBe(true)
    expect(winner(state)).toBe('gpt')
    expect(play(state, 'right', 'left').events).toEqual([])
  })
})

describe('contact', () => {
  it('a shared destination is a clash: both bounce back', () => {
    const start = initialState(arena({}, { claude: [2, 1], gpt: [4, 1] }))
    const { state, events } = play(start, 'right', 'left')
    expect(events.some((e) => e.type === 'clash')).toBe(true)
    expect(at(state, 'claude')).toEqual([2, 1])
    expect(at(state, 'gpt')).toEqual([4, 1])
  })

  it('a straight swap is a clash too', () => {
    const start = initialState(arena({}, { claude: [2, 1], gpt: [3, 1] }))
    const { state, events } = play(start, 'right', 'left')
    expect(events.some((e) => e.type === 'clash')).toBe(true)
    expect(at(state, 'claude')).toEqual([2, 1])
  })

  it('stepping into a fighter who stays put shoves them and takes their cell', () => {
    const start = initialState(arena({}, { claude: [2, 1], gpt: [3, 1] }))
    const { state, events } = play(start, 'right', 'wait')
    expect(events.some((e) => e.type === 'shove' && e.by === 'claude' && !e.pinned)).toBe(true)
    expect(at(state, 'gpt')).toEqual([4, 1])
    expect(at(state, 'claude')).toEqual([3, 1])
    // gpt owned (3,1) and claude now stands on it: a steal, plus the center.
    expect(state.owner[1 * 7 + 3]).toBe('claude')
  })

  it('a shove onto a trap is a knockdown credited to the shover', () => {
    const start = initialState(arena({ '4,1': { kind: 'trap' } }, { claude: [2, 1], gpt: [3, 1] }))
    const { events } = play(start, 'right', 'wait')
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'knockdown', fighter: 'gpt', by: 'claude', count: 1 }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'score', fighter: 'claude', reason: 'knockdown' }),
    )
  })

  it('a wall behind the target pins the shove: nobody moves', () => {
    const start = initialState(arena({ '4,1': { kind: 'wall' } }, { claude: [2, 1], gpt: [3, 1] }))
    const { state, events } = play(start, 'right', 'wait')
    expect(events.some((e) => e.type === 'shove' && e.pinned)).toBe(true)
    expect(at(state, 'claude')).toEqual([2, 1])
    expect(at(state, 'gpt')).toEqual([3, 1])
  })

  it('a fighter who is down cannot be shoved', () => {
    const start = initialState(arena({}, { claude: [2, 1], gpt: [3, 1] }))
    const downed: RingState = {
      ...start,
      fighters: { ...start.fighters, gpt: { ...start.fighters.gpt, stunned: 1 } },
    }
    const { state, events } = play(downed, 'right', 'right')
    expect(events.some((e) => e.type === 'guard' && e.by === 'claude')).toBe(true)
    expect(at(state, 'gpt')).toEqual([3, 1])
    expect(at(state, 'claude')).toEqual([2, 1])
  })

  it('walking into a cell the other fighter is leaving is not contact', () => {
    const start = initialState(arena({}, { claude: [2, 1], gpt: [3, 1] }))
    const { state, events } = play(start, 'right', 'up')
    expect(events.some((e) => e.type === 'shove' || e.type === 'clash')).toBe(false)
    expect(at(state, 'claude')).toEqual([3, 1])
    expect(at(state, 'gpt')).toEqual([3, 0])
  })
})

describe('scoring and bouts', () => {
  it('holding the center is worth an extra point each turn', () => {
    const start = initialState(arena({}, { claude: [2, 1], gpt: [6, 1] }))
    const { state } = play(start, 'right', 'left')
    expect(at(state, 'claude')).toEqual([3, 1])
    // +1 claim, +1 center bonus, from a start of 1.
    expect(state.fighters.claude.score).toBe(3)
  })

  it('the bell sends both fighters to their corners and keeps everything else', () => {
    const start = initialState(arena({ '1,1': { kind: 'trap' } }))
    const { state } = play(start, 'right', 'left')
    const bell = nextBout(state)
    expect(at(bell, 'claude')).toEqual([0, 1])
    expect(at(bell, 'gpt')).toEqual([6, 1])
    expect(bell.fighters.claude.stunned).toBe(0)
    expect(bell.fighters.claude.knockdowns).toBe(1)
    expect(bell.owner).toEqual(state.owner)
    expect(bell.revealed).toEqual(state.revealed)
  })
})

describe('contact rules', () => {
  it('a shove the ropes stop slams the fighter down, and the shover takes the points', () => {
    const start = initialState(arena({}, { claude: [5, 1], gpt: [6, 1] }), CONTACT_RULES)
    const { state, events } = play(start, 'right', 'wait')
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'knockdown', fighter: 'gpt', by: 'claude', cause: 'ropes' }),
    )
    expect(at(state, 'gpt')).toEqual([6, 1])
    expect(state.fighters.gpt.stunned).toBe(1)
    expect(state.fighters.gpt.score).toBe(1 - KNOCKDOWN_POINTS)
    expect(state.fighters.claude.score).toBe(1 + KNOCKDOWN_POINTS)
  })

  it('a pillar slams too, and classic rules keep a pinned shove harmless', () => {
    const map = arena({ '6,1': { kind: 'wall' } }, { claude: [4, 1], gpt: [5, 1] })
    const contact = play(initialState(map, CONTACT_RULES), 'right', 'wait')
    expect(contact.events).toContainEqual(
      expect.objectContaining({ type: 'knockdown', cause: 'pillar' }),
    )
    const classic = play(initialState(map), 'right', 'wait')
    expect(classic.events.some((e) => e.type === 'knockdown')).toBe(false)
  })

  it('the center holder builds a bounty, and the rival who knocks it off takes it all', () => {
    let state = initialState(arena({}, { claude: [2, 1], gpt: [5, 1] }), CONTACT_RULES)
    state = play(state, 'right', 'left').state
    state = play(state, 'wait', 'wait').state
    expect(state.fighters.claude.bounty).toBe(2)
    expect(state.fighters.claude.score).toBe(4)
    const { state: after, events } = play(state, 'wait', 'left')
    expect(events).toContainEqual({ type: 'bounty', from: 'claude', to: 'gpt', points: 2 })
    expect(at(after, 'claude')).toEqual([2, 1])
    expect(after.fighters.claude.score).toBe(2)
    expect(after.fighters.claude.bounty).toBe(0)
    // The takedown, the bounty, the stolen center cell and the center point; a new run starts at one.
    expect(after.fighters.gpt.score).toBe(2 + TAKEDOWN_POINTS + 2 + 2 + 1)
    expect(after.fighters.gpt.bounty).toBe(1)
  })

  it('leaving the center, or the bell, banks the bounty', () => {
    let state = initialState(arena({}, { claude: [2, 1], gpt: [6, 1] }), CONTACT_RULES)
    state = play(state, 'right', 'wait').state
    state = play(state, 'wait', 'wait').state
    const left = play(state, 'down', 'wait').state
    expect(left.fighters.claude.bounty).toBe(0)
    expect(left.fighters.claude.score).toBe(state.fighters.claude.score + 1)
    expect(nextBout(state).fighters.claude.bounty).toBe(0)
  })

  it('a shove that moves the rival is a takedown; a slam and the older rules are not', () => {
    const map = arena({}, { claude: [2, 1], gpt: [3, 1] })
    const takedown = play(initialState(map, CONTACT_RULES), 'right', 'wait')
    expect(takedown.events).toContainEqual({
      type: 'score',
      fighter: 'claude',
      delta: TAKEDOWN_POINTS,
      reason: 'takedown',
    })
    // Claude also paints GPT's cell and stands on the center.
    expect(takedown.state.fighters.claude.score).toBe(1 + TAKEDOWN_POINTS + 2 + 1)
    const before = play(initialState(map, { centerBounty: true, ropeSlams: true }), 'right', 'wait')
    expect(before.events.some((e) => e.type === 'score' && e.reason === 'takedown')).toBe(false)
    const slam = play(
      initialState(arena({}, { claude: [5, 1], gpt: [6, 1] }), CONTACT_RULES),
      'right',
      'wait',
    )
    expect(slam.events.some((e) => e.type === 'score' && e.reason === 'takedown')).toBe(false)
  })

  it('changes corners at the bell only when the rules say so', () => {
    const map = arena()
    const contact = nextBout(play(initialState(map, CONTACT_RULES), 'right', 'left').state)
    expect(at(contact, 'claude')).toEqual([6, 1])
    expect(at(contact, 'gpt')).toEqual([0, 1])
    expect(leftCorner(contact.arena)).toBe('gpt')
    expect(leftCorner(nextBout(contact).arena)).toBe('claude')
    const classic = nextBout(play(initialState(map), 'right', 'left').state)
    expect(at(classic, 'claude')).toEqual([0, 1])
    expect(leftCorner(swapCorners(map))).toBe('gpt')
  })

  it('classic rules never build a bounty', () => {
    let state = initialState(arena({}, { claude: [2, 1], gpt: [5, 1] }))
    state = play(state, 'right', 'left').state
    state = play(state, 'wait', 'wait').state
    expect(state.fighters.claude.bounty).toBe(0)
    expect(play(state, 'wait', 'left').events.some((e) => e.type === 'bounty')).toBe(false)
  })
})
