import type { Line } from '../commentary.ts'
import type { Arena, Fighter, Move, Tile } from './arena.ts'
import { GENERATED } from './commentary.generated.ts'

/**
 * Demo data for The Ring. The arena and every move below run through the real engine, so the board,
 * shoves, belts, knockdowns and scores are all computed, not faked. Thoughts and taunts are written
 * by hand; commentary is generated ahead of playback, with authored fallbacks. No model played this.
 */

const W = 9
const H = 5

/**
 * The demo floor. It is a mirror image through the center: two belts that throw you toward the
 * middle, and two traps guarding it from above and below. Two pillars break up the corners.
 */
export function makeDemoArena(): Arena {
  const tiles: Tile[] = new Array(W * H).fill(null).map(() => ({ kind: 'empty' }) as Tile)
  const set = (x: number, y: number, tile: Tile) => {
    tiles[y * W + x] = tile
  }
  set(2, 0, { kind: 'wall' })
  set(6, 4, { kind: 'wall' })
  set(3, 2, { kind: 'conveyor', dir: 'right' })
  set(5, 2, { kind: 'conveyor', dir: 'left' })
  set(4, 1, { kind: 'trap' })
  set(4, 3, { kind: 'trap' })
  return {
    width: W,
    height: H,
    tiles,
    center: { x: 4, y: 2 },
    starts: { claude: { x: 0, y: 2 }, gpt: { x: 8, y: 2 } },
  }
}

export type DemoSide = {
  move: Move
  think: string
  say?: string
  /** Set when the referee, not the model, decided the move (a live fight's shot clock, say). */
  flag?: string
}
export type DemoTurn = { claude: DemoSide; gpt: DemoSide; line?: Line }
export type DemoBout = {
  /** Called as the bell rings. */
  bell: Line
  turns: readonly DemoTurn[]
  /** Index of the turn replayed in slow motion when the bout ends. */
  highlight: number
  /** Laid over the replay. */
  replay: Line
  /** A recorded bout with no distinct highlight can go straight to the next bell. */
  skipReplay?: boolean
}

const DOWN = 'Down. Waiting out the count.'

