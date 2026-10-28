import { randomInt, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { link, mkdir, unlink, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { cliStatus } from '../server/cli.ts'
import { CORNERS, EFFORT_FLAGS, type Effort, type Tier } from '../src/arena/corners.ts'
import { isBroadcastId } from '../src/games/fights.ts'
import type { Fighter } from '../src/games/ring/arena.ts'

/**
 * What every `pnpm fight:<round>` script shares: one tier and one effort for both corners, both
 * CLIs signed in, Ctrl-C that stops both, the left seat alternating from fight to fight, and a
 * record saved where the round's tab picks it up.
 */

const TIERS: readonly Tier[] = ['frontier', 'second', 'third']
const PRESETS: readonly Effort[] = ['extra', 'max', 'ultra']
/** Raw levels both CLIs accept, passed through unchanged. */
const LEVELS = ['low', 'medium', 'high'] as const

export function failer(name: string) {
  return (message: string): never => {
    console.error(`${name}: ${message}`)
    process.exit(1)
  }
}

export function tierAndEffort(
  values: { tier?: string | undefined; effort?: string | undefined },
  fail: (message: string) => never,
): { tier: Tier; effort: Record<Fighter, string> } {
  const tier = TIERS.find((t) => t === values.tier) ?? fail(`unknown tier ${values.tier}`)
  const preset = PRESETS.find((e) => e === values.effort)
  const level = LEVELS.find((e) => e === values.effort)
  const effort: Record<Fighter, string> = preset
    ? { ...EFFORT_FLAGS[preset] }
    : level
      ? { claude: level, gpt: level }
      : fail(`unknown effort ${values.effort}; use ${[...LEVELS, ...PRESETS].join(', ')}`)
  return { tier, effort }
}

export const fightsDir = (round: string) => {
  if (!['ring', 'bluff', 'buzzer', 'mirror', 'brawl'].includes(round))
    throw new Error('unknown fight round')
  return resolve(import.meta.dirname, '..', 'src', 'games', round, 'fights')
}

/** Every saved record of a round, oldest first. */
export function savedRecords<T extends { playedAt: string }>(round: string): T[] {
  const dir = fightsDir(round)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T)
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt))
}

/** The left seat for the next fight: the opposite of the last saved one, so sides even out. */
export function nextLeft(round: string, given: string | undefined, fail: (m: string) => never) {
  if (given === 'claude' || given === 'gpt') return given
  if (given !== undefined) fail(`unknown side ${given}; use claude or gpt`)
  const last = savedRecords<{ playedAt: string; left?: Fighter; opener?: Fighter }>(round).at(-1)
  const previous = round === 'ring' ? last?.opener : last?.left
  return (last ? (previous === 'gpt' ? 'claude' : 'gpt') : 'claude') satisfies Fighter
}

export async function signedIn(fail: (message: string) => never) {
  const labs = await cliStatus()
  for (const lab of Object.values(labs)) if (!lab.ready) fail(lab.hint)
}

