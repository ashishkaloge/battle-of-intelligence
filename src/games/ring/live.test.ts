import { describe, expect, it } from 'vitest'
import {
  CONTACT_RULES,
  type Fighter,
  idx,
  initialState,
  type Move,
  type RingState,
  resolveTurn,
  winner,
} from './arena.ts'
import { DEMO, makeDemoArena } from './demo.ts'
import { makeCrossroads } from './floors.ts'
import {
  boardText,
  type CornerTurn,
  highlightOf,
  LIMITS,
  moveGuide,
  parseMoveReply,
  type RecordTurn,
  type RingRecord,
  recordBouts,
  replayRecord,
  templateCommentary,
  turnPrompt,
} from './live.ts'

const played = (move: Move, think = 'plan'): CornerTurn => ({
  move,
  think,
  ruling: 'played',
  seconds: 1,
  calls: 1,
})

/** A record of the scripted demo's moves, as if two models had played them. */
function demoRecord(): RingRecord {
  return {
    version: 1,
    id: 'test-fight',
    playedAt: '2026-10-23T10:00:00.000Z',
    models: {
      claude: { name: 'Claude Haiku 5.5', id: 'claude-haiku-5-5' },
      gpt: { name: 'GPT-6 Luna', id: 'gpt-6-luna' },
    },
    effort: { claude: 'low', gpt: 'low' },
    limits: LIMITS,
    arena: makeDemoArena(),
    bouts: DEMO.map((bout) =>
      bout.turns.map(
        (turn): RecordTurn => ({
          claude: played(turn.claude.move, turn.claude.think),
          gpt: played(turn.gpt.move, turn.gpt.think),
        }),
      ),
    ),
    end: {
      reason: 'ko',
      winner: 'gpt',
      score: { claude: 0, gpt: 0 },
      knockdowns: { claude: 3, gpt: 1 },
    },
    calls: { claude: 23, gpt: 23 },
    seconds: 600,
  }
}

describe('the turn prompt', () => {
  const arena = makeDemoArena()
  const state = initialState(arena)

  /** The floor map's rows, without the paint map below it. */
  const floor = (s: RingState, me: Fighter) =>
    boardText(s, me)
      .split('\n\n')[0]
      ?.split('\n')
      .filter((row) => row.startsWith('y=')) ?? []

  it('hides tiles nobody has set off', () => {
    const rows = floor(state, 'claude').join('\n')
    expect(rows).not.toMatch(/[!<>^vo]/)
    expect(rows).toContain('#')
  })

  it('shows a tile once it has been found, and what a fighter stands on', () => {
    let s = state
    for (let i = 0; i < 3; i++) s = resolveTurn(s, { claude: 'right', gpt: 'left' }).state
    expect(s.revealed[idx(arena, { x: 3, y: 2 })]).toBe(true)
    const prompt = turnPrompt({
      state: s,
      me: 'claude',
      bout: 0,
      turn: 3,
      limits: LIMITS,
      history: [],
    })
    expect(prompt).toContain('You are at (3,2) (on a belt pointing right)')
    s = resolveTurn(s, { claude: 'up', gpt: 'down' }).state
    const rows = floor(s, 'claude').join('\n')
    expect(rows).toContain('y=2  . . . > * < . . .')
    expect(rows).not.toContain('!')
  })

  it('draws each fighter from its own side', () => {
    expect(floor(state, 'claude')[2]).toBe('y=2  Y . . . * . . . X')
    expect(floor(state, 'gpt')[2]).toBe('y=2  X . . . * . . . Y')
  })

  it('gives both corners the same words apart from their own point of view', () => {
    const ask = (me: Fighter) =>
      turnPrompt({ state, me, bout: 0, turn: 0, limits: LIMITS, history: [] })
    const claude = ask('claude')
    const gpt = ask('gpt')
    expect(claude).toContain('You are Claude, fighting GPT')
    expect(gpt).toContain('You are GPT, fighting Claude')
    // The rules, word for word, once each side's own name is swapped out.
    const rules = (text: string, me: string, them: string) =>
      text.split('Floor:')[0]?.replaceAll(me, 'ME').replaceAll(them, 'THEM')
    expect(rules(claude, 'Claude', 'GPT')).toBe(rules(gpt, 'GPT', 'Claude'))
    expect(claude).toContain('Bout 1 of 3, turn 1 of 8.')
    expect(claude).toContain('Do not use any tools')
  })

  it('warns when the opponent is down and cannot be shoved', () => {
    const down = {
      ...state,
      fighters: { ...state.fighters, gpt: { ...state.fighters.gpt, stunned: 1 } },
    }
    const prompt = turnPrompt({
      state: down,
      me: 'claude',
      bout: 0,
      turn: 2,
      limits: LIMITS,
      history: [],
    })
    expect(prompt).toContain('GPT is down this turn')
  })
})

