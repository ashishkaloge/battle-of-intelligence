import { FIGHTERS, type Fighter } from '../ring/arena.ts'
import { type ScriptedTossup, TOSSUPS, type Turn } from './demo.ts'
import { type Decision, playTossup, type QuizEvent } from './quiz.ts'

/**
 * Each scripted tossup, played through the engine and cut into the beats the broadcast shows: the
 * card, each hint as it lands, both models working, the buzz-or-wait moment, the judging, and the
 * answer. Every beat carries the running score, so the view only draws.
 */
export type Buzz = { fighter: Fighter; answer: number; right: boolean }

export type Beat =
  | { kind: 'card' }
  | { kind: 'hint'; reveal: number }
  | { kind: 'think'; reveal: number; turns: Partial<Record<Fighter, Turn>> }
  | { kind: 'decide'; reveal: number; turns: Partial<Record<Fighter, Turn>> }
  | { kind: 'judge'; reveal: number; buzzes: Buzz[]; deadHeat: boolean }
  | { kind: 'end'; answer: number; winners: Fighter[] }

export type TossupPlay = {
  beats: { beat: Beat; reveal: number; value: number; score: Record<Fighter, number> }[]
  /** Points this tossup, per model. */
  points: Record<Fighter, number>
}

/** A whole round, tossup by tossup: the scripted demo unless a recorded fight's are given. */
export function playScript(tossups: readonly ScriptedTossup[] = TOSSUPS): TossupPlay[] {
  const totals: Record<Fighter, number> = { claude: 0, gpt: 0 }
  return tossups.map((tossup) => {
    const decisions = tossup.turns.map((turn) => {
      const out: Partial<Record<Fighter, Decision>> = {}
      for (const fighter of FIGHTERS) {
        const t = turn[fighter]
        if (t) out[fighter] = t.decision
      }
      return out
    })
    const { points, events } = playTossup(tossup.problem, decisions, tossup.double)
    const beats: TossupPlay['beats'] = []
    const score = { ...totals }
    let reveal = 0
    let value = 0
    const push = (beat: Beat) => beats.push({ beat, reveal, value, score: { ...score } })
    const buzzes: Buzz[] = []
    let deadHeat = false
    const flushJudge = () => {
      if (buzzes.length) push({ kind: 'judge', reveal, buzzes: buzzes.splice(0), deadHeat })
      deadHeat = false
    }
    for (const event of events as QuizEvent[]) {
      if (event.type === 'reveal') {
        flushJudge()
        reveal = event.reveal
        value = event.value
        push(reveal === 0 ? { kind: 'card' } : { kind: 'hint', reveal })
        const turns = tossup.turns[reveal] ?? {}
        push({ kind: 'think', reveal, turns })
        push({ kind: 'decide', reveal, turns })
      } else if (event.type === 'buzz') {
        buzzes.push({ fighter: event.fighter, answer: event.answer, right: event.right })
      } else if (event.type === 'neg' || event.type === 'score') {
        score[event.fighter] += event.points
      } else if (event.type === 'dead-heat') {
        deadHeat = true
      } else if (event.type === 'end') {
        flushJudge()
        push({ kind: 'end', answer: event.answer, winners: event.winners })
      }
    }
    totals.claude += points.claude
    totals.gpt += points.gpt
    return { beats, points }
  })
}
