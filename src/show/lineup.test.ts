import { describe, expect, it } from 'vitest'
import { CORNERS, DEFAULT_SETTINGS } from '../arena/corners.ts'
import type { FightMeta } from '../games/fights.ts'
import {
  broadcastsFor,
  lineupFor,
  missing,
  pickFight,
  recordCommand,
  recordedEffort,
  totals,
} from './lineup.ts'

const meta = (tier: 'third' | 'frontier', effort: string, playedAt: string): FightMeta => ({
  models:
    tier === 'third'
      ? {
          claude: { name: 'Claude Haiku 5.5', id: 'claude-haiku-5-5' },
          gpt: { name: 'GPT-6 Luna', id: 'gpt-6-luna' },
        }
      : {
          claude: { name: 'Claude Opus 5.5', id: 'claude-opus-5-5' },
          gpt: { name: 'GPT-6 Astra', id: 'gpt-6-astra' },
        },
  effort: effort === 'ultra' ? { claude: 'max', gpt: 'xhigh' } : { claude: effort, gpt: effort },
  winner: 'claude',
  calls: { claude: 3, gpt: 4 },
  playedAt,
})

describe('the full fight lineup', () => {
  // Shows come newest first, the scripted demo last, as every round's tab lists them.
  const shows = [
    { id: 'c', fight: meta('third', 'low', '2026-10-23T12:00:00Z') },
    { id: 'b', fight: meta('third', 'ultra', '2026-10-22T12:00:00Z') },
    { id: 'a', fight: meta('frontier', 'low', '2026-10-21T12:00:00Z') },
    { id: 'demo' },
  ]

  it('requires the chosen effort instead of falling back within the same tier', () => {
    expect(pickFight(shows, { tier: 'third', effort: 'ultra' })?.id).toBe('b')
    expect(pickFight(shows, { tier: 'third', effort: 'max' })).toBeNull()
    expect(pickFight(shows, { tier: 'frontier', effort: 'ultra' })).toBeNull()
  })

  it('selects the matching effort even when another power has a newer recording', () => {
    const mixed = [
      { id: 'low', fight: meta('third', 'low', '2026-10-21T12:00:00Z') },
      { id: 'high', fight: meta('third', 'high', '2026-10-23T12:00:00Z') },
    ]
    expect(pickFight(mixed, DEFAULT_SETTINGS)?.id).toBe('low')
    expect(pickFight(mixed, { tier: 'third', effort: 'high' })?.id).toBe('high')
    expect(recordCommand('ring', DEFAULT_SETTINGS)).toBe(
      'pnpm fight:ring --tier third --effort low',
    )
  })

  it.each(['claude', 'gpt'] as const)(
    'rejects a different %s model even at matching effort',
    (f) => {
      const fight = meta('third', 'low', '2026-10-28T12:00:00Z')
      const wrongModel = {
        id: 'wrong-model',
        fight: { ...fight, models: { ...fight.models, [f]: CORNERS[f].models.second } },
      }
      expect(pickFight([wrongModel], DEFAULT_SETTINGS)).toBeNull()
    },
  )

  it.each(['claude', 'gpt'] as const)(
    'rejects a different %s effort even with matching models',
    (f) => {
      const fight = meta('third', 'low', '2026-10-28T12:00:00Z')
      const wrongEffort = {
        id: 'wrong-effort',
        fight: { ...fight, effort: { ...fight.effort, [f]: 'medium' } },
      }
      expect(pickFight([wrongEffort], DEFAULT_SETTINGS)).toBeNull()
    },
  )

  it('never counts the scripted demo as a fight', () => {
    const demoOnly: { id: string; fight?: FightMeta }[] = [{ id: 'demo' }]
    expect(pickFight(demoOnly, { tier: 'third', effort: 'ultra' })).toBeNull()
  })

  it('takes the newest exact match without changing catalog order', () => {
    const shuffled = [
      { id: 'older-low', fight: meta('third', 'low', '2026-10-21T12:00:00Z') },
      { id: 'newest-high', fight: meta('third', 'high', '2026-10-28T12:00:00Z') },
      { id: 'newer-low', fight: meta('third', 'low', '2026-10-23T12:00:00Z') },
    ]
    expect(pickFight(shuffled, DEFAULT_SETTINGS)?.id).toBe('newer-low')
    expect(shuffled.map((show) => show.id)).toEqual(['older-low', 'newest-high', 'newer-low'])
  })

  it('pairs Sonnet 5.5 with the exact Terra model at the second tier', () => {
    expect(CORNERS.claude.models.second.id).toBe('claude-sonnet-5-5')
    expect(CORNERS.gpt.models.second).toEqual({ name: 'GPT-6.1 Terra', id: 'gpt-6.1-terra' })
  })

  it('keeps two named broadcasts separate and never falls back to another effort', () => {
    const fight = meta('third', 'low', '2026-10-28T12:00:00Z')
    const first = { id: 'first', fight: { ...fight, broadcast: 'launch-1' } }
    const second = { id: 'second', fight: { ...fight, broadcast: 'launch-2' } }
    const sessions = [first, second]
    expect(pickFight(sessions, { ...DEFAULT_SETTINGS, broadcast: 'launch-1' })?.id).toBe('first')
    expect(pickFight(sessions, { ...DEFAULT_SETTINGS, broadcast: 'launch-2' })?.id).toBe('second')
    expect(pickFight(sessions, { ...DEFAULT_SETTINGS, broadcast: 'missing' })).toBeNull()
    expect(
      pickFight(sessions, { ...DEFAULT_SETTINGS, effort: 'medium', broadcast: 'launch-1' }),
    ).toBeNull()
    expect(recordCommand('ring', { ...DEFAULT_SETTINGS, broadcast: 'launch-1' })).toBe(
      'pnpm fight:ring --tier third --effort low --broadcast launch-1',
    )
    expect(recordCommand('ring', { ...DEFAULT_SETTINGS, broadcast: 'bad; command' })).toBe(
      'pnpm fight:ring --tier third --effort low',
    )
  })

  it('offers only complete broadcasts with one compatible recording per round', () => {
    const fight = { ...meta('third', 'low', '2026-10-28T12:00:00Z'), broadcast: 'launch-1' }
    const first = { id: 'first', fight }
    const second = { id: 'second', fight: { ...fight, broadcast: 'launch-2' } }
    const catalog = {
      ring: [first, second],
      mirror: [first, second],
      buzzer: [first, second],
      brawl: [first, second],
      bluff: [first, second],
    }
    expect(broadcastsFor(DEFAULT_SETTINGS, catalog)).toEqual(['launch-1', 'launch-2'])
    expect(broadcastsFor(DEFAULT_SETTINGS, { ...catalog, bluff: [second] })).toEqual(['launch-2'])
    expect(broadcastsFor(DEFAULT_SETTINGS, { ...catalog, ring: [first, first, second] })).toEqual([
      'launch-2',
    ])
    const wrongModel = {
      ...first,
      fight: { ...fight, models: { ...fight.models, gpt: CORNERS.gpt.models.second } },
    }
    expect(broadcastsFor(DEFAULT_SETTINGS, { ...catalog, mirror: [wrongModel, second] })).toEqual([
      'launch-2',
    ])
    const wrongEffort = { ...first, fight: { ...fight, effort: { claude: 'low', gpt: 'high' } } }
    expect(broadcastsFor(DEFAULT_SETTINGS, { ...catalog, brawl: [wrongEffort, second] })).toEqual([
      'launch-2',
    ])
  })

  it('finds five matching third-tier fights and leaves other settings unavailable', () => {
    const third = lineupFor(DEFAULT_SETTINGS)
    expect(missing(third)).toHaveLength(0)
    expect(recordedEffort(third)).toContain('low effort')
    expect(totals(third).won.claude + totals(third).won.gpt).toBeLessThanOrEqual(5)
    expect(missing(lineupFor({ tier: 'third', effort: 'ultra' }))).toHaveLength(5)
    const frontier = lineupFor({ tier: 'frontier', effort: 'ultra' })
    expect(missing(frontier).map((r) => r.key)).toEqual([
      'ring',
      'mirror',
      'buzzer',
      'brawl',
      'bluff',
    ])
    expect(recordCommand('mirror', { tier: 'frontier', effort: 'ultra' })).toBe(
      'pnpm fight:mirror --tier frontier --effort ultra',
    )
  })

  it('never plays the saved medium-effort Sonnet–Terra fights when Max is selected', () => {
    const medium = lineupFor({ tier: 'second', effort: 'medium' })
    expect(missing(medium)).toHaveLength(0)
    for (const show of Object.values(medium)) {
      expect(show?.fight?.models).toEqual({
        claude: CORNERS.claude.models.second,
        gpt: CORNERS.gpt.models.second,
      })
      expect(show?.fight?.effort).toEqual({ claude: 'medium', gpt: 'medium' })
    }
    const max = lineupFor({ tier: 'second', effort: 'max' })
    expect(missing(max)).toHaveLength(5)
    expect(recordedEffort(max)).toBe('')
    expect(totals(max).calls).toEqual({ claude: 0, gpt: 0 })
  })
})
