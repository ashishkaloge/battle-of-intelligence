import { describe, expect, it } from 'vitest'
import * as bluff from './bluff/live.ts'
import { newTable, startHand } from './bluff/table.ts'
import * as brawl from './brawl/live.ts'
import * as buzzer from './buzzer/live.ts'
import * as mirror from './mirror/live.ts'
import { initialState } from './ring/arena.ts'
import { makeDemoArena } from './ring/demo.ts'
import * as ring from './ring/live.ts'

const CANARY = 'UNSOLICITED_EXPLANATION_CANARY'
const bot = 'function move(state) { return "right" }'
const question = { text: 'What is two plus two?', answer: '4', accept: [] }
const table = newTable()
const status = startHand(table, 'claude').status()

describe('final-action provider protocol', () => {
  it('asks for game outputs without requesting explanations', () => {
    const base = mirror.drawBases(42, 1)[0]
    if (!base) throw new Error('missing test base')
    const prompts = [
      ring.turnPrompt({
        state: initialState(makeDemoArena()),
        me: 'claude',
        bout: 0,
        turn: 0,
        limits: ring.LIMITS,
        history: [],
      }),
      mirror.turnPrompt({
        me: 'claude',
        turn: 0,
        base,
        stacks: { claude: [], gpt: [] },
        clears: { claude: 0, gpt: 0 },
        limits: mirror.LIMITS,
        history: [],
      }),
      buzzer.turnPrompt({
        me: 'claude',
        problem: {
          text: 'What is two plus two?',
          answer: 4,
          hints: ['Two pairs.', '2+2.', 'Four.'],
        },
        tossup: 0,
        reveal: 0,
        double: false,
        score: { claude: 0, gpt: 0 },
        rivalOut: null,
        limits: buzzer.LIMITS,
        history: [],
      }),
      bluff.holePrompt({
        me: 'claude',
        question,
        hand: 0,
        table,
        limits: bluff.LIMITS,
        history: [],
      }),
      bluff.actPrompt({
        me: 'claude',
        question,
        hand: 0,
        hole: { answer: '4', confidence: 90, think: '' },
        status,
        done: [],
        limits: bluff.LIMITS,
        history: [],
      }),
      brawl.buildPrompt('claude', brawl.LIMITS),
      brawl.patchPrompt({
        me: 'claude',
        bout: 1,
        limits: brawl.LIMITS,
        code: bot,
        version: 1,
        reports: [],
        score: { claude: 0, gpt: 0 },
      }),
      brawl.verdictPrompt({ me: 'claude', version: 1, tests: [], labels: {} }),
    ]
    for (const prompt of prompts) {
      expect(prompt).not.toMatch(
        /"(?:think|attackThink|note|verdict|text)"|your (?:reasoning|working|plan)|why that attack|what you decide and why/,
      )
    }
  })

  it('ignores unsolicited explanation fields while retaining final game outputs', () => {
    const replies = [
      ring.parseMoveReply(JSON.stringify({ move: 'left', think: CANARY })),
      mirror.parseTurnReply(
        JSON.stringify({
          rule: ['rotate(1)'],
          attack: 'shift(up)',
          think: CANARY,
          attackThink: CANARY,
        }),
      ),
      buzzer.parseTurnReply(JSON.stringify({ action: 'buzz', answer: 4, think: CANARY })),
      bluff.parseHoleReply(JSON.stringify({ answer: '4', confidence: 90, think: CANARY })),
      bluff.parseActReply(JSON.stringify({ action: 'pass', think: CANARY }), 'claude', status),
      brawl.parseBuildReply(`${JSON.stringify({ note: CANARY })}\n\`\`\`js\n${bot}\n\`\`\``),
      brawl.parsePatchReply(
        `${JSON.stringify({ note: CANARY, claim: { match: 1, cause: 'wall', text: CANARY } })}\n\`\`\`js\n${bot}\n\`\`\``,
        1,
      ),
      brawl.parseVerdictReply(JSON.stringify({ ship: true, verdict: CANARY })),
    ]
    for (const reply of replies) {
      expect(reply.ok).toBe(true)
      expect(JSON.stringify(reply)).not.toContain(CANARY)
    }
  })
})

const first = <T>(records: Record<string, T>): T => {
  const record = Object.values(records)[0]
  if (!record) throw new Error('missing saved fight fixture')
  return record
}

/** Inject legacy explanation fields without changing any move, code or result. */
function legacy<T>(record: T): T {
  const copy = structuredClone(record)
  const visit = (value: unknown, parent = '') => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (
        ['think', 'attackThink', 'reasoning', 'note', 'verdict'].includes(key) ||
        (parent === 'claim' && key === 'text')
      ) {
        ;(value as Record<string, unknown>)[key] = CANARY
      } else visit(child, key)
    }
  }
  visit(copy)
  const object = copy as Record<string, unknown>
  object.commentary = Object.fromEntries(
    [
      'b1-bell',
      'b1-replay',
      'b1-t1',
      'mirror-intro',
      'mirror-t1',
      'buzzer-intro',
      'buzzer-t1',
      'bluff-intro',
      'bluff-h1',
      'brawl-intro',
      'brawl-c0',
    ].map((key) => [key, { voice: 'play', text: CANARY }]),
  )
  delete object.commentaryProtocol
  return copy
}

describe('legacy recording playback', () => {
  it('derives all five broadcasts from actions without replaying stored explanations', () => {
    const outputs = [
      ring.recordBouts(
        legacy(
          first(
            import.meta.glob<ring.RingRecord>('./ring/fights/*.json', {
              eager: true,
              import: 'default',
            }),
          ),
        ),
      ),
      mirror.recordTurns(
        legacy(
          first(
            import.meta.glob<mirror.MirrorRecord>('./mirror/fights/*.json', {
              eager: true,
              import: 'default',
            }),
          ),
        ),
      ),
      buzzer.recordTossups(
        legacy(
          first(
            import.meta.glob<buzzer.BuzzerRecord>('./buzzer/fights/*.json', {
              eager: true,
              import: 'default',
            }),
          ),
        ),
      ),
      bluff.recordHands(
        legacy(
          first(
            import.meta.glob<bluff.BluffRecord>('./bluff/fights/*.json', {
              eager: true,
              import: 'default',
            }),
          ),
        ),
      ),
      brawl.recordSchedule(
        legacy(
          first(
            import.meta.glob<brawl.BrawlRecord>('./brawl/fights/*.json', {
              eager: true,
              import: 'default',
            }),
          ),
        ),
      ),
    ]
    for (const output of outputs) expect(JSON.stringify(output)).not.toContain(CANARY)
  })
})
