import { describe, expect, it } from 'vitest'
import { other } from '../ring/arena.ts'
import { BOTS } from './bots.ts'
import { BOUTS, CORNERS, jobs, MATCHES_TO_WIN, matchId, testId } from './demo.ts'
import { diffLines, diffStat } from './diff.ts'
import { makeMap } from './maps.ts'
import { type Played, playMatch } from './match.ts'
import { loadQuickJS } from './sandbox.ts'

/** Plays the whole schedule once: every corner test and every bout match. */
async function playAll() {
  const qjs = await loadQuickJS()
  const results = new Map<string, Played>()
  for (const job of jobs()) {
    const code = { claude: BOTS[job.bots.claude] ?? '', gpt: BOTS[job.bots.gpt] ?? '' }
    results.set(job.id, playMatch(qjs, makeMap(job.seed, job.flip), job.rules, code))
  }
  return results
}

describe('the scripted Bot Brawl', () => {
  it('plays out exactly as the script says', async () => {
    const results = await playAll()

    CORNERS.forEach((corner, c) => {
      for (const fighter of ['claude', 'gpt'] as const) {
        corner[fighter].tests.forEach((test, t) => {
          const played = results.get(testId(c, fighter, t))
          const outcome = played?.faults[fighter]
            ? 'crash'
            : played?.winner === fighter
              ? 'win'
              : played?.winner === null
                ? 'draw'
                : 'loss'
          expect(`${testId(c, fighter, t)} ${outcome}`).toBe(
            `${testId(c, fighter, t)} ${test.expect}`,
          )
        })
      }
    })

    BOUTS.forEach((bout, b) => {
      const wins = { claude: 0, gpt: 0 }
      bout.matches.forEach((match, m) => {
        const played = results.get(matchId(b, m))
        const winner = played?.winner ?? null
        const loser = winner ? other(winner) : 'claude'
        expect(`${matchId(b, m)} ${winner} ${played?.crashes[loser]?.cause}`).toBe(
          `${matchId(b, m)} ${match.expect.winner} ${match.expect.cause}`,
        )
        if (winner) wins[winner] += 1
        // The bout must not have been decided before this match.
        expect(Math.max(wins.claude, wins.gpt) <= MATCHES_TO_WIN).toBe(true)
      })
      expect(Math.max(wins.claude, wins.gpt)).toBe(MATCHES_TO_WIN)
    })

    // Every claim is about a real match; whether it holds is for the broadcast to show.
    CORNERS.forEach((corner, c) => {
      for (const fighter of ['claude', 'gpt'] as const) {
        const claim = corner[fighter].claim
        if (claim) expect(results.has(matchId(c - 1, claim.match - 1))).toBe(true)
      }
    })
  }, 120_000)

  it('each patch is a real diff of the bot before it', () => {
    for (const corner of CORNERS) {
      for (const fighter of ['claude', 'gpt'] as const) {
        const side = corner[fighter]
        if (!side.from) continue
        const stat = diffStat(diffLines(BOTS[side.from] ?? '', BOTS[side.bot] ?? ''))
        expect(stat.added + stat.removed).toBeGreaterThan(0)
      }
    }
  })
})
