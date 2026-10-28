import { FIGHTERS, type Fighter } from '../ring/arena.ts'
import { HANDS, type Move, type ScriptedHand } from './demo.ts'
import { type Action, newTable, playHand, type TableEvent, type TableState } from './table.ts'

/**
 * Each scripted hand, played through the engine and cut into the beats the broadcast shows: the
 * deal, the hole cards, every action in turn, the showdown if there is one, and the pot going to
 * its winner. Each beat carries the stacks and pot at that moment, so the view only draws.
 */
export type Beat =
  | { kind: 'deal' }
  | { kind: 'hole' }
  | { kind: 'move'; index: number; move: Move }
  | { kind: 'showdown'; answers: { by: Fighter; answer: string; right: boolean }[] }
  | { kind: 'pot'; result: Result }

export type Result =
  | { type: 'win'; fighter: Fighter; amount: number; shown: boolean }
  | { type: 'split'; amount: number }
  | { type: 'carry'; amount: number }

export type Snapshot = { stacks: Record<Fighter, number>; pot: number }

export type HandPlay = {
  before: TableState
  after: TableState
  events: TableEvent[]
  beats: { beat: Beat; at: Snapshot }[]
}

function cut(before: TableState, after: TableState, events: TableEvent[], moves: Move[]): HandPlay {
  const beats: HandPlay['beats'] = []
  const stacks = { ...before.stacks }
  let pot = before.carry
  for (const event of events) {
    if (event.type === 'ante') {
      for (const fighter of FIGHTERS) stacks[fighter] -= event.amounts[fighter]
      pot = event.pot
      beats.push({ beat: { kind: 'deal' }, at: { stacks: { ...stacks }, pot } })
      beats.push({ beat: { kind: 'hole' }, at: { stacks: { ...stacks }, pot } })
    } else if (event.type === 'act') {
      stacks[event.action.by] -= event.pot - pot
      pot = event.pot
      const index = beats.filter((b) => b.beat.kind === 'move').length
      const move = moves[index] ?? { action: event.action as Action, think: '' }
      beats.push({ beat: { kind: 'move', index, move }, at: { stacks: { ...stacks }, pot } })
    } else if (event.type === 'showdown') {
      beats.push({
        beat: { kind: 'showdown', answers: event.answers },
        at: { stacks: { ...stacks }, pot },
      })
    } else if (event.type === 'win' || event.type === 'split' || event.type === 'carry') {
      beats.push({
        beat: { kind: 'pot', result: event },
        at: { stacks: { ...after.stacks }, pot: after.carry },
      })
    }
  }
  return { before, after, events, beats }
}

/** A whole round, hand by hand: the scripted demo unless a recorded fight's hands are given. */
export function playScript(hands: readonly ScriptedHand[] = HANDS): HandPlay[] {
  const plays: HandPlay[] = []
  let state = newTable()
  hands.forEach((hand, h) => {
    const actions = hand.moves.map((m) => m.action)
    const result = playHand(state, hand.question, hand.opener, actions, h === hands.length - 1)
    plays.push(cut(state, result.state, result.events, hand.moves))
    state = result.state
  })
  return plays
}