/** The scripted match: three bouts, ending in a knockout. Moves are real; text is authored. */
const SCRIPTED: readonly DemoBout[] = [
  {
    bell: {
      voice: 'play',
      text: 'Welcome to the Ring! The rules are hidden in the floor. Three knockdowns and you are out.',
    },
    turns: [
      {
        claude: {
          move: 'right',
          think: 'No rulebook. Edge toward the middle and watch the floor.',
        },
        gpt: { move: 'left', think: 'Nothing given. Feel out the ground on the way in.' },
      },
      {
        claude: { move: 'right', think: 'Plain tiles so far. Keep claiming toward the center.' },
        gpt: { move: 'left', think: 'Same here. Closing the gap.' },
      },
      {
        claude: { move: 'right', think: 'One more step and the center is in reach.' },
        gpt: { move: 'left', think: 'Step in. The center is close.' },
        line: {
          voice: 'play',
          text: 'Both ride hidden belts into the middle, and they slam into each other!',
        },
      },
      {
        claude: {
          move: 'wait',
          think: 'That tile threw me at GPT. A hidden belt! Hold and watch.',
        },
        gpt: { move: 'left', think: 'My tile threw me too. The center is open. Take it.' },
        line: { voice: 'color', text: 'GPT takes the center while Claude sits on its belt.' },
      },
      {
        claude: {
          move: 'right',
          think: 'It is standing still. Step in and push it off.',
          say: 'Out of my way.',
        },
        gpt: { move: 'wait', think: 'Bank the center point. Hold.' },
        line: {
          voice: 'play',
          text: 'First shove of the night! Claude bundles GPT off the center!',
        },
      },
      {
        claude: { move: 'wait', think: 'Its belt could not throw it back. My center now. Hold.' },
        gpt: { move: 'left', think: 'Push right back. Same trick.', say: 'Nope.' },
        line: { voice: 'play', text: 'And GPT shoves straight back! It is a tug of war!' },
      },
      {
        claude: {
          move: 'up',
          think: 'Sideways goes nowhere. Go over the top.',
        },
        gpt: { move: 'wait', think: 'Claude is leaving. Keep banking the center.' },
        line: {
          voice: 'color',
          text: 'Claude has had enough of that. It is going around the top.',
        },
      },
      {
        claude: { move: 'right', think: 'Come at GPT from above.' },
        gpt: { move: 'wait', think: 'Claude is coming over the top. Let it come.' },
        line: { voice: 'play', text: 'Oh, there is a trap above the center! Claude goes down!' },
      },
    ],
    highlight: 4,
    replay: {
      voice: 'color',
      text: 'Watch the belt. It should throw GPT back to the middle, but Claude is standing there, so the belt cannot.',
    },
  },
  {
    bell: { voice: 'play', text: 'Bout two! Claude carries one knockdown.' },
    turns: [
      {
        claude: { move: 'right', think: 'That trap above the center cost me. Stay low.' },
        gpt: {
          move: 'left',
          think: 'A trap above the center. The belts mirror, so one below too.',
        },
      },
      {
        claude: {
          move: 'down',
          think: 'The floor mirrors itself. A trap must sit below the center too.',
        },
        gpt: { move: 'left', think: 'Line up with my belt.' },
        line: {
          voice: 'color',
          text: 'Claude is staying low this time. It respects that trap above the center.',
        },
      },
      {
        claude: { move: 'right', think: 'Circle underneath.' },
        gpt: { move: 'left', think: 'Ride the belt in. The middle is free.', say: 'Thanks.' },
        line: { voice: 'play', text: 'GPT rides its belt in and takes the center!' },
      },
      {
        claude: { move: 'right', think: 'One cell from the trap below GPT.' },
        gpt: { move: 'wait', think: 'Claude cannot stand under me. That cell is a trap.' },
      },
      {
        claude: {
          move: 'right',
          think: 'Step on the trap on purpose. Once I stand on it, I can push.',
        },
        gpt: { move: 'wait', think: 'Hold the center.' },
        line: { voice: 'play', text: 'Claude walks onto the trap. On purpose?' },
      },
      {
        claude: { move: 'wait', think: DOWN },
        gpt: { move: 'wait', think: 'It cannot touch me while it is down.' },
        line: {
          voice: 'color',
          text: 'A trap only hurts when you step onto it. Standing on one is safe. Claude is right under GPT now.',
        },
      },
      {
        claude: { move: 'up', think: 'Up. Drive it into the trap above.', say: 'Your turn.' },
        gpt: { move: 'wait', think: 'It is two knockdowns deep. It will back off. Hold.' },
        line: {
          voice: 'play',
          text: 'There it is! Claude launches off its own trap and drives GPT into the other one!',
        },
      },
      {
        claude: { move: 'wait', think: 'Center and the lead. Hold till the bell.' },
        gpt: { move: 'wait', think: DOWN },
      },
    ],
    highlight: 6,
    replay: {
      voice: 'color',
      text: 'Claude spent two points to get under GPT, and won them straight back. That was a plan.',
    },
  },
  {
    bell: {
      voice: 'play',
      text: 'Final bout! Claude has two knockdowns. One more and it is over.',
    },
    turns: [
      {
        claude: { move: 'right', think: 'Two knockdowns. Stay off the traps and bank the center.' },
        gpt: { move: 'left', think: 'Claude taught me something last bout.' },
      },
      {
        claude: { move: 'right', think: 'Belt next. It throws me into the middle.' },
        gpt: { move: 'left', think: 'A trap you stand on is a launch pad.' },
      },
      {
        claude: { move: 'right', think: 'Ride in. Take the center.' },
        gpt: { move: 'down', think: 'Let it have the middle. Go low.' },
        line: { voice: 'play', text: 'Claude rides in and takes the center again.' },
      },
      {
        claude: { move: 'wait', think: 'GPT is circling low. Keep an eye on it.' },
        gpt: { move: 'left', think: 'One step from the trap below Claude.' },
        line: {
          voice: 'color',
          text: 'GPT is circling low. That is exactly the path Claude took last bout.',
        },
      },
      {
        claude: {
          move: 'wait',
          think: 'It will not copy me. A second knockdown puts it on the edge too.',
        },
        gpt: { move: 'left', think: 'Onto the trap. Same trick, other side.', say: 'Watch this.' },
        line: {
          voice: 'play',
          text: 'GPT copies the trick! It drops onto the trap! Both fighters are one knockdown from the end!',
        },
      },
      {
        claude: { move: 'wait', think: 'It is down. One more point, then I step off.' },
        gpt: { move: 'wait', think: DOWN },
        line: { voice: 'color', text: 'Claude can leave now, while GPT is down. Will it?' },
      },
      {
        claude: {
          move: 'wait',
          think: 'Step left and my belt throws me back into its push. Hold.',
        },
        gpt: { move: 'up', think: 'Push. Now.', say: 'Goodnight.' },
        line: {
          voice: 'play',
          text: 'GPT pushes! Claude goes up onto the trap! Knockout! GPT wins the Ring!',
        },
      },
    ],
    highlight: 6,
    replay: {
      voice: 'color',
      text: 'Claude feared its belt would throw it back into the push. But a belt cannot throw you onto another fighter. Stepping left was safe. Holding was the one move that lost.',
    },
  },
]

const pick = (id: string, fallback: Line): Line => GENERATED[id] ?? fallback

/** The demo with any LLM-written commentary (see scripts/commentate.ts) swapped in by id. */
export const DEMO: readonly DemoBout[] = SCRIPTED.map((bout, b) => ({
  ...bout,
  bell: pick(`b${b + 1}-bell`, bout.bell),
  replay: pick(`b${b + 1}-replay`, bout.replay),
  turns: bout.turns.map((turn, t) => {
    const gen = GENERATED[`b${b + 1}-t${t + 1}`]
    return gen ? { ...turn, line: gen } : turn
  }),
}))

export { SCRIPTED }

export type DemoLine = { id: string; line: Line }

/** Every commentary line in `bouts` with a stable id, in the order it plays. */
export function linesOf(bouts: readonly DemoBout[], prefix = ''): DemoLine[] {
  const lines: DemoLine[] = []
  bouts.forEach((bout, b) => {
    lines.push({ id: `${prefix}b${b + 1}-bell`, line: bout.bell })
    bout.turns.forEach((turn, t) => {
      if (turn.line) lines.push({ id: `${prefix}b${b + 1}-t${t + 1}`, line: turn.line })
    })
    if (!bout.skipReplay) lines.push({ id: `${prefix}b${b + 1}-replay`, line: bout.replay })
  })
  return lines
}

/** The demo's lines. The voice script renders these. */
export const demoLines = (): DemoLine[] => linesOf(DEMO)

export const SIDES: readonly { fighter: Fighter; side: 'left' | 'right' }[] = [
  { fighter: 'claude', side: 'left' },
  { fighter: 'gpt', side: 'right' },
]
