import { describe, expect, it } from 'vitest'
import type { Grid } from '../forge/grid.ts'
import type { Move } from '../forge/moves.ts'
import { type Base, IllegalPlay, LIVE_RULES, playMatch, TOP_OUT } from './versus.ts'

// Small asymmetric grids so flips and gravity are visible and rules are unambiguous.
const A: Grid = [
  [1, 0, 0],
  [0, 0, 2],
  [0, 0, 0],
]
const B: Grid = [
  [0, 2, 0],
  [1, 0, 0],
  [0, 0, 0],
]
const C: Grid = [
  [0, 0, 1],
  [0, 0, 0],
  [2, 0, 0],
]
const T: Grid = [
  [2, 0, 1],
  [0, 0, 0],
  [0, 1, 0],
]
const base = (move: Move): Base => ({ program: [move], examples: [A, B, C], test: T })
const down: Move = { op: 'gravity', dir: 'down' }
const flip: Move = { op: 'mirror', axis: 'left-right' }

describe('versus', () => {
  it('blocks a retained attack that works next turn but cannot apply to a later base', () => {
    const diagonal: Move = { op: 'mirror', axis: 'diagonal' }
    const rectangle: Base = {
      program: [down],
      examples: [A, B, C].map((grid) => grid.slice(0, 2)),
      test: T.slice(0, 2),
    }
    const bases = [base(down), base(down), rectangle]
    const first = { claude: { hypothesis: [down], attack: diagonal }, gpt: { hypothesis: [] } }
    // The old rule accepted this attack, then crashed once a miss carried it to the rectangle.
    expect(playMatch(bases, [first]).turns[0]?.attacks.claude?.landed).toBe(true)
    expect(() =>
      playMatch(bases, [
        first,
        ...Array.from({ length: 2 }, () => ({
          claude: { hypothesis: [] },
          gpt: { hypothesis: [] },
        })),
      ]),
    ).toThrow(IllegalPlay)
    const result = playMatch(
      bases,
      [
        first,
        ...Array.from({ length: 2 }, () => ({
          claude: { hypothesis: [] },
          gpt: { hypothesis: [] },
        })),
      ],
      LIVE_RULES,
    )
    expect(result.turns).toHaveLength(3)
    expect(result.turns[0]?.attacks.claude).toMatchObject({
      landed: false,
      reason: 'cannot-apply',
    })
    expect(result.turns.every((turn) => turn.stacks.gpt.length === 0)).toBe(true)
  })

  it('a clear wipes your garbage and lets you attack; a miss keeps it', () => {
    const { turns } = playMatch(
      [base(down), base(down), base(down)],
      [
        { claude: { hypothesis: [down], attack: flip }, gpt: { hypothesis: [down] } },
        { claude: { hypothesis: [down] }, gpt: { hypothesis: [down] } },
      ],
    )
    expect(turns[0]?.stacks).toEqual({ claude: [], gpt: [flip] })
    // GPT ignored the flip on turn 2, so it missed and kept its garbage.
    expect(turns[1]?.answers.gpt.right).toBe(false)
    expect(turns[1]?.stacks.gpt).toEqual([flip])
    expect(turns[1]?.clears).toEqual({ claude: 2, gpt: 1 })
  })

  it('only a model that cleared can attack', () => {
    expect(() =>
      playMatch(
        [base(down), base(down)],
        [{ claude: { hypothesis: [flip], attack: flip }, gpt: { hypothesis: [down] } }],
      ),
    ).toThrow(IllegalPlay)
  })

  it('an attack that would make the next puzzle ambiguous is blocked', () => {
    // Colour 7 never appears anywhere, so recoloring it changes nothing the examples can show.
    const invisible: Move = { op: 'recolor', from: 1, to: 7 }
    const hidden: Base = {
      program: [down],
      examples: [
        [
          [2, 0],
          [0, 0],
        ],
        [
          [0, 2],
          [0, 0],
        ],
      ],
      test: [
        [1, 0],
        [0, 0],
      ],
    }
    const { turns } = playMatch(
      [base(down), hidden],
      [{ claude: { hypothesis: [down], attack: invisible }, gpt: { hypothesis: [down] } }],
    )
    expect(turns[0]?.attacks.claude).toMatchObject({ landed: false })
    expect(turns[0]?.stacks.gpt).toEqual([])
  })

  it(`the ${TOP_OUT}rd stacked attack is a knockout`, () => {
    const bases = [base(down), base(down), base(down), base(down)]
    // GPT keeps answering the bare base rule, so every attack sent at it stays stacked.
    const { ko, winner, turns } = playMatch(bases, [
      { claude: { hypothesis: [down], attack: flip }, gpt: { hypothesis: [flip] } },
      {
        claude: { hypothesis: [down], attack: { op: 'recolor', from: 1, to: 3 } },
        gpt: { hypothesis: [down] },
      },
      {
        claude: { hypothesis: [down], attack: { op: 'mirror', axis: 'top-bottom' } },
        gpt: { hypothesis: [down] },
      },
    ])
    expect(turns.at(-1)?.stacks.gpt).toHaveLength(TOP_OUT)
    expect(ko).toBe('gpt')
    expect(winner).toBe('claude')
  })
})
