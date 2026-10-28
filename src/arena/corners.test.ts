import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, fightSettingsUrl, readFightSettings } from './corners.ts'

describe('fight launch links', () => {
  it('restores the exact matchup, effort and named broadcast after a refresh', () => {
    const url = new URL(
      'https://example.test/battle/?tier=second&effort=medium&broadcast=launch-1#fight',
    )
    const settings = readFightSettings(url.search)
    expect(settings).toEqual({ tier: 'second', effort: 'medium', broadcast: 'launch-1' })
    expect(readFightSettings(fightSettingsUrl(url, settings).search)).toEqual(settings)
  })

  it('allows only known settings and safe broadcast identifiers', () => {
    expect(
      readFightSettings('?tier=unknown&effort=infinite&broadcast=../secret&autoplay=1'),
    ).toEqual(DEFAULT_SETTINGS)
    expect(readFightSettings(`?broadcast=${'a'.repeat(81)}`)).toEqual(DEFAULT_SETTINGS)
    // A valid but absent session stays selected so playback cannot silently fall back.
    expect(readFightSettings('?broadcast=missing-session').broadcast).toBe('missing-session')
  })

  it('updates only fight parameters while preserving the current view and other parameters', () => {
    const current = new URL(
      'https://example.test/battle/?campaign=launch&tier=second&effort=medium&broadcast=launch-1#fight',
    )
    const reset = fightSettingsUrl(current, DEFAULT_SETTINGS)
    expect(reset.href).toBe('https://example.test/battle/?campaign=launch#fight')
    expect(current.searchParams.get('broadcast')).toBe('launch-1')
    const rematch = fightSettingsUrl(current, {
      tier: 'second',
      effort: 'medium',
      broadcast: 'launch-2',
    })
    expect(rematch.searchParams.get('broadcast')).toBe('launch-2')
    expect(rematch.hash).toBe('#fight')
  })
})
