import { describe, expect, it } from 'vitest'
import { winner } from './arena.ts'
import type { RingRecord } from './live.ts'
import { createRingPlayer, ringPlayerReducer } from './Ring.tsx'
import { recordShow, SHOWS, type Show } from './shows.ts'

function play(show: Show) {
  let player = ringPlayerReducer(createRingPlayer(show), { type: 'start' })
  const replays: number[] = []
  let beats = 0
  while (player.stage.kind !== 'final' && beats++ < 1000) {
    if (player.stage.kind === 'replay') replays.push(player.stage.bout)
    player = ringPlayerReducer(player, { type: 'advance', run: player.run })
  }
  expect(player.stage.kind).toBe('final')
  return { player, replays }
}

describe('Ring playback', () => {
  it('passes the repetitive bout directly to the next bell without dropping any turn or score', () => {
    const saved = import.meta.glob<RingRecord>('./fights/*.json', {
      eager: true,
      import: 'default',
    })
    const record = Object.values(saved).find((fight) => fight.id === 'broadcast-launch-2-ring')
    if (!record) throw new Error('The launch recording is missing')
    const show = recordShow(record, 1)
    const { player, replays } = play(show)
    expect(replays).not.toContain(0)
    expect(player.played.map((turns) => turns.length)).toEqual(
      record.bouts.map((turns) => turns.length),
    )
    for (const fighter of ['claude', 'gpt'] as const) {
      expect(player.ring.fighters[fighter].score).toBe(record.end.score[fighter])
      expect(player.ring.fighters[fighter].knockdowns).toBe(record.end.knockdowns[fighter])
    }
    expect(winner(player.ring)).toBe(record.end.winner)
  })

  it('retains all three authored highlights in the scripted demo', () => {
    const show = SHOWS.find((candidate) => candidate.kind === 'demo')
    if (!show) throw new Error('The scripted demo is missing')
    const { player, replays } = play(show)
    expect(replays).toEqual([0, 1, 2])
    expect(winner(player.ring)).toBe('gpt')
  })
})