describe('the contact rules in the prompt', () => {
  const ask = (state: RingState) =>
    turnPrompt({ state, me: 'claude', bout: 0, turn: 0, limits: LIMITS, history: [] })

  it('spells out the bounty and the slams only when they are on', () => {
    const classic = ask(initialState(makeDemoArena()))
    const contact = ask(initialState(makeDemoArena(), CONTACT_RULES))
    expect(classic).not.toContain('bounty')
    expect(classic).toContain('If something blocks the push, nobody moves.')
    expect(contact).toContain('The center is a bounty.')
    expect(contact).toContain('GPT is slammed into it and knocked down')
    expect(contact).toContain("Bounty on the center: yours 0, GPT's 0.")
  })
})

describe('the move guide', () => {
  /** Crossroads after the opening rush: Claude holds the center, GPT stands above it. */
  function standoff() {
    let state = initialState(makeCrossroads(), CONTACT_RULES)
    for (const [claude, gpt] of [
      ['right', 'left'],
      ['right', 'left'],
      ['right', 'up'],
      ['wait', 'left'],
    ] as const) {
      state = resolveTurn(state, { claude, gpt }).state
    }
    return state
  }
  const line = (guide: string[], move: string) => guide.find((l) => l.startsWith(`- ${move}:`))

  it('never names a tile nobody has found', () => {
    const start = initialState(makeCrossroads(), CONTACT_RULES)
    const next = resolveTurn(start, { claude: 'right', gpt: 'left' }).state
    // The belt at (2,2) is one step away, but nobody has set it off.
    expect(line(moveGuide(next, 'claude'), 'right')).toBe(
      '- right: to (2,2), unexplored, unpainted, +1.',
    )
    // GPT above the center sits next to the hidden trap at (4,0); it is unexplored too.
    expect(line(moveGuide(standoff(), 'gpt'), 'up')).toBe(
      '- up: to (4,0), unexplored, unpainted, +1.',
    )
  })

  it('describes a found belt and where it carries you', () => {
    const start = initialState(makeCrossroads(), CONTACT_RULES)
    const next = resolveTurn(start, { claude: 'right', gpt: 'left' }).state
    // Someone has already set off the belt at (2,2).
    const found = { ...next, revealed: next.revealed.map((r, i) => r || i === 2 * 9 + 2) }
    expect(line(moveGuide(found, 'claude'), 'right')).toBe(
      '- right: to (2,2), a found belt pointing right, which carries you on to (3,2).',
    )
  })

  it('spells out a shove on the center holder, and the danger of staying put', () => {
    const state = standoff()
    expect(line(moveGuide(state, 'gpt'), 'down')).toBe(
      "- down: into Claude. If Claude stays put, it is shoved to (4,3): a takedown, +2 to you, and you take the center and Claude's bounty of 2. If Claude steps toward you, you collide.",
    )
    expect(line(moveGuide(state, 'claude'), 'wait')).toBe(
      '- wait: stay at (4,2), +1 for the center. If GPT steps into you, you are shoved to (4,3): a takedown, +2 to GPT, and you lose your bounty of 2.',
    )
  })

  it('warns of a found trap or the ropes behind a fighter', () => {
    let state = standoff()
    state = { ...state, revealed: state.revealed.map((r, i) => r || i === 4) }
    expect(line(moveGuide(state, 'gpt'), 'wait')).toBe(
      '- wait: stay at (4,1). If Claude steps into you, you are shoved onto the found trap at (4,0): a takedown and a knockdown.',
    )
    const ropes = {
      ...state,
      fighters: {
        claude: { ...state.fighters.claude, pos: { x: 7, y: 2 } },
        gpt: { ...state.fighters.gpt, pos: { x: 8, y: 2 } },
      },
    }
    expect(line(moveGuide(ropes, 'claude'), 'right')).toContain(
      'If GPT stays put, it is slammed into the ropes: a knockdown',
    )
  })

  it('is part of every turn prompt', () => {
    const prompt = turnPrompt({
      state: standoff(),
      me: 'gpt',
      bout: 0,
      turn: 4,
      limits: LIMITS,
      history: [],
    })
    expect(prompt).toContain('Your moves, worked out from what is known')
    expect(prompt).toContain('- down: into Claude.')
  })
})

describe('reading a reply', () => {
  it('takes a clean JSON reply', () => {
    const reply = parseMoveReply('{"move":"Left","think":"Take the center.","say":"Mine."}')
    expect(reply).toEqual({
      ok: true,
      value: { move: 'left', think: 'Moves left.', say: 'Mine.' },
    })
  })

  it('finds the JSON inside prose and a code fence', () => {
    const reply = parseMoveReply('Here we go:\n```json\n{"move":"wait","think":"Hold."}\n```')
    expect(reply.ok && reply.value.move).toBe('wait')
  })

  it('rejects a move that is not one of the five', () => {
    expect(parseMoveReply('{"move":"jump"}').ok).toBe(false)
    expect(parseMoveReply('I will go left.').ok).toBe(false)
  })

  it('ignores unsolicited explanations and clips long taunts at a word', () => {
    const reply = parseMoveReply(
      JSON.stringify({
        move: 'up',
        think: 'word '.repeat(80),
        say: 'a very long taunt '.repeat(5),
      }),
    )
    if (!reply.ok) throw new Error(reply.error)
    expect(reply.value.think).toBe('Moves up.')
    expect(reply.value.say.length).toBeLessThanOrEqual(41)
  })
})

