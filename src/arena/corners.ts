import { isBroadcastId } from '../games/fights.ts'
import type { SelectOption } from '../ui/index.ts'

export type CornerKey = 'claude' | 'gpt'
export type Tier = 'frontier' | 'second' | 'third'
export type Effort = 'low' | 'medium' | 'high' | 'extra' | 'max' | 'ultra'

type Model = { name: string; id: string }

export type Corner = {
  key: CornerKey
  name: string
  /** The official CLI the referee drives for this lab. */
  route: string
  /** Which model each tier resolves to. */
  models: Record<Tier, Model>
}

export const CORNERS: Record<CornerKey, Corner> = {
  claude: {
    key: 'claude',
    name: 'Claude',
    route: 'Claude Code',
    models: {
      frontier: { name: 'Claude Opus 5.5', id: 'claude-opus-5-5' },
      second: { name: 'Claude Sonnet 5.5', id: 'claude-sonnet-5-5' },
      third: { name: 'Claude Haiku 5.5', id: 'claude-haiku-5-5' },
    },
  },
  gpt: {
    key: 'gpt',
    name: 'GPT',
    route: 'Codex',
    models: {
      frontier: { name: 'GPT-6 Astra', id: 'gpt-6-astra' },
      second: { name: 'GPT-6.1 Terra', id: 'gpt-6.1-terra' },
      third: { name: 'GPT-6 Luna', id: 'gpt-6-luna' },
    },
  },
}

const TIERS: readonly { value: Tier; label: string }[] = [
  { value: 'frontier', label: 'Frontier' },
  { value: 'second', label: 'Second tier' },
  { value: 'third', label: 'Third tier' },
]

/**
 * Tier and effort are set once per fight and apply to both corners, so a fight is always like for
 * like. Each tier option shows the two models it puts in the ring.
 */
export const TIER_OPTIONS: readonly SelectOption<Tier>[] = TIERS.map(({ value, label }) => ({
  value,
  label,
  description: `${CORNERS.claude.models[value].name} vs ${CORNERS.gpt.models[value].name}`,
}))

export const EFFORT_OPTIONS: readonly SelectOption<Effort>[] = [
  { value: 'low', label: 'Low effort' },
  { value: 'medium', label: 'Medium effort' },
  { value: 'high', label: 'High effort' },
  { value: 'extra', label: 'Extra effort' },
  { value: 'max', label: 'Max effort' },
  { value: 'ultra', label: 'Ultra effort' },
]

/** Every fight is five rounds, one per locked benchmark. */
export const ROUNDS = 5

/** One setting for the whole fight. Both corners always share it. */
export type FightSettings = {
  tier: Tier
  effort: Effort
  /** A saved five-round session; omitted to choose the latest rounds independently. */
  broadcast?: string | undefined
}

/** Third tier while games are being tested: cheapest to run, same rules. */
export const DEFAULT_SETTINGS: FightSettings = { tier: 'third', effort: 'low' }

/** A shareable recording setup. Query parameters never start playback or model calls. */
export function readFightSettings(search: string): FightSettings {
  const query = new URLSearchParams(search)
  const tier = TIER_OPTIONS.find((option) => option.value === query.get('tier'))?.value
  const effort = EFFORT_OPTIONS.find((option) => option.value === query.get('effort'))?.value
  const broadcast = query.get('broadcast')
  return {
    tier: tier ?? DEFAULT_SETTINGS.tier,
    effort: effort ?? DEFAULT_SETTINGS.effort,
    ...(isBroadcastId(broadcast) ? { broadcast } : {}),
  }
}

/** Preserve the page, view and unrelated query parameters when saving a selection. */
export function fightSettingsUrl(current: URL, settings: FightSettings): URL {
  const url = new URL(current)
  for (const key of ['tier', 'effort'] as const) {
    if (settings[key] === DEFAULT_SETTINGS[key]) url.searchParams.delete(key)
    else url.searchParams.set(key, settings[key])
  }
  if (isBroadcastId(settings.broadcast)) url.searchParams.set('broadcast', settings.broadcast)
  else url.searchParams.delete('broadcast')
  return url
}

/**
 * What each effort means on each lab's CLI. Each lab's own ceiling is the top setting: Claude Code
 * goes to max, Codex stops at xhigh, so Max and Ultra are the same for GPT.
 */
export const EFFORT_FLAGS: Record<Effort, Record<CornerKey, string>> = {
  low: { claude: 'low', gpt: 'low' },
  medium: { claude: 'medium', gpt: 'medium' },
  high: { claude: 'high', gpt: 'high' },
  extra: { claude: 'high', gpt: 'high' },
  max: { claude: 'xhigh', gpt: 'xhigh' },
  ultra: { claude: 'max', gpt: 'xhigh' },
}
