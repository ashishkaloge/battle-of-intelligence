import { describe, expect, it } from 'vitest'
import { other } from '../ring/arena.ts'
import { type BrawlRecord, parsePatchReply, parseVerdictReply, recordSchedule } from './live.ts'
import { makeMap } from './maps.ts'
import { playMatch } from './match.ts'
import { loadQuickJS } from './sandbox.ts'

describe('saved Bot Brawl fights', () => {
  const saved = import.meta.glob<BrawlRecord>('./fights/*.json', { eager: true, import: 'default' })

  it('reproduces every recorded match from its source and seed', async () => {
    expect(Object.keys(saved).length).toBeGreaterThan(0)
    const qjs = await loadQuickJS()
    for (const record of Object.values(saved)) {
      const { jobs, bouts } = recordSchedule(record)
      for (const job of jobs.filter((item) => item.id.startsWith('b'))) {
        const played = playMatch(qjs, makeMap(job.seed, job.flip), job.rules, {
          claude: record.code[job.bots.claude] ?? '',
          gpt: record.code[job.bots.gpt] ?? '',
        })
        const [b, m] = job.id.slice(1).split('-m').map(Number)
        const expected = bouts[b ?? 0]?.matches[m ?? 0]?.expect
        expect(played.winner, `${record.id}/${job.id}`).toBe(expected?.winner)
        if (played.winner) {
          expect(played.crashes[other(played.winner)]?.cause, `${record.id}/${job.id}`).toBe(
            expected?.cause,
          )
        }
      }
    }
  }, 120_000)
})

describe('Bot Brawl reply validation', () => {
  it.each([undefined, null, 'false', 'true', 0, 1, {}])(
    'requires an explicit boolean shipping verdict: %j',
    (ship) => {
      expect(parseVerdictReply(JSON.stringify({ verdict: 'done', ship })).ok).toBe(false)
    },
  )

  it.each([true, null, [], [1], {}, '0x1'])('rejects a coerced match number: %j', (match) => {
    const reply = `${JSON.stringify({ claim: { match, cause: 'wall' } })}\n\`\`\`js\nfunction move() { return 'up' }\n\`\`\``
    expect(parsePatchReply(reply, 3).ok).toBe(false)
  })
})
