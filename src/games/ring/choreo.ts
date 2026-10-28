import type { Sound } from '../audio.ts'
import {
  FIGHTERS,
  type Fighter,
  type Pos,
  type RingEvent,
  type RingState,
  type ScoreReason,
  samePos,
} from './arena.ts'

/**
 * Turns one resolved turn into a timeline the view can play: where each fighter is at each moment,
 * and the cues (sounds, shakes, flashes, pops) that land on the way. Contact gets the classic game
 * feel: a short lunge, a hit-stop freeze on impact, then the knockback. Pure, so it is tested.
 */

export type Mood = 'idle' | 'think' | 'locked' | 'scowl' | 'hit' | 'down' | 'happy' | 'ko'

/** A fighter's position in cell units, measured to the cell center. `at` is in milliseconds. */
export type Frame = { at: number; x: number; y: number; opacity: number }

export type Cue =
  | { at: number; type: 'sound'; sound: Sound }
  | { at: number; type: 'shake'; power: number }
  | { at: number; type: 'flash'; fighter: Fighter }
  | { at: number; type: 'spark'; x: number; y: number }
  | { at: number; type: 'mood'; fighter: Fighter; mood: Mood | null }
  | { at: number; type: 'pop'; fighter: Fighter; text: string; tone: 'gain' | 'loss' | 'quiet' }
  | { at: number; type: 'banner'; text: string; fighter?: Fighter }
  /** The floor catches up: paint, reveals, scores and knockdowns become visible. */
  | { at: number; type: 'floor' }

export type Choreo = { duration: number; frames: Record<Fighter, Frame[]>; cues: Cue[] }

export const TIMING = {
  walk: 230,
  belt: 210,
  teleportOut: 130,
  teleportIn: 170,
  lunge: 150,
  hitStop: 120,
  knock: 260,
  bounce: 220,
  settle: 380,
} as const

const centerOf = (pos: Pos) => ({ x: pos.x + 0.5, y: pos.y + 0.5 })
const toward = (from: Pos, to: Pos, share: number) => ({
  x: from.x + (to.x - from.x) * share,
  y: from.y + (to.y - from.y) * share,
})
const adjacent = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1

const POP_LABEL: Partial<Record<ScoreReason, string>> = {
  steal: 'STEAL',
  center: 'CENTER',
}

