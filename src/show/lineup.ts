import { CORNERS, EFFORT_FLAGS, type FightSettings } from '../arena/corners.ts'
import { SHOWS as BLUFF, type BluffShow } from '../games/bluff/shows.ts'
import { SHOWS as BRAWL, type BrawlShow } from '../games/brawl/shows.ts'
import { SHOWS as BUZZER, type BuzzerShow } from '../games/buzzer/shows.ts'
import { type FightMeta, isBroadcastId } from '../games/fights.ts'
import { SHOWS as MIRROR, type MirrorShow } from '../games/mirror/shows.ts'
import { FIGHTERS, type Fighter } from '../games/ring/arena.ts'
import { SHOWS as RING, type Show as RingShow } from '../games/ring/shows.ts'
import type { SelectOption } from '../ui/index.ts'

/** The five rounds in fight order, one per benchmark. */
export const ROUNDS = [
  { key: 'ring', name: 'The Ring', skill: 'Learning by doing', bench: 'ARC-AGI-3' },
  { key: 'mirror', name: 'Mirror', skill: 'Reasoning', bench: 'ARC-AGI-2' },
  { key: 'buzzer', name: 'Buzzer', skill: 'Math', bench: 'FrontierMath, AIME' },
  { key: 'brawl', name: 'Bot Brawl', skill: 'Coding', bench: 'Terminal-Bench, SWE-bench Pro' },
  { key: 'bluff', name: 'Bluff', skill: 'Knowledge', bench: 'HLE, AA-Omniscience' },
] as const

export type RoundKey = (typeof ROUNDS)[number]['key']

/** The fight each round plays, or null when none matches the chosen models and effort. */
export type Lineup = {
  ring: RingShow | null
  mirror: MirrorShow | null
  buzzer: BuzzerShow | null
  brawl: BrawlShow | null
  bluff: BluffShow | null
}

type RecordedShow = { fight?: FightMeta }
type ShowCatalog = Record<RoundKey, readonly RecordedShow[]>

const SHOWS = { ring: RING, mirror: MIRROR, buzzer: BUZZER, brawl: BRAWL, bluff: BLUFF }

/** Keep the recorded session id visible without asking the viewer to read a slug. */
export const broadcastLabel = (id: string) =>
  id.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase())

/**
 * The newest real fight at the exact selected model ids and effective effort flags. Scripted
 * demos and recordings at another power never stand in for a missing match.
 */
export function pickFight<S extends RecordedShow>(
  shows: readonly S[],
  settings: FightSettings,
): S | null {
  const ids = {
    claude: CORNERS.claude.models[settings.tier].id,
    gpt: CORNERS.gpt.models[settings.tier].id,
  }
  const flags = EFFORT_FLAGS[settings.effort]
  const matches = ({ fight }: RecordedShow) =>
    fight?.models.claude.id === ids.claude &&
    fight.models.gpt.id === ids.gpt &&
    fight.effort.claude === flags.claude &&
    fight.effort.gpt === flags.gpt
  // A named broadcast must contain exactly one round at the exact settings. Never borrow a
  // missing round or choose between two recordings with the same session id.
  if (settings.broadcast) {
    if (!isBroadcastId(settings.broadcast)) return null
    const session = shows.filter((show) => show.fight?.broadcast === settings.broadcast)
    const show = session.length === 1 ? session[0] : undefined
    return show && matches(show) ? show : null
  }
  return (
    shows
      .filter(matches)
      .sort(
        (a, b) => Date.parse(b.fight?.playedAt ?? '') - Date.parse(a.fight?.playedAt ?? ''),
      )[0] ?? null
  )
}

/** Only complete, unambiguous sessions at these exact model and effort settings are selectable. */
export function broadcastsFor(settings: FightSettings, catalog: ShowCatalog = SHOWS): string[] {
  const ids = new Set(
    ROUNDS.flatMap(({ key }) =>
      catalog[key].flatMap((show) => (show.fight?.broadcast ? [show.fight.broadcast] : [])),
    ),
  )
  return [...ids]
    .filter((broadcast) =>
      ROUNDS.every(({ key }) => pickFight(catalog[key], { ...settings, broadcast })),
    )
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

export function broadcastOptions(settings: FightSettings): SelectOption<string>[] {
  const broadcasts = broadcastsFor(settings)
  return [
    { value: '', label: 'Latest rounds', description: 'Newest rounds at the selected settings' },
    ...(settings.broadcast && !broadcasts.includes(settings.broadcast)
      ? [
          {
            value: settings.broadcast,
            label: `${broadcastLabel(settings.broadcast)} · preparing`,
            disabled: true,
          },
        ]
      : []),
    ...broadcasts.map((id) => ({
      value: id,
      label: broadcastLabel(id),
      description: 'Five rounds from this recorded broadcast',
    })),
  ]
}

export function lineupFor(settings: FightSettings): Lineup {
  return {
    ring: pickFight(RING, settings),
    mirror: pickFight(MIRROR, settings),
    buzzer: pickFight(BUZZER, settings),
    brawl: pickFight(BRAWL, settings),
    bluff: pickFight(BLUFF, settings),
  }
}

/** The fight's record for a round, whichever show type it is. */
export const metaOf = (lineup: Lineup, key: RoundKey): FightMeta | null =>
  lineup[key]?.fight ?? null

/** Rounds with no fight at the selected models and effort yet. */
export const missing = (lineup: Lineup) => ROUNDS.filter((r) => !lineup[r.key])

/** The effort a fight was played at, as both corners shared it. */
export function effortText(meta: FightMeta): string {
  const { claude, gpt } = meta.effort
  return claude === gpt ? `${claude} effort` : `${claude}/${gpt} effort`
}

/** State the actual effort recorded across the matching lineup before Start. */
export function recordedEffort(lineup: Lineup): string {
  const efforts = new Set(
    ROUNDS.flatMap((round) => {
      const fight = metaOf(lineup, round.key)
      return fight ? [effortText(fight)] : []
    }),
  )
  return efforts.size ? `Recorded at ${[...efforts].join(', ')}.` : ''
}

/** Rounds won and CLI calls made across a lineup, per corner. */
export function totals(lineup: Lineup): {
  won: Record<Fighter, number>
  calls: Record<Fighter, number>
} {
  const won = { claude: 0, gpt: 0 }
  const calls = { claude: 0, gpt: 0 }
  for (const round of ROUNDS) {
    const meta = metaOf(lineup, round.key)
    if (!meta) continue
    if (meta.winner) won[meta.winner] += 1
    for (const f of FIGHTERS) calls[f] += meta.calls[f]
  }
  return { won, calls }
}

/** The command that records a round at these settings. */
export const recordCommand = (key: RoundKey, settings: FightSettings) =>
  `pnpm fight:${key} --tier ${settings.tier} --effort ${settings.effort}${isBroadcastId(settings.broadcast) ? ` --broadcast ${settings.broadcast}` : ''}`

export const replayNote = (settings: FightSettings) =>
  settings.broadcast
    ? `Five rounds from ${broadcastLabel(settings.broadcast)}. No model calls during playback.`
    : 'Only recordings matching the selected models and power are used. No model calls during playback.'
