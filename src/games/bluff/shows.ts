import type { Line } from '../commentary.ts'
import type { FightMeta } from '../fights.ts'
import type { Fighter } from '../ring/arena.ts'
import { CALIBRATION_LINE, HANDS, INTRO, type ScriptedHand } from './demo.ts'
import { type BluffRecord, recordHands } from './live.ts'

/** Something the Bluff tab can broadcast: the scripted demo, or a fight real models played. */
export type BluffShow = {
  id: string
  kind: 'demo' | 'recorded'
  label: string
  detail: string
  hands: readonly ScriptedHand[]
  /** Hands the round was set up for. A knockout can end it sooner, so the HUD never counts down to it. */
  planned: number
  intro: Line
  calibration: Line
  /** Fine print on the intro card: what is real and what is not. */
  fine: string
  tag: string
  /** Prefix for commentary line ids, so each show's recordings stay apart. */
  prefix: string
  /** Who sits on the left. Recorded fights alternate it; a full show can set it per round. */
  left: Fighter
  /** A recorded fight's models, effort, winner and calls; missing on the scripted demo. */
  fight?: FightMeta
}

export const DEMO_SHOW: BluffShow = {
  id: 'demo',
  kind: 'demo',
  label: 'Scripted demo',
  detail: 'Real questions and engine, hand-written play',
  hands: HANDS,
  planned: HANDS.length,
  intro: INTRO,
  calibration: CALIBRATION_LINE,
  fine: 'Scripted demo. The questions are real and every answer was checked; chips move through the real table engine. Answers, bets, captions and commentary are written by hand. Turn your sound on.',
  tag: 'Scripted demo',
  prefix: '',
  left: 'claude',
}

const short = (name: string) =>
  name
    .replace(/^Claude /, '')
    .replace(/^GPT-[\d.]+ /, '')
    .replace(/ [\d.]+$/, '')

/** `number` counts real fights from the first. */
export function recordShow(record: BluffRecord, number: number): BluffShow {
  const day = new Date(record.playedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  const { claude, gpt } = record.effort
  const effort = claude === gpt ? claude : `${claude}/${gpt}`
  const { hands, intro, calibration } = recordHands(record)
  return {
    id: record.id,
    kind: 'recorded',
    label: `#${number} ${short(record.models.claude.name)} vs ${short(record.models.gpt.name)}`,
    detail: `${day} · ${record.limits.hands} hands · ${effort} effort`,
    hands,
    planned: record.limits.hands,
    intro,
    calibration,
    fine: `Recorded ${day}: ${record.models.claude.name} vs ${record.models.gpt.name} at ${effort} effort. The models submitted answers and betting actions; code generated the questions and the engine judged every hand. Captions and commentary describe those actions and results. Turn your sound on.`,
    tag: 'Recorded fight',
    prefix: `${record.id}-`,
    left: record.left,
    fight: {
      ...(record.broadcast ? { broadcast: record.broadcast } : {}),
      models: record.models,
      effort: record.effort,
      winner: record.end.winner,
      calls: record.calls,
      playedAt: record.playedAt,
    },
  }
}

const RECORDS = Object.values(
  import.meta.glob<BluffRecord>('./fights/*.json', { eager: true, import: 'default' }),
)

/** Real fights first, newest first, then the scripted demo. */
export const SHOWS: readonly BluffShow[] = [
  ...[...RECORDS]
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt))
    .map((record, i) => recordShow(record, i + 1))
    .reverse(),
  DEMO_SHOW,
]
