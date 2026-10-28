import { describe, expect, it } from 'vitest'
import { initialState, nextBout, resolveTurn } from './arena.ts'
import type { RingRecord } from './live.ts'
import { SHOWS } from './shows.ts'

const saved = Object.values(
  import.meta.glob<RingRecord>('./fights/*.json', { eager: true, import: 'default' }),
)

describe('the shows the Ring tab broadcasts', () => {
  it('plays every recorded fight under its own rules, to the result it recorded', () => {
    for (const record of saved) {
      const show = SHOWS.find((s) => s.id === record.id)
      if (!show) throw new Error(`no show for ${record.id}`)
      // The broadcast starts its own engine from the show, exactly like this.
      let state = initialState(show.arena, show.rules)
      show.bouts.forEach((bout, b) => {
        if (b > 0) state = nextBout(state)
        for (const turn of bout.turns) {
          state = resolveTurn(state, { claude: turn.claude.move, gpt: turn.gpt.move }).state
        }
      })
      expect(state.fighters.claude.score, record.id).toBe(record.end.score.claude)
      expect(state.fighters.gpt.score, record.id).toBe(record.end.score.gpt)
    }
  })

  it('lists the newest real fight first and the scripted demo last', () => {
    expect(SHOWS.at(-1)?.kind).toBe('demo')
    expect(SHOWS[0]?.kind).toBe('recorded')
  })
})
