import type { Line } from '../commentary.ts'
import type { FightMeta } from '../fights.ts'
import type { Fighter } from '../ring/arena.ts'
import { INTRO, OUTRO, type ScriptedTurn, TURNS } from './demo.ts'
import { type MirrorRecord, recordTurns } from './live.ts'
import type { Base, TurnResult } from './versus.ts'

/** What the engine made of a match: every turn's verdicts, and how it ended. */
export type Match = {
  bases: Base[]
  turns: TurnResult[]
  ko: Fighter | null
  winner: Fighter | null
}

/** Something the Mirror tab can broadcast: the scripted demo, or a fight real models played. */
export type MirrorShow = {
  id: string
  kind: 'demo' | 'recorded'
  label: string
  detail: string
  script: readonly ScriptedTurn[]
  /** A recorded fight carries its verdicts; the demo's come from the solver in a worker. */
  match: Match | null
  /** Turns the round was set up for. A knockout can end it sooner. */
  planned: number
  intro: Line
  outro: Line
  fine: string
  tag: string
  prefix: string
  left: Fighter
  /** A recorded fight's models, effort, winner and calls; missing on the scripted demo. */
  fight?: FightMeta
}

export const DEMO_SHOW: MirrorShow = {
  id: 'demo',
  kind: 'demo',
  label: 'Scripted demo',
  detail: 'Real puzzles and solver, hand-written play',
  script: TURNS,
  match: null,
  planned: TURNS.length,
  intro: INTRO,
  outro: OUTRO,
  fine: 'Scripted demo. The puzzles are real seeded grids, and every attack is checked fair by the solver before it lands. Rules, attacks, captions and commentary are written by hand. Turn your sound on.',
  tag: 'Scripted demo',
  prefix: '',
  left: 'claude',
}

const short = (name: string) =>
  name
    .replace(/^Claude /, '')
    .replace(/^GPT-[\d.]+ /, '')
    .replace(/ [\d.]+$/, '')

export function recordShow(record: MirrorRecord, number: number): MirrorShow {
  const day = new Date(record.playedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  const { claude, gpt } = record.effort
  const effort = claude === gpt ? claude : `${claude}/${gpt}`
  const { turns, intro, outro } = recordTurns(record)
  return {
    id: record.id,
    kind: 'recorded',
    label: `#${number} ${short(record.models.claude.name)} vs ${short(record.models.gpt.name)}`,
    detail: `${day} · ${record.limits.turns} turns · ${effort} effort`,
    script: turns,
    match: { bases: record.bases, ...record.result },
    planned: record.limits.turns,
    intro,
    outro,
    fine: `Recorded ${day}: ${record.models.claude.name} vs ${record.models.gpt.name} at ${effort} effort. The models submitted rules, answers and attacks; code generated the puzzles and the solver checked every attack. Captions and commentary describe those actions and results. Turn your sound on.`,
    tag: 'Recorded fight',
    prefix: `${record.id}-`,
    left: record.left,
    fight: {
      ...(record.broadcast ? { broadcast: record.broadcast } : {}),
      models: record.models,
      effort: record.effort,
      winner: record.result.winner,
      calls: record.calls,
      playedAt: record.playedAt,
    },
  }
}

const RECORDS = Object.values(
  import.meta.glob<MirrorRecord>('./fights/*.json', { eager: true, import: 'default' }),
)

export const SHOWS: readonly MirrorShow[] = [
  ...[...RECORDS]
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt))
    .map((record, i) => recordShow(record, i + 1))
    .reverse(),
  DEMO_SHOW,
]
