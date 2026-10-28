import { describe, expect, it } from 'vitest'
import { CONTACT_RULES, initialState, nextBout, type RingState, resolveTurn } from './arena.ts'
import { choreograph, slowed, TIMING } from './choreo.ts'
import { DEMO, makeDemoArena } from './demo.ts'
import { makeCrossroads } from './floors.ts'

/** Plays the demo through the engine and returns the state before each turn plus its events. */
function demoTurns() {
  let state: RingState = initialState(makeDemoArena())
  const turns: { before: RingState; events: ReturnType<typeof resolveTurn>['events'] }[] = []
  DEMO.forEach((bout, b) => {
    if (b > 0) state = nextBout(state)
    for (const turn of bout.turns) {
      const before = state
      const result = resolveTurn(state, { claude: turn.claude.move, gpt: turn.gpt.move })
      turns.push({ before, events: result.events })
      state = result.state
    }
  })
  return { turns, end: state }
}

describe('choreography', () => {
  const { turns, end } = demoTurns()

  it('every fighter ends each turn where the engine put it', () => {
    for (const { events, before } of turns) {
      const choreo = choreograph(before, events)
      for (const event of events) {
        if (event.type !== 'move') continue
        const last = choreo.frames[event.fighter].at(-1)
        expect(last).toMatchObject({ x: event.to.x + 0.5, y: event.to.y + 0.5, opacity: 1 })
      }
    }
  })

  it('frames and cues run forward in time and fit the duration', () => {
    for (const { events, before } of turns) {
      const choreo = choreograph(before, events)
      for (const list of [choreo.frames.claude, choreo.frames.gpt, choreo.cues]) {
        for (let i = 1; i < list.length; i++) {
          expect(list[i]?.at).toBeGreaterThanOrEqual(list[i - 1]?.at ?? 0)
        }
        expect(list.at(-1)?.at ?? 0).toBeLessThanOrEqual(choreo.duration)
      }
    }
  })

  it('a shove freezes on impact before the knockback', () => {
    const shoveTurn = turns.find(({ events }) => events.some((e) => e.type === 'shove'))
    if (!shoveTurn) throw new Error('the demo has a shove')
    const choreo = choreograph(shoveTurn.before, shoveTurn.events)
    const target = shoveTurn.events.find((e) => e.type === 'shove')?.target ?? 'gpt'
    const frames = choreo.frames[target]
    // The target holds still until the hit-stop ends, then flies.
    const held = frames.filter((f) => f.at <= TIMING.lunge + TIMING.hitStop)
    expect(new Set(held.map((f) => `${f.x},${f.y}`)).size).toBe(1)
    expect(choreo.cues.some((c) => c.type === 'shake')).toBe(true)
  })

  it('the demo ends in a knockout with its own banner', () => {
    expect(end.ko).toBe('claude')
    const last = turns.at(-1)
    if (!last) throw new Error('no turns')
    const choreo = choreograph(last.before, last.events)
    expect(choreo.cues).toContainEqual(expect.objectContaining({ type: 'banner', text: 'K.O.' }))
  })

  it('announces both knockouts together and marks both fighters out', () => {
    const before = initialState(makeDemoArena())
    const { cues } = choreograph(before, [
      { type: 'ko', fighter: 'claude' },
      { type: 'ko', fighter: 'gpt' },
    ])
    expect(cues.filter((cue) => cue.type === 'banner')).toEqual([
      { at: 760, type: 'banner', text: 'DOUBLE K.O.' },
    ])
    expect(cues.filter((cue) => cue.type === 'mood')).toEqual([
      { at: 760, type: 'mood', fighter: 'claude', mood: 'ko' },
      { at: 760, type: 'mood', fighter: 'gpt', mood: 'ko' },
    ])
  })

  it('slow motion stretches every moment by the same factor', () => {
    const first = turns[2]
    if (!first) throw new Error('no turns')
    const normal = choreograph(first.before, first.events)
    const slow = slowed(normal, 3)
    expect(slow.duration).toBe(normal.duration * 3)
    expect(slow.cues.map((c) => c.at)).toEqual(normal.cues.map((c) => c.at * 3))
  })
})

describe('a takedown', () => {
  it('pops for the shover the moment the shove lands', () => {
    const start = initialState(makeCrossroads(), CONTACT_RULES)
    const before: RingState = {
      ...start,
      fighters: {
        claude: { ...start.fighters.claude, pos: { x: 3, y: 2 } },
        gpt: { ...start.fighters.gpt, pos: { x: 4, y: 2 } },
      },
    }
    const { events } = resolveTurn(before, { claude: 'right', gpt: 'wait' })
    const pop = choreograph(before, events).cues.find(
      (cue) => cue.type === 'pop' && cue.text.includes('TAKEDOWN'),
    )
    expect(pop).toMatchObject({ fighter: 'claude', text: '+2 TAKEDOWN', tone: 'gain' })
    expect(pop?.at).toBe(TIMING.lunge + TIMING.hitStop)
  })
})