/** An AbortController that Ctrl-C trips, so both CLIs stop together and nothing is saved. */
export function stopOnCtrlC(name: string) {
  const controller = new AbortController()
  const stop = () => {
    if (controller.signal.aborted) return
    console.log(`\n${name}: stopping both CLIs`)
    controller.abort()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  return controller
}

const short = (name: string) =>
  name
    .replace(/^Claude /, '')
    .replace(/^GPT-[\d.]+ /, '')
    .replace(/ [\d.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'model'

/** Atomic saves use date/model names, or one stable filename per named broadcast round. */
export async function saveRecord<T extends BroadcastRecord>(
  round: string,
  record: T,
  signal?: AbortSignal,
): Promise<{ id: string; file: string }> {
  const checkStop = () => {
    if (signal?.aborted) throw new Error('stopped')
  }
  checkStop()
  checkBroadcastSlot(round, record)
  if (record.broadcast) checkBroadcastQuality(record)
  const dir = fightsDir(round)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(record.playedAt) || !Number.isFinite(Date.parse(record.playedAt)))
    throw new Error('invalid fight date')
  const base = record.broadcast
    ? `broadcast-${record.broadcast}-${round}`
    : `${record.playedAt.slice(0, 10)}-${short(record.models.claude.name)}-vs-${short(record.models.gpt.name)}`
  await mkdir(dir, { recursive: true })
  const temporary = join(dir, `.${randomUUID()}.tmp`)
  try {
    for (let n = 1; ; n++) {
      checkStop()
      const id = n === 1 ? base : `${base}-${n}`
      const file = join(dir, `${id}.json`)
      await writeFile(temporary, `${JSON.stringify({ ...record, id }, null, 2)}\n`, { mode: 0o600 })
      checkStop()
      try {
        // Linking a finished file is atomic and refuses to replace another concurrent save.
        await link(temporary, file)
        if (signal?.aborted) {
          await unlink(file)
          throw new Error('stopped')
        }
        return { id, file: relative(process.cwd(), file) }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (record.broadcast)
          throw new Error(`broadcast ${record.broadcast} already has a ${round} round`)
      }
    }
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

/**
 * A round's limits with the shot clock and round clock from the command line, for both corners
 * alike: `--clock` in seconds per decision, `--round-minutes` for the whole round. Top effort can
 * think for longer than the defaults allow, and a late reply is the referee's decision.
 */
export function withClocks<L extends { shotClockMs: number; roundMs: number }>(
  limits: L,
  values: { clock?: string | undefined; 'round-minutes'?: string | undefined },
  fail: (message: string) => never,
): L {
  const read = (raw: string | undefined, name: string, multiplier: number) => {
    if (raw === undefined) return null
    const n = Number(raw)
    const milliseconds = n * multiplier
    return raw.trim() !== '' &&
      Number.isFinite(milliseconds) &&
      milliseconds >= 1 &&
      milliseconds <= 2_147_483_647
      ? milliseconds
      : fail(`${name} must be positive and no longer than 24.8 days`)
  }
  const clock = read(values.clock, '--clock', 1000)
  if (clock !== null && clock < 5000) fail('--clock must allow at least 5 seconds per decision')
  const round = read(values['round-minutes'], '--round-minutes', 60_000)
  return {
    ...limits,
    ...(clock ? { shotClockMs: clock } : {}),
    ...(round ? { roundMs: round } : {}),
  }
}

/** Seeds are exactly the unsigned 32-bit integers used by the deterministic generator. */
export function fightSeed(raw: string | undefined, fail: (message: string) => never): number {
  if (raw === undefined) return randomInt(1, 2 ** 32)
  const seed = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(seed) || seed < 0 || seed >= 2 ** 32)
    return fail('seed must be a whole number from 0 to 4294967295')
  return seed
}

/** A named broadcast is five separately recorded rounds with one fixed matchup and effort. */
export function broadcastName(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  if (!isBroadcastId(raw))
    throw new Error('--broadcast must be a lowercase name with hyphens, at most 80 characters')
  return raw
}

type BroadcastRecord = {
  playedAt: string
  broadcast?: string
  models: Record<Fighter, { id?: string; name: string }>
  effort?: Record<Fighter, string>
}

/** Refuse a duplicate round or mixed matchup before spending subscription allowance. */
export function checkBroadcastSlot(round: string, record: BroadcastRecord): void {
  const broadcast = broadcastName(record.broadcast)
  if (!broadcast) return
  if (!record.models.claude.id || !record.models.gpt.id || !record.effort)
    throw new Error('a broadcast needs both model IDs and effort levels')
  for (const game of ['ring', 'mirror', 'buzzer', 'brawl', 'bluff']) {
    for (const previous of savedRecords<BroadcastRecord>(game)) {
      if (previous.broadcast !== broadcast) continue
      if (game === round) throw new Error(`broadcast ${broadcast} already has a ${round} round`)
      for (const lab of ['claude', 'gpt'] as const) {
        if (
          previous.models[lab].id !== record.models[lab].id ||
          previous.effort?.[lab] !== record.effort[lab]
        )
          throw new Error(`broadcast ${broadcast} must keep the same models and effort`)
      }
    }
  }
}

export function prepareBroadcast(
  round: string,
  raw: string | undefined,
  tier: Tier,
  effort: Record<Fighter, string>,
): string | undefined {
  const broadcast = broadcastName(raw)
  checkBroadcastSlot(round, {
    playedAt: '',
    ...(broadcast ? { broadcast } : {}),
    models: { claude: CORNERS.claude.models[tier], gpt: CORNERS.gpt.models[tier] },
    effort,
  })
  return broadcast
}

const RULINGS = ['played', 'late', 'unusable', 'tools', 'error', 'capped', 'down'] as const
type RulingCounts = Record<(typeof RULINGS)[number], number>

/** Only structured referee rulings count; model text is never parsed as evidence. */
export function fightRulings(record: unknown): Record<Fighter, RulingCounts> {
  const blank = () => Object.fromEntries(RULINGS.map((ruling) => [ruling, 0])) as RulingCounts
  const counts = { claude: blank(), gpt: blank() }
  const visit = (value: unknown, lab?: Fighter) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, lab)
      return
    }
    const object = value as Record<string, unknown>
    const ruling = RULINGS.find((item) => item === object.ruling)
    // Bluff betting actions carry their actor inside action.by instead of a corner key.
    const by = (object.action as { by?: unknown } | undefined)?.by
    const actor = by === 'claude' || by === 'gpt' ? by : lab
    if (ruling && actor) counts[actor][ruling] += 1
    for (const [key, child] of Object.entries(object))
      visit(child, key === 'claude' || key === 'gpt' ? key : lab)
  }
  visit(record)
  return counts
}

/** Do not present an unavailable provider or a wholly unusable run as a completed broadcast. */
export function checkBroadcastQuality(record: unknown): void {
  const counts = fightRulings(record)
  for (const lab of ['claude', 'gpt'] as const) {
    if (counts[lab].error > 0) throw new Error(`${lab} provider failed; broadcast round not saved`)
    if (counts[lab].played === 0)
      throw new Error(`${lab} made no usable decisions; broadcast round not saved`)
  }
}

/** The options every fight script shares. */
export const COMMON_OPTIONS = {
  tier: { type: 'string', default: 'third' },
  effort: { type: 'string', default: 'low' },
  broadcast: { type: 'string' },
  seed: { type: 'string' },
  left: { type: 'string' },
  clock: { type: 'string' },
  'round-minutes': { type: 'string' },
} as const

export const pad = (text: string, size: number) =>
  text.length > size ? text.slice(0, size) : text.padEnd(size)
