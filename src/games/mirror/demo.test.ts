import { describe, expect, it } from 'vitest'
import { colorsIn } from '../forge/grid.ts'
import { checkPuzzle } from '../forge/solver.ts'
import { buildBases, playScript, TURNS } from './demo.ts'

describe('the scripted Mirror', () => {
  const { bases, turns, ko, winner } = playScript()

  it('every base puzzle is fair on its own', () => {
    for (const base of bases) expect(checkPuzzle(base, 1).valid).toBe(true)
  })

  it('plays out exactly as the commentary says', () => {
    const outcome = turns.map(
      (t) => `${t.answers.claude.right ? 'C' : 'c'}${t.answers.gpt.right ? 'G' : 'g'}`,
    )
    // Uppercase is a clear, lowercase a miss.
    expect(outcome).toEqual(['CG', 'Cg', 'CG', 'cG', 'cG'])
    // Turn 3: "Claude led three clears to two."
    expect(turns[2]?.clears).toEqual({ claude: 3, gpt: 2 })
    // Turn 4: "Two attacks are stacked on Claude now."
    expect(turns[3]?.stacks.claude).toHaveLength(2)
    // Turn 5: the third attack tops Claude out.
    expect(ko).toBe('claude')
    expect(winner).toBe('gpt')
    expect(turns).toHaveLength(TURNS.length)
  })

  it('the blocked attack is blocked for the reason Cori gives', () => {
    const blocked = turns[2]?.attacks.claude
    expect(blocked).toMatchObject({ landed: false, reason: 'ambiguous' })
    // "A colour that only appears in GPT's test grid, so no example could reveal it."
    const target = buildBases()[3]
    const shownInExamples = new Set(target?.examples.flatMap((g) => [...colorsIn(g)]))
    expect(blocked?.move).toMatchObject({ op: 'recolor', from: 1 })
    expect(shownInExamples.has(1)).toBe(false)
    expect(target && colorsIn(target.test).has(1)).toBe(true)
  })

  it('every attack that landed was proven fair, and every miss is a visibly wrong grid', () => {
    for (const turn of turns) {
      for (const attack of Object.values(turn.attacks)) {
        if (attack && !attack.landed) expect(attack.reason).toBeTruthy()
      }
      for (const answer of Object.values(turn.answers)) {
        if (!answer.right) expect(answer.grid).not.toBeNull()
      }
    }
  })
})