export function choreograph(prev: RingState, events: RingEvent[]): Choreo {
  const frames: Record<Fighter, Frame[]> = { claude: [], gpt: [] }
  const cues: Cue[] = []
  const arrival: Record<Fighter, number> = { claude: 0, gpt: 0 }

  const put = (fighter: Fighter, at: number, cell: Pos, opacity = 1) => {
    const { x, y } = centerOf(cell)
    frames[fighter].push({ at, x, y, opacity })
  }
  for (const fighter of FIGHTERS) put(fighter, 0, prev.fighters[fighter].pos)

  const moves = new Map<Fighter, Extract<RingEvent, { type: 'move' }>>()
  for (const event of events) if (event.type === 'move') moves.set(event.fighter, event)

  /** Walks a fighter through `cells` from `start`, starting at time `t`. Returns the end time. */
  const travel = (fighter: Fighter, start: Pos, cells: Pos[], t: number, firstIsKnock = false) => {
    let at = t
    let here = start
    cells.forEach((cell, i) => {
      if (!adjacent(here, cell)) {
        // A teleport: fade out on the pad, appear on the other one.
        cues.push({ at, type: 'sound', sound: 'teleport' })
        put(fighter, at + TIMING.teleportOut, here, 0)
        put(fighter, at + TIMING.teleportOut, cell, 0)
        at += TIMING.teleportOut + TIMING.teleportIn
        put(fighter, at, cell, 1)
      } else {
        const belt = i > 0
        if (belt) cues.push({ at, type: 'sound', sound: 'belt' })
        at += i === 0 && firstIsKnock ? TIMING.knock : belt ? TIMING.belt : TIMING.walk
        put(fighter, at, cell)
        if (i === 0 && !firstIsKnock) cues.push({ at, type: 'sound', sound: 'step' })
      }
      here = cell
    })
    return at
  }

  const clash = events.find((e) => e.type === 'clash')
  const shove = events.find((e) => e.type === 'shove')
  const guard = events.find((e) => e.type === 'guard')
  const handled = new Set<Fighter>()

  if (clash) {
    // Each walks whatever it walked (onto a belt, say), then both lunge into the same instant.
    const ready: Record<Fighter, number> = { claude: 0, gpt: 0 }
    const at: Record<Fighter, Pos> = {
      claude: prev.fighters.claude.pos,
      gpt: prev.fighters.gpt.pos,
    }
    for (const fighter of FIGHTERS) {
      const move = moves.get(fighter)
      if (!move) continue
      ready[fighter] = travel(fighter, at[fighter], move.path, 0)
      at[fighter] = move.to
    }
    const contact = Math.max(ready.claude, ready.gpt) + TIMING.lunge
    const hit = { x: clash.at.x + 0.5, y: clash.at.y + 0.5 }
    for (const fighter of FIGHTERS) {
      const home = centerOf(at[fighter])
      const reach = toward(home, hit, 0.42)
      frames[fighter].push({ at: contact - TIMING.lunge, ...home, opacity: 1 })
      frames[fighter].push({ at: contact, ...reach, opacity: 1 })
      frames[fighter].push({ at: contact + TIMING.hitStop, ...reach, opacity: 1 })
      frames[fighter].push({ at: contact + TIMING.hitStop + TIMING.bounce, ...home, opacity: 1 })
      arrival[fighter] = contact + TIMING.hitStop + TIMING.bounce
      cues.push({ at: contact, type: 'mood', fighter, mood: 'hit' })
      cues.push({ at: arrival[fighter] + 120, type: 'mood', fighter, mood: null })
      handled.add(fighter)
    }
    const a = frames.claude.at(-2)
    const b = frames.gpt.at(-2)
    if (a && b) cues.push({ at: contact, type: 'spark', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    cues.push({ at: contact, type: 'sound', sound: 'clash' })
    cues.push({ at: contact, type: 'shake', power: 1 })
    cues.push({ at: contact + 40, type: 'sound', sound: 'roar' })
  } else if (shove) {
    const { by, target } = shove
    const byFrom = prev.fighters[by].pos
    const targetFrom = shove.from
    const contact = TIMING.lunge
    const release = contact + TIMING.hitStop
    const touch = toward(centerOf(byFrom), centerOf(targetFrom), 0.5)

    frames[by].push({ at: contact, ...touch, opacity: 1 })
    frames[by].push({ at: release, ...touch, opacity: 1 })
    put(target, release, targetFrom)
    cues.push({ at: contact, type: 'flash', fighter: target })
    cues.push({ at: contact, type: 'mood', fighter: target, mood: 'hit' })
    cues.push({ at: contact, type: 'sound', sound: 'thud' })
    cues.push({ at: contact, type: 'shake', power: shove.pinned ? 0.6 : 1.2 })
    cues.push({ at: contact, type: 'spark', ...toward(touch, centerOf(targetFrom), 0.15) })
    // The pusher throws its weight in: a scowl on the lunge, back to business afterwards.
    cues.push({ at: contact - 60, type: 'mood', fighter: by, mood: 'scowl' })

    const takedown = events.find(
      (e) => e.type === 'score' && e.fighter === by && e.reason === 'takedown',
    )
    if (takedown?.type === 'score') {
      cues.push({
        at: release,
        type: 'pop',
        fighter: by,
        text: `+${takedown.delta} TAKEDOWN`,
        tone: 'gain',
      })
    }

    if (shove.pinned) {
      put(by, release + TIMING.bounce, byFrom)
      arrival[by] = release + TIMING.bounce
      arrival[target] = release
    } else {
      cues.push({ at: contact + 30, type: 'sound', sound: 'roar' })
      const targetMove = moves.get(target)
      arrival[target] = travel(target, targetFrom, targetMove?.path ?? [], release, true)
      put(by, release + TIMING.walk, targetFrom)
      arrival[by] = release + TIMING.walk
    }
    cues.push({ at: arrival[target] + 160, type: 'mood', fighter: target, mood: null })
    cues.push({ at: arrival[by] + 140, type: 'mood', fighter: by, mood: null })
    handled.add(by)
    handled.add(target)
  } else if (guard) {
    // The referee steps in: a half lunge that stops short.
    const byFrom = prev.fighters[guard.by].pos
    const near = toward(centerOf(byFrom), centerOf(prev.fighters[guard.target].pos), 0.25)
    frames[guard.by].push({ at: TIMING.lunge, ...near, opacity: 1 })
    put(guard.by, TIMING.lunge + TIMING.bounce, byFrom)
    arrival[guard.by] = TIMING.lunge + TIMING.bounce
    handled.add(guard.by)
  }

  for (const fighter of FIGHTERS) {
    if (handled.has(fighter)) continue
    const move = moves.get(fighter)
    if (move && move.path.length > 0) {
      arrival[fighter] = travel(fighter, prev.fighters[fighter].pos, move.path, 0)
    }
  }

  // Knockdowns land the moment the fighter does.
  const knockouts: { fighter: Fighter; at: number }[] = []
  for (const event of events) {
    if (event.type === 'knockdown') {
      const at = arrival[event.fighter]
      const isKo = events.some((e) => e.type === 'ko' && e.fighter === event.fighter)
      cues.push({ at, type: 'flash', fighter: event.fighter })
      cues.push({ at, type: 'sound', sound: 'trap' })
      cues.push({ at, type: 'shake', power: 2.2 })
      cues.push({ at, type: 'mood', fighter: event.fighter, mood: 'down' })
      cues.push({ at: at + 60, type: 'sound', sound: 'bigroar' })
      const downAt = at + 90
      cues.push({ at: downAt, type: 'banner', text: 'DOWN!', fighter: event.fighter })
      cues.push({ at: downAt, type: 'pop', fighter: event.fighter, text: '−2', tone: 'loss' })
      if (event.by) {
        cues.push({
          at: downAt,
          type: 'pop',
          fighter: event.by,
          text: '+2 KNOCKDOWN',
          tone: 'gain',
        })
        cues.push({ at: downAt, type: 'mood', fighter: event.by, mood: 'happy' })
      }
      // The referee's count. A knockdown that ends the bout skips it and goes to the K.O. below.
      if (!isKo) {
        ;[800, 1250, 1700].forEach((delay, i) => {
          cues.push({
            at: downAt + delay,
            type: 'banner',
            text: String(i + 1),
            fighter: event.fighter,
          })
          cues.push({ at: downAt + delay, type: 'sound', sound: 'belt' })
        })
      }
    }
    if (event.type === 'bounty') {
      // The bounty changes hands the moment the holder lands off the center.
      const at = arrival[event.from] + 90
      cues.push({ at, type: 'pop', fighter: event.from, text: `−${event.points}`, tone: 'loss' })
      cues.push({
        at,
        type: 'pop',
        fighter: event.to,
        text: `+${event.points} BOUNTY`,
        tone: 'gain',
      })
      cues.push({ at, type: 'mood', fighter: event.to, mood: 'happy' })
      cues.push({ at: at + 40, type: 'sound', sound: 'bigroar' })
    }
    if (event.type === 'ko') {
      knockouts.push({ fighter: event.fighter, at: arrival[event.fighter] + 760 })
    }
  }

  const settled = Math.max(arrival.claude, arrival.gpt)
  cues.push({ at: settled, type: 'floor' })

  // One pop per fighter for the paint and the center, so a quiet turn stays quiet.
  for (const fighter of FIGHTERS) {
    let delta = 0
    let label: string | undefined
    for (const event of events) {
      if (event.type !== 'score' || event.fighter !== fighter) continue
      if (event.reason !== 'claim' && event.reason !== 'steal' && event.reason !== 'center')
        continue
      delta += event.delta
      const move = moves.get(fighter)
      const tookCenter = event.reason === 'center' && move && !samePos(move.from, move.to)
      if (event.reason === 'steal' || tookCenter) label ??= POP_LABEL[event.reason]
    }
    if (delta !== 0) {
      cues.push({
        at: settled + 40,
        type: 'pop',
        fighter,
        text: label ? `+${delta} ${label}` : `+${delta}`,
        tone: label ? 'gain' : 'quiet',
      })
    }
  }

  let end = settled
  const ko = knockouts[0]
  if (ko) {
    const at = Math.max(...knockouts.map((knockout) => knockout.at))
    cues.push({
      at,
      type: 'banner',
      text: knockouts.length === 2 ? 'DOUBLE K.O.' : 'K.O.',
      ...(knockouts.length === 1 ? { fighter: ko.fighter } : {}),
    })
    cues.push({ at, type: 'sound', sound: 'ko' })
    cues.push({ at, type: 'shake', power: 2 })
    for (const knockout of knockouts) {
      cues.push({ at, type: 'mood', fighter: knockout.fighter, mood: 'ko' })
    }
    end = at + 900
  }

  for (const fighter of FIGHTERS) frames[fighter].sort((a, b) => a.at - b.at)
  cues.sort((a, b) => a.at - b.at)
  const last = Math.max(end, ...cues.map((cue) => cue.at))
  return { duration: last + TIMING.settle, frames, cues }
}

/** The same timeline stretched, for slow-motion replays. */
export function slowed(choreo: Choreo, factor: number): Choreo {
  const scale = <T extends { at: number }>(item: T): T => ({ ...item, at: item.at * factor })
  return {
    duration: choreo.duration * factor,
    frames: { claude: choreo.frames.claude.map(scale), gpt: choreo.frames.gpt.map(scale) },
    cues: choreo.cues.map(scale),
  }
}
