import type { FightMeta } from '../fights.ts'
import { type Arena, CLASSIC_RULES, type RingRules } from './arena.ts'
import { DEMO, type DemoBout, makeDemoArena } from './demo.ts'
import { floorName } from './floors.ts'
import { openingArena, type RingRecord, recordBouts } from './live.ts'

/** Something the Ring tab can broadcast: the scripted demo, or a fight real models played. */
export type Show = {
  id: string
  kind: 'demo' | 'recorded'
  /** The picker's label, and the line under it. */
  label: string
  detail: string
  /** The rules the show plays under, and how the intro card states them. */
  rules: RingRules
  ruleText: string
  arena: Arena
  bouts: readonly DemoBout[]
  /** Fine print on the intro card: what is real and what is not. */
  fine: string
  /** The corner tag in the footer. */
  tag: string
  /** Prefix for commentary line ids, so each show's recordings stay apart. */
  prefix: string
  /** A recorded fight's models, effort, winner and calls; missing on the scripted demo. */
  fight?: FightMeta
}

const CLASSIC_TEXT =
  'The rules are hidden in the floor. Step into a fighter who holds still to shove it. Traps knock you down. Three knockdowns is a knockout.'
const CONTACT_TEXT =
  'The rules are hidden in the floor. Shove a fighter who holds still; shove it into the ropes and it goes down. The center builds a bounty for whoever knocks its holder off. Three knockdowns is a knockout.'
const TAKEDOWN_TEXT =
  'The rules are hidden in the floor. Shove a fighter who holds still for a takedown; shove it into the ropes and it goes down. The center builds a bounty for whoever knocks its holder off. Three knockdowns is a knockout.'

const DEMO_SHOW: Show = {
  id: 'demo',
  kind: 'demo',
  label: 'Scripted demo',
  detail: 'Real engine, authored actions and captions',
  rules: CLASSIC_RULES,
  ruleText: CLASSIC_TEXT,
  arena: makeDemoArena(),
  bouts: DEMO,
  fine: 'Scripted demo. Every move runs through the real engine; actions and captions are written by hand. Commentary is generated ahead of playback. Turn your sound on.',
  tag: 'Scripted demo',
  prefix: '',
}

const short = (name: string) =>
  name
    .replace(/^Claude /, '')
    .replace(/^GPT-[\d.]+ /, '')
    .replace(/ [\d.]+$/, '')

/** `number` counts real fights from the first, so two on the same floor and day stay apart. */
export function recordShow(record: RingRecord, number: number): Show {
  const day = new Date(record.playedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  const { claude, gpt } = record.effort
  const effort = claude === gpt ? claude : `${claude}/${gpt}`
  const rules = record.rules ?? CLASSIC_RULES
  const contact = rules.centerBounty
  return {
    id: record.id,
    kind: 'recorded',
    label: `#${number} ${short(record.models.claude.name)} vs ${short(record.models.gpt.name)} · ${floorName(record.arena)}`,
    detail: `${day} · ${contact ? 'contact' : 'classic'} rules${rules.takedowns ? ' · takedowns' : ''}${(record.prompt ?? 1) >= 2 ? ' · move guide' : ''} · ${effort} effort`,
    rules,
    ruleText: rules.takedowns ? TAKEDOWN_TEXT : contact ? CONTACT_TEXT : CLASSIC_TEXT,
    arena: openingArena(record),
    bouts: recordBouts(record),
    fine: `Recorded ${day}: ${record.models.claude.name} vs ${record.models.gpt.name} at ${effort} effort. The models submitted moves and the engine judged every turn. Action captions and commentary describe the recorded moves and results. Turn your sound on.`,
    tag: 'Recorded fight',
    prefix: `${record.id}-`,
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
  import.meta.glob<RingRecord>('./fights/*.json', { eager: true, import: 'default' }),
)

/** Real fights first, newest first, then the scripted demo. */
export const SHOWS: readonly Show[] = [
  ...RECORDS.sort((a, b) => a.playedAt.localeCompare(b.playedAt))
    .map((record, i) => recordShow(record, i + 1))
    .reverse(),
  DEMO_SHOW,
]
