import type { Line } from '../commentary.ts'
import type { FightMeta } from '../fights.ts'
import type { Fighter } from '../ring/arena.ts'
import { INTRO, OUTRO, type ScriptedTossup, TOSSUPS } from './demo.ts'
import { type BuzzerRecord, recordTossups } from './live.ts'

/** Something the Buzzer tab can broadcast: the scripted demo, or a fight real models played. */
export type BuzzerShow = {
  id: string
  kind: 'demo' | 'recorded'
  label: string
  detail: string
  tossups: readonly ScriptedTossup[]
  intro: Line
  outro: Line
  fine: string
  tag: string
  prefix: string
  left: Fighter
  /** A recorded fight's models, effort, winner and calls; missing on the scripted demo. */
  fight?: FightMeta
}

export const DEMO_SHOW: BuzzerShow = {
  id: 'demo',
  kind: 'demo',
  label: 'Scripted demo',
  detail: 'Original problems and real engine, hand-written play',
  tossups: TOSSUPS,
  intro: INTRO,
  outro: OUTRO,
  fine: 'Scripted demo. The problems are originals, every answer is computed by brute force, and points move through the real tossup engine. Buzzes, captions and commentary are written by hand. Turn your sound on.',
  tag: 'Scripted demo',
  prefix: '',
  left: 'claude',
}

const short = (name: string) =>
  name
    .replace(/^Claude /, '')
    .replace(/^GPT-[\d.]+ /, '')
    .replace(/ [\d.]+$/, '')

export function recordShow(record: BuzzerRecord, number: number): BuzzerShow {
  const day = new Date(record.playedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  const { claude, gpt } = record.effort
  const effort = claude === gpt ? claude : `${claude}/${gpt}`
  const { tossups, intro, outro } = recordTossups(record)
  return {
    id: record.id,
    kind: 'recorded',
    label: `#${number} ${short(record.models.claude.name)} vs ${short(record.models.gpt.name)}`,
    detail: `${day} · ${record.tossups.length} tossups · ${effort} effort`,
    tossups,
    intro,
    outro,
    fine: `Recorded ${day}: ${record.models.claude.name} vs ${record.models.gpt.name} at ${effort} effort. The models submitted buzzes and answers; code generated the problems and computed the answers, and the engine judged every buzz. Captions and commentary describe those actions and results. Turn your sound on.`,
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
  import.meta.glob<BuzzerRecord>('./fights/*.json', { eager: true, import: 'default' }),
)

export const SHOWS: readonly BuzzerShow[] = [
  ...[...RECORDS]
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt))
    .map((record, i) => recordShow(record, i + 1))
    .reverse(),
  DEMO_SHOW,
]
