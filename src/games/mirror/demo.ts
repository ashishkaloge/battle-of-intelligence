import type { Line } from '../commentary.ts'
import type { Move } from '../forge/moves.ts'
import { generatePool } from '../forge/pool.ts'
import type { Fighter } from '../ring/arena.ts'
import { type Base, type Play, playMatch } from './versus.ts'

/**
 * The scripted Mirror. The puzzles are real: seeded grids from Forge's pool, and every attack that
 * lands is proven fair by Forge's solver when the match is played. What is written by hand is the
 * rule each model believes, the attack it picks, what it thinks, and the commentary. The demo test
 * replays the match and checks every beat the commentary describes.
 */

/** Each turn's base puzzle: a seed for the grids and one hidden move. */
const BASES: readonly { seed: number; move: Move }[] = [
  { seed: 500, move: { op: 'gravity', dir: 'down' } },
  { seed: 501, move: { op: 'extend', dir: 'right' } },
  { seed: 502, move: { op: 'mirror', axis: 'top-bottom' } },
  { seed: 505, move: { op: 'rotate', turns: 1 } },
  { seed: 506, move: { op: 'extend', dir: 'down' } },
]

export function buildBases(): Base[] {
  return BASES.map(({ seed, move }) => {
    const pool = generatePool(seed, 6)
    const [a, b, c, test] = pool
    if (!a || !b || !c || !test) throw new Error(`pool ${seed} is too small`)
    return { program: [move], examples: [a, b, c], test }
  })
}

export type ScriptedSide = Play & { think: string; attackThink?: string }
export type ScriptedTurn = Record<Fighter, ScriptedSide> & { line: Line }

const gravity = (dir: 'up' | 'down' | 'left' | 'right'): Move => ({ op: 'gravity', dir })
const flip = (axis: 'left-right' | 'top-bottom'): Move => ({ op: 'mirror', axis })

export const INTRO: Line = {
  voice: 'play',
  text: 'Welcome to Mirror! Same puzzle, two boards. Solve it and you send an attack. Three attacks stacked on you and you are out.',
}

export const TURNS: readonly ScriptedTurn[] = [
  {
    claude: {
      think: 'Everything slides to the bottom. Gravity down.',
      hypothesis: [gravity('down')],
      attack: flip('left-right'),
      attackThink: 'Send a left–right flip to scramble GPT’s next picture.',
    },
    gpt: {
      think: 'Cells drop to the floor. Gravity down.',
      hypothesis: [gravity('down')],
      attack: gravity('up'),
      attackThink: 'Send gravity up. Claude’s next puzzle falls the wrong way.',
    },
    line: {
      voice: 'play',
      text: 'Both clear the first board, and the attacks fly! A flip for GPT, gravity for Claude.',
    },
  },
  {
    claude: {
      think:
        'Lines shoot right, then everything rises. The rise is GPT’s attack. Extend right, then gravity up.',
      hypothesis: [{ op: 'extend', dir: 'right' }, gravity('up')],
      attack: { op: 'recolor', from: 4, to: 9 },
      attackThink: 'GPT still carries my flip. Stack a recolor on top: 4 becomes 9.',
    },
    gpt: {
      think: 'Lines shoot to the right. Extend right. Done.',
      hypothesis: [{ op: 'extend', dir: 'right' }],
    },
    line: {
      voice: 'color',
      text: 'GPT forgot the flip Claude sent it. That is the whole game: the rule is the puzzle plus everything your rival stacked on top.',
    },
  },
  {
    claude: {
      think: 'Turned upside down. Mirror top to bottom.',
      hypothesis: [flip('top-bottom')],
      attack: { op: 'recolor', from: 1, to: 5 },
      attackThink:
        'Colour 1 only shows up in GPT’s test grid. Recolor it to 5. GPT cannot see that coming.',
    },
    gpt: {
      think:
        'Upside down, flipped sideways, and the 4s are 9s now. The base move plus both of Claude’s attacks.',
      hypothesis: [flip('top-bottom'), flip('left-right'), { op: 'recolor', from: 4, to: 9 }],
      attack: flip('left-right'),
      attackThink: 'Claude’s board is clean. Start a stack: a left–right flip.',
    },
    line: {
      voice: 'color',
      text: 'GPT clears three moves at once. And Claude’s attack used a colour that only appears in GPT’s test grid, so no example could reveal it. The solver blocked it.',
    },
  },
  {
    claude: {
      think: 'A quarter turn clockwise. Rotate 90.',
      hypothesis: [{ op: 'rotate', turns: 1 }],
    },
    gpt: {
      think: 'Rotate 90. My board is clean.',
      hypothesis: [{ op: 'rotate', turns: 1 }],
      attack: flip('top-bottom'),
      attackThink: 'Claude missed the sideways flip. Stack a top–bottom flip on it.',
    },
    line: {
      voice: 'play',
      text: 'Claude misses! It forgot GPT’s flip. Two attacks are stacked on Claude now. One more and it is over!',
    },
  },
  {
    claude: {
      think: 'Lines drop down, then GPT’s sideways flip. Extend down, then mirror left to right.',
      hypothesis: [{ op: 'extend', dir: 'down' }, flip('left-right')],
    },
    gpt: {
      think: 'Lines drop down. Extend down. Claude has two on its stack.',
      hypothesis: [{ op: 'extend', dir: 'down' }],
      attack: gravity('right'),
      attackThink: 'Gravity right. That is the third.',
    },
    line: {
      voice: 'play',
      text: 'Claude misses again, GPT clears, and the third attack lands! Claude tops out! GPT wins Mirror!',
    },
  },
]

export const OUTRO: Line = {
  voice: 'color',
  text: 'Claude led three clears to two. One blocked attack turned it. In Mirror, the attack you choose matters as much as the puzzle you solve.',
}

/** Plays the scripted match through the real engine, solver checks and all. */
export function playScript() {
  const bases = buildBases()
  const plays = TURNS.map((turn) => ({
    claude: {
      hypothesis: turn.claude.hypothesis,
      ...(turn.claude.attack ? { attack: turn.claude.attack } : {}),
    },
    gpt: {
      hypothesis: turn.gpt.hypothesis,
      ...(turn.gpt.attack ? { attack: turn.gpt.attack } : {}),
    },
  }))
  return { bases, ...playMatch(bases, plays) }
}

export type DemoLine = { id: string; line: Line }

export function demoLines(): DemoLine[] {
  return [
    { id: 'mirror-intro', line: INTRO },
    ...TURNS.map((turn, t) => ({ id: `mirror-t${t + 1}`, line: turn.line })),
    { id: 'mirror-outro', line: OUTRO },
  ]
}
