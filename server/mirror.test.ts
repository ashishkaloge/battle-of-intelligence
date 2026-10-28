import { describe, expect, it } from 'vitest'
import type { Move } from '../src/games/forge/moves.ts'
import { checkPuzzle } from '../src/games/forge/solver.ts'
import { formatMove } from '../src/games/forge/syntax.ts'
import {
  boardOf,
  drawBases,
  LIMITS,
  parseTurnReply,
  playOf,
  recordTurns,
  turnPrompt,
} from '../src/games/mirror/live.ts'
import { type Base, playMatch } from '../src/games/mirror/versus.ts'
import type { Fighter } from '../src/games/ring/arena.ts'
import type { AskOptions, AskResult } from './cli.ts'
import { playMirror } from './mirror.ts'

type Script = (options: AskOptions) => AskResult

const text = (value: object): AskResult => ({
  text: JSON.stringify(value),
  seconds: 1,
  toolUse: [],
})
const bases = drawBases(2026, LIMITS.turns + 1)

/** A player who sees the true rule: the base move, then whatever its prompt says is stacked. */
const solver =
  (attack: string): Script =>
  (options) => {
    const turn = Number(/Turn (\d+) of/.exec(options.prompt)?.[1] ?? '1') - 1
    const base = bases[turn] as Base
    const stacked = /applied after the base move in this order: (.+)\.$/m.exec(options.prompt)?.[1]
    const rule = [formatMove(base.program[0] as Move), ...(stacked ? stacked.split(', ') : [])]
    return text({ think: 'I see it', rule, attack, attackThink: 'pressure' })
  }

/** Always answers a rule that leaves the grid as it is, which is never the answer. */
const blank: Script = () =>
  text({ think: 'no idea', rule: ['shift(up)', 'shift(down)'], attack: 'rotate(2)' })

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
  seed: 2026,
  bases,
}

describe('live Mirror puzzles, prompts and replies', () => {
  it('draws fair base puzzles from a seed, a different hidden move each turn', () => {
    expect(drawBases(2026, 6)).toEqual(bases)
    for (const b of bases) expect(checkPuzzle(b, 1).valid).toBe(true)
    expect(new Set(bases.map((b) => formatMove(b.program[0] as Move))).size).toBe(bases.length)
  })

  it('tells each side what is stacked on its own board and the rival’s', () => {
    const prompt = turnPrompt({
      me: 'gpt',
      turn: 2,
      base: bases[2] as Base,
      stacks: { claude: [], gpt: [{ op: 'mirror', axis: 'left-right' }] },
      clears: { claude: 2, gpt: 1 },
      limits: LIMITS,
      history: [],
    })
    expect(prompt).toContain('applied after the base move in this order: mirror(left-right).')
    expect(prompt).toContain("Nothing is stacked on Claude's board.")
    expect(prompt).toContain('Turn 3 of 5. Clears: you 1, Claude 2.')
  })

  it('reads a rule and an attack, and keeps the attack only for a clear', () => {
    const reply = parseTurnReply('{"think":"t","rule":["gravity(down)"],"attack":"rotate(1)"}')
    expect(reply.ok && reply.value.hypothesis).toEqual([{ op: 'gravity', dir: 'down' }])
    expect(parseTurnReply('{"rule":[]}').ok).toBe(false)
    expect(parseTurnReply('{"rule":["teleport(up)"]}').ok).toBe(false)
    const b = bases[0] as Base
    const board = boardOf(b, [])
    expect(
      playOf({ hypothesis: b.program as Move[], attack: { op: 'rotate', turns: 1 } }, board, b.test)
        .attack,
    ).toBeDefined()
    expect(
      playOf(
        { hypothesis: [{ op: 'shift', dir: 'up' }], attack: { op: 'rotate', turns: 1 } },
        board,
        b.test,
      ).attack,
    ).toBeUndefined()
  })
})

describe('the Mirror referee', () => {
  it('asks both every turn and saves verdicts the engine reproduces', async () => {
    const { ask, calls } = fake({
      claude: solver('gravity(left)'),
      gpt: solver('mirror(top-bottom)'),
    })
    const record = await playMirror({ ...base, ask })
    expect(calls.claude.length).toBe(record.turns.length)
    expect(record.result.turns.every((t) => t.answers.claude.right && t.answers.gpt.right)).toBe(
      true,
    )
    const replay = playMatch(
      record.bases,
      record.turns.map((t) => ({
        claude: {
          hypothesis: t.claude.hypothesis,
          ...(t.claude.attack ? { attack: t.claude.attack } : {}),
        },
        gpt: { hypothesis: t.gpt.hypothesis, ...(t.gpt.attack ? { attack: t.gpt.attack } : {}) },
      })),
      record.rules,
    )
    expect(replay).toEqual(record.result)
    const { turns, intro } = recordTurns({ ...record, id: 'x' })
    expect(turns).toHaveLength(record.result.turns.length)
    expect(intro.text).toContain('Claude Haiku 5.5 against GPT-6 Luna')
  }, 60_000)

  it('never lets a miss attack, and tops out the side that keeps missing', async () => {
    const { ask } = fake({ claude: solver('gravity(right)'), gpt: blank })
    const record = await playMirror({ ...base, ask })
    for (const t of record.turns) expect(t.gpt.attack).toBeUndefined()
    for (const t of record.result.turns) expect(t.answers.gpt.right).toBe(false)
    if (record.result.ko) expect(record.result.ko).toBe('gpt')
    expect(record.result.winner).toBe('claude')
  }, 60_000)

  it('turns an unusable reply into a miss the broadcast explains', async () => {
    const { ask } = fake({
      claude: () => ({ text: 'not sure', seconds: 1, toolUse: [] }),
      gpt: solver(''),
    })
    const record = await playMirror({ ...base, limits: { ...LIMITS, turns: 1 }, ask })
    expect(record.turns[0]?.claude.ruling).toBe('unusable')
    expect(record.result.turns[0]?.answers.claude.right).toBe(false)
    const { turns } = recordTurns({ ...record, id: 'x' })
    expect(turns[0]?.claude.think).toContain('no usable rule')
    expect(turns[0]?.line.text).toContain('GPT clears, Claude misses')
  }, 60_000)
})
