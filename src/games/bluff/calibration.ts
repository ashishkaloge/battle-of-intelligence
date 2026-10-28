import type { Fighter } from '../ring/arena.ts'
import type { ScriptedHand } from './demo.ts'
import { isRight } from './table.ts'

export type Calibration = {
  /** Each hand: how sure the model said it was, and whether its private answer was right. */
  points: { hand: number; confidence: number; right: boolean }[]
  /** Average stated confidence, in percent. */
  said: number
  /** Share of private answers that were right, in percent. */
  right: number
  hits: number
}

/** How sure a model said it was, against how often it was actually right. */
export function calibrate(hands: readonly ScriptedHand[], fighter: Fighter): Calibration {
  const points = hands.flatMap((hand, h) =>
    hand.hole[fighter].submitted === false
      ? []
      : [
          {
            hand: h + 1,
            confidence: hand.hole[fighter].confidence,
            right: isRight(hand.question, hand.hole[fighter].answer),
          },
        ],
  )
  const hits = points.filter((p) => p.right).length
  const said = points.reduce((sum, p) => sum + p.confidence, 0) / Math.max(1, points.length)
  return { points, said, right: (100 * hits) / Math.max(1, points.length), hits }
}