describe('saved fights', () => {
  const saved = import.meta.glob<RingRecord>('./fights/*.json', { eager: true, import: 'default' })

  it('calls a repeated collision once, acknowledges the repeat, then lets it play quietly', () => {
    const record = Object.values(saved).find((fight) => fight.id === 'broadcast-launch-2-ring')
    if (!record) throw new Error('The launch recording is missing')
    const bouts = recordBouts(record)
    const first = bouts[0]
    expect(first?.turns.slice(4).map((turn) => turn.line?.text)).toEqual([
      'They collide and bounce back.',
      'Same moves, same collision.',
      undefined,
      undefined,
    ])
    expect(first?.skipReplay).toBe(true)
    expect(
      bouts.map((bout) => bout.turns.map(({ claude, gpt }) => [claude.move, gpt.move])),
    ).toEqual(record.bouts.map((bout) => bout.map(({ claude, gpt }) => [claude.move, gpt.move])))
  })

  it('keeps highlights for knockouts, bounties, knockdowns and successful shoves', () => {
    for (const record of Object.values(saved)) {
      const bouts = recordBouts(record)
      replayRecord(record).forEach((turns, index) => {
        const decisive = turns.some((turn) =>
          turn.events.some(
            (event) =>
              event.type === 'ko' ||
              event.type === 'bounty' ||
              event.type === 'knockdown' ||
              (event.type === 'shove' && !event.pinned),
          ),
        )
        if (decisive) expect(bouts[index]?.skipReplay, record.id).toBe(false)
      })
    }
  })

  it('each replays to the result it recorded, under the rules it was played with', () => {
    expect(Object.keys(saved).length).toBeGreaterThan(0)
    for (const record of Object.values(saved)) {
      const end = replayRecord(record).flat().at(-1)?.after
      expect(end?.fighters.claude.score, record.id).toBe(record.end.score.claude)
      expect(end?.fighters.gpt.score, record.id).toBe(record.end.score.gpt)
      expect(end?.fighters.claude.knockdowns, record.id).toBe(record.end.knockdowns.claude)
      expect(end?.fighters.gpt.knockdowns, record.id).toBe(record.end.knockdowns.gpt)
      if (end) expect(winner(end), record.id).toBe(record.end.winner)
    }
  })
})

describe('a saved fight', () => {
  const record = demoRecord()

  it('skips the automatic replay when a bout has no highlight', () => {
    const quiet = {
      ...record,
      bouts: [[{ claude: played('wait'), gpt: played('wait') }]],
    }
    expect(recordBouts(quiet)[0]?.skipReplay).toBe(true)
  })

  it('replays to the same knockout the demo reaches', () => {
    const bouts = replayRecord(record)
    const last = bouts.at(-1)?.at(-1)
    expect(last?.after.ko).toBe('claude')
  })

  it('picks the knockout as the last bout highlight', () => {
    const bouts = replayRecord(record)
    const final = bouts.at(-1) ?? []
    expect(highlightOf(final)).toBe(final.length - 1)
  })

  it('calls the knockout from the events alone', () => {
    const lines = templateCommentary(record)
    expect(lines['b3-t7']?.text).toContain('Knockout')
    expect(lines['b1-bell']?.text).toContain('Claude Haiku 5.5')
    expect(lines['b1-replay']?.voice).toBe('color')
  })

  it('calls simultaneous knockouts a draw', () => {
    const state = initialState(makeDemoArena())
    const lines = templateCommentary(record, [
      [
        {
          before: state,
          after: state,
          sides: { claude: played('right'), gpt: played('left') },
          events: [
            { type: 'ko', fighter: 'claude' },
            { type: 'ko', fighter: 'gpt' },
          ],
        },
      ],
    ])
    expect(lines['b1-t1']?.text).toContain('double knockout')
    expect(lines['b1-t1']?.text).toContain('draw')
  })

  it('plays in the demo shape, with the referee marked where it decided', () => {
    const late: RingRecord = {
      ...record,
      bouts: [[{ claude: { ...played('wait', ''), ruling: 'late' }, gpt: played('left') }]],
    }
    const [bout] = recordBouts(late)
    expect(bout?.turns[0]?.claude.flag).toBe('Shot clock')
    expect(bout?.turns[0]?.gpt.flag).toBeUndefined()
    expect(bout?.bell.text).toContain('Welcome')
  })

  it('uses only action-protocol commentary for the turns it calls', () => {
    const written = {
      ...record,
      commentaryProtocol: 'actions-v1' as const,
      commentary: { 'b1-t5': { voice: 'play' as const, text: 'Shove!' } },
    }
    const [bout] = recordBouts(written)
    expect(bout?.turns[4]?.line?.text).toBe('Shove!')
    expect(bout?.turns.filter((turn) => turn.line)).toHaveLength(1)
  })
})
