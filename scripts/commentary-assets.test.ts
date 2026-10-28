import { existsSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { demoLines as bluffLines } from '../src/games/bluff/demo.ts'
import { demoLines as brawlLines } from '../src/games/brawl/demo.ts'
import { demoLines as buzzerLines } from '../src/games/buzzer/demo.ts'
import { lineFile } from '../src/games/commentary.ts'
import { demoLines as mirrorLines } from '../src/games/mirror/demo.ts'
import { demoLines as ringLines } from '../src/games/ring/demo.ts'
import { fightLines } from './fights.ts'

describe('packaged commentary', () => {
  it('ships a nonempty recording matching every current demo line and voice setting', () => {
    const lines = [
      ...ringLines(),
      ...brawlLines(),
      ...bluffLines(),
      ...buzzerLines(),
      ...mirrorLines(),
      ...fightLines(),
    ]
    expect(lines.length).toBeGreaterThan(0)
    for (const { id, line } of lines) {
      const file = lineFile(id, line)
      const path = new URL(`../public/voice/${file}`, import.meta.url)
      expect(existsSync(path), `Missing recording for ${id}: ${file}; run pnpm voices`).toBe(true)
      expect(statSync(path).size, `Empty recording: ${file}`).toBeGreaterThan(0)
    }
  })
})
