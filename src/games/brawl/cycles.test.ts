import { describe, expect, it } from 'vitest'
import type { Fighter } from '../ring/arena.ts'
import {
  type Dir,
  type Intent,
  type MapSpec,
  type Match,
  type Rules,
  startMatch,
  stepMatch,
  viewFor,
  WALL,
} from './cycles.ts'

const RULES: Rules = { boosts: 0, closeEvery: null }

function map(
  claude: [number, number, Dir],
  gpt: [number, number, Dir],
  walls: [number, number][] = [],
  size: [number, number] = [9, 7],
): MapSpec {
  return {
    width: size[0],
    height: size[1],
    walls: walls.map(([x, y]) => ({ x, y })),
    starts: {
      claude: { pos: { x: claude[0], y: claude[1] }, dir: claude[2] },
      gpt: { pos: { x: gpt[0], y: gpt[1] }, dir: gpt[2] },
    },
  }
}

const go = (dir: Dir, boost = false): Intent => ({ dir, boost })
const tick = (match: Match, claude: Intent, gpt: Intent) => stepMatch(match, { claude, gpt })
const crashOf = (match: Match, fighter: Fighter) => match.riders[fighter].crash?.cause

describe('light cycles', () => {
  it('moves both cycles and leaves trail behind', () => {
    const start = startMatch(map([1, 3, 'right'], [7, 3, 'left']), RULES)
    const { match } = tick(start, go('right'), go('left'))
    expect(match.riders.claude.pos).toEqual({ x: 2, y: 3 })
    expect(viewFor(match, 'claude').grid[3]?.slice(1, 3)).toEqual([2, 2])
    expect(viewFor(match, 'gpt').grid[3]?.slice(1, 3)).toEqual([3, 3])
  })

  it('crashes into the edge, walls and trails, and the survivor wins', () => {
    const edge = tick(
      startMatch(map([0, 3, 'left'], [7, 3, 'left']), RULES),
      go('left'),
      go('left'),
    )
    expect(crashOf(edge.match, 'claude')).toBe('wall')
    expect(edge.match.result).toEqual({ winner: 'gpt' })

    const wall = tick(
      startMatch(map([1, 3, 'right'], [7, 3, 'left'], [[2, 3]]), RULES),
      go('right'),
      go('up'),
    )
    expect(crashOf(wall.match, 'claude')).toBe('wall')

    const start = startMatch(map([1, 3, 'right'], [7, 3, 'left']), RULES)
    const own = tick(tick(start, go('right'), go('up')).match, go('left'), go('up'))
    expect(crashOf(own.match, 'claude')).toBe('own-trail')
  })

  it('a head-on collision, or a swap, takes both out: a draw', () => {
    const meet = tick(
      startMatch(map([2, 3, 'right'], [4, 3, 'left']), RULES),
      go('right'),
      go('left'),
    )
    expect(crashOf(meet.match, 'claude')).toBe('head-on')
    expect(crashOf(meet.match, 'gpt')).toBe('head-on')
    expect(meet.match.result).toEqual({ winner: null })

    const swap = tick(
      startMatch(map([2, 3, 'right'], [3, 3, 'left']), RULES),
      go('right'),
      go('left'),
    )
    expect(swap.match.result).toEqual({ winner: null })
  })

  it('a boost moves two cells and spends one charge', () => {
    const start = startMatch(map([1, 3, 'right'], [7, 1, 'left']), { boosts: 2, closeEvery: null })
    const { match, events } = tick(start, go('right', true), go('left'))
    expect(match.riders.claude.pos).toEqual({ x: 3, y: 3 })
    expect(match.riders.claude.boosts).toBe(1)
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'move', fighter: 'claude', boost: true }),
    )
  })

  it('a boost cannot jump over a trail', () => {
    // gpt's first cell lands in claude's path before claude's second, boosted cell.
    const start = startMatch(map([1, 3, 'right'], [3, 2, 'down']), { boosts: 1, closeEvery: null })
    const { match } = tick(start, go('right', true), go('down'))
    expect(crashOf(match, 'claude')).toBe('their-trail')
  })

  it('the ring closes on schedule and takes anyone still on it', () => {
    const start = startMatch(map([0, 3, 'up'], [4, 3, 'up']), { boosts: 0, closeEvery: 2 })
    const first = tick(start, go('up'), go('up'))
    expect(first.match.result).toBeNull()
    const second = tick(first.match, go('up'), go('up'))
    expect(crashOf(second.match, 'claude')).toBe('ring')
    expect(second.match.cells[0]).toBe(WALL)
    expect(second.match.result).toEqual({ winner: 'gpt' })
  })

  it('a bot fault crashes the cycle where it stands', () => {
    const start = startMatch(map([1, 3, 'right'], [7, 3, 'left']), RULES)
    const { match } = stepMatch(start, { claude: { bug: 'TypeError' }, gpt: go('left') })
    expect(match.riders.claude.crash).toMatchObject({ cause: 'bug', detail: 'TypeError' })
    expect(match.result).toEqual({ winner: 'gpt' })
  })

  it('stops advertising a ring closure once the floor has reached its minimum size', () => {
    const start = startMatch(map([3, 2, 'right'], [5, 4, 'left']), {
      boosts: 0,
      closeEvery: 2,
    })
    expect(viewFor(start, 'claude').closing).toEqual({ in: 2, ring: 0 })
    const finalRing = { ...start, tick: 4, closed: 2 }
    expect(viewFor(finalRing, 'claude').closing).toBeNull()
    expect(viewFor(finalRing, 'gpt').closing).toBeNull()
  })
})
