import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  LIMITS,
  parseBuildReply,
  parsePatchReply,
  parseVerdictReply,
  recordSchedule,
} from '../src/games/brawl/live.ts'
import { makeMap } from '../src/games/brawl/maps.ts'
import { playMatch } from '../src/games/brawl/match.ts'
import { loadQuickJS } from '../src/games/brawl/sandbox.ts'
import { type Fighter, other } from '../src/games/ring/arena.ts'
import { playBrawl } from './brawl.ts'
import type { AskOptions, AskResult } from './cli.ts'

const greedy = readFileSync(
  new URL('../src/games/brawl/bots/house-greedy.js', import.meta.url),
  'utf8',
)
const hugger = readFileSync(
  new URL('../src/games/brawl/bots/house-hugger.js', import.meta.url),
  'utf8',
)
const broken = 'function move(s) {\n  return s.nothing.here\n}\n'

const reply = (meta: object, code?: string): AskResult => ({
  text: `${JSON.stringify(meta)}\n${code ? `\`\`\`js\n${code}\n\`\`\`` : ''}`,
  seconds: 1,
  toolUse: [],
})

type Script = (options: AskOptions) => AskResult

/** A model that writes `code`, claims a wall each corner, and ships whatever its tests say. */
const coder =
  (code: string, fix?: string): Script =>
  (options) => {
    if (options.prompt.includes('The referee tested your bot')) {
      return fix && options.prompt.includes('crashed')
        ? reply({ verdict: 'Fixing the crash.', ship: false }, fix)
        : reply({ verdict: 'Shipping it.', ship: true })
    }
    if (options.prompt.includes('Submit the ending cause of one match')) {
      return reply({ claim: { match: 1, cause: 'wall', text: 'Walled in.' }, note: 'Patch' }, code)
    }
    return reply({ note: 'Plan' }, code)
  }

function fake(scripts: Record<Fighter, Script>) {
  const calls: Record<Fighter, AskOptions[]> = { claude: [], gpt: [] }
  const ask = async (options: AskOptions) => {
    calls[options.lab].push(options)
    return scripts[options.lab](options)
  }
  return { ask, calls }
}

const base = {
  tier: 'third' as const,
  effort: { claude: 'low', gpt: 'low' },
  signal: new AbortController().signal,
  seed: 77,
}

describe('live Bot Brawl replies', () => {
  it('reads a bot from its code block and the rest from the JSON', () => {
    const ok = parseBuildReply(`{"note":"go"}\n\`\`\`js\n${greedy}\n\`\`\``)
    expect(ok.ok && ok.value.code).toContain('function move')
    expect(parseBuildReply('{"note":"no code"}').ok).toBe(false)
    expect(parseBuildReply('```js\nconst x = 1\n```').ok).toBe(false)
    const patch = parsePatchReply(
      `{"claim":{"match":2,"cause":"own-trail","text":"t"}}\n\`\`\`js\n${greedy}\n\`\`\``,
      3,
    )
    expect(patch.ok && patch.value.claim).toEqual({
      match: 2,
      cause: 'own-trail',
      text: 'Match 2: own trail.',
    })
    expect(
      parsePatchReply(`{"claim":{"match":9,"cause":"wall"}}\n\`\`\`js\n${greedy}\n\`\`\``, 3).ok,
    ).toBe(false)
    expect(parseVerdictReply('{"verdict":"fine","ship":true}')).toEqual({
      ok: true,
      value: { verdict: 'Ships the tested bot.', code: null },
    })
    expect(parseVerdictReply('{"verdict":"fix","ship":false}').ok).toBe(false)
  })
})

describe('the Bot Brawl referee', () => {
  it('builds, tests, patches and fights, and the record replays to the same results', async () => {
    const { ask, calls } = fake({ claude: coder(greedy), gpt: coder(hugger) })
    const record = await playBrawl({ ...base, ask })
    expect(record.corners).toHaveLength(3)
    expect(calls.claude).toHaveLength(6)
    expect(record.corners[1]?.claude.claim).toEqual({
      match: 1,
      cause: 'wall',
      text: 'Match 1: wall.',
    })
    expect(record.corners[2]?.gpt.from).toBe('gpt-2')
    for (const bout of record.bouts) {
      const wins = { claude: 0, gpt: 0 }
      for (const m of bout.matches) if (m.winner) wins[m.winner] += 1
      expect(
        Math.max(wins.claude, wins.gpt) >= LIMITS.matchesToWin ||
          bout.matches.length === LIMITS.maxMatches,
      ).toBe(true)
    }

    // The browser replays the record from its code and seeds; it must see what the referee saw.
    const qjs = await loadQuickJS()
    const { jobs, bouts } = recordSchedule({ ...record, id: 'x' })
    for (const job of jobs.filter((j) => j.id.startsWith('b'))) {
      const played = playMatch(qjs, makeMap(job.seed, job.flip), job.rules, {
        claude: record.code[job.bots.claude] ?? '',
        gpt: record.code[job.bots.gpt] ?? '',
      })
      const [b, m] = job.id.slice(1).split('-m').map(Number)
      const expected = bouts[b ?? 0]?.matches[m ?? 0]?.expect
      expect(played.winner).toBe(expected?.winner)
      if (played.winner) expect(played.crashes[other(played.winner)]?.cause).toBe(expected?.cause)
    }
  }, 120_000)

  it('shows a crashing test to the model and takes its fix', async () => {
    const { ask } = fake({ claude: coder(broken, greedy), gpt: coder(hugger) })
    const record = await playBrawl({ ...base, ask })
    const build = record.corners[0]?.claude
    expect(build?.fixed).toBe(true)
    expect(build?.tests.every((t) => t.expect !== 'crash')).toBe(true)
    expect(record.code['claude-1']).toContain('around')
  }, 120_000)

  it('aborts a named broadcast when provider access fails during a test verdict', async () => {
    const { ask, calls } = fake({
      claude: (options) => {
        if (options.prompt.includes('The referee tested your bot')) throw new Error('unavailable')
        return coder(greedy)(options)
      },
      gpt: coder(hugger),
    })
    await expect(playBrawl({ ...base, ask, abortOnProviderError: true })).rejects.toThrow(
      'claude provider unavailable; broadcast round not saved',
    )
    expect(calls.claude).toHaveLength(3)
    expect(calls.gpt).toHaveLength(2)
  })

  it('fields a stand-in when no usable bot arrives at the build', async () => {
    const { ask } = fake({
      claude: () => ({ text: 'I would rather not', seconds: 1, toolUse: [] }),
      gpt: coder(greedy),
    })
    const record = await playBrawl({ ...base, ask })
    expect(record.corners[0]?.claude.ruling).toBe('unusable')
    expect(record.code['claude-1']).toContain("referee's stand-in")
    expect(record.end.winner).toBe('gpt')
    const { corners } = recordSchedule({ ...record, id: 'x' })
    expect(corners[0]?.claude.note).toContain('No usable bot')
  }, 120_000)
})
