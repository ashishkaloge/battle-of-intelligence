import type { Line } from '../commentary.ts'
import type { FightMeta } from '../fights.ts'
import type { Fighter } from '../ring/arena.ts'
import { BOTS } from './bots.ts'
import {
  BOUTS,
  type Bout,
  CORNERS,
  type Corner,
  HOUSE_LABEL,
  INTRO,
  type Job,
  jobs,
} from './demo.ts'
import { type BrawlRecord, recordSchedule } from './live.ts'

/** Something the Bot Brawl tab can broadcast: the scripted demo, or a fight real models coded. */
export type BrawlShow = {
  id: string
  kind: 'demo' | 'recorded'
  label: string
  detail: string
  corners: readonly Corner[]
  bouts: readonly Bout[]
  /** Every bot's source by name, exactly as it runs in the sandbox. */
  code: Record<string, string>
  jobs: readonly Job[]
  intro: Line
  fine: string
  tag: string
  prefix: string
  left: Fighter
  /** A recorded fight's models, effort, winner and calls; missing on the scripted demo. */
  fight?: FightMeta
}

export const DEMO_SHOW: BrawlShow = {
  id: 'demo',
  kind: 'demo',
  label: 'Scripted demo',
  detail: 'Real sandbox and engine, bots written for the demo',
  corners: CORNERS,
  bouts: BOUTS,
  code: BOTS,
  jobs: jobs(),
  intro: INTRO,
  fine: 'Scripted demo. The bot code was written for this demo, not by the models, but it really runs in a sandbox in your browser. Notes and commentary are written by hand. Turn your sound on.',
  tag: 'Scripted demo',
  prefix: '',
  left: 'claude',
}

export { HOUSE_LABEL }

const short = (name: string) =>
  name
    .replace(/^Claude /, '')
    .replace(/^GPT-[\d.]+ /, '')
    .replace(/ [\d.]+$/, '')

export function recordShow(record: BrawlRecord, number: number): BrawlShow {
  const day = new Date(record.playedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  const { claude, gpt } = record.effort
  const effort = claude === gpt ? claude : `${claude}/${gpt}`
  const { corners, bouts, jobs, intro } = recordSchedule(record)
  return {
    id: record.id,
    kind: 'recorded',
    label: `#${number} ${short(record.models.claude.name)} vs ${short(record.models.gpt.name)}`,
    detail: `${day} · ${record.bouts.length} bouts · ${effort} effort`,
    corners,
    bouts,
    code: record.code,
    jobs,
    intro,
    fine: `Recorded ${day}: ${record.models.claude.name} vs ${record.models.gpt.name} at ${effort} effort. The models submitted bot code and test choices. Every test and match runs in a sandbox in your browser; captions and commentary describe the submitted code and engine results. Turn your sound on.`,
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
  import.meta.glob<BrawlRecord>('./fights/*.json', { eager: true, import: 'default' }),
)

export const SHOWS: readonly BrawlShow[] = [
  ...[...RECORDS]
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt))
    .map((record, i) => recordShow(record, i + 1))
    .reverse(),
  DEMO_SHOW,
]
