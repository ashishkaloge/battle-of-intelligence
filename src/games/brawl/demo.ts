import type { Line } from '../commentary.ts'
import type { Fighter } from '../ring/arena.ts'
import type { Cause, Rules } from './cycles.ts'

/**
 * The scripted Bot Brawl. Everything that happens on the floor is real: the bots are the code in
 * ./bots, they run in the sandbox, and every match and test is played by the engine. What is
 * written by hand is what the models say in the corner and what the commentators say. The demo
 * test plays the whole schedule and checks each expected result, so the script cannot drift from
 * what the code actually does.
 */

export type BotName =
  | 'claude-1'
  | 'claude-2'
  | 'claude-3'
  | 'gpt-1'
  | 'gpt-2'
  | 'gpt-3'
  | 'house-hugger'
  | 'house-greedy'

export const HOUSE_LABEL: Record<string, string> = {
  'house-hugger': 'Wall hugger',
  'house-greedy': 'Greedy',
}

export type Outcome = 'win' | 'loss' | 'draw' | 'crash'

/** A test the model runs in the corner. Its bot always starts on the left. */
export type TestRun = { against: string; seed: number; expect: Outcome }

/** Bots are named `<lab>-<version>`, or `house-<name>` for the referee's sparring partners. */
export type CornerSide = {
  bot: string
  /** The version it patches, for the diff. Null when building from scratch. */
  from: string | null
  /** What the model thinks in the corner, typed out in its panel. */
  note: string
  /** Why it says it lost (or won) a match last bout, checked against the engine's record. */
  claim?: { match: number; cause: Cause; text: string }
  tests: TestRun[]
  /** What it decides after the tests. */
  verdict: string
}

export type Corner = {
  rule: string
  detail: string
  claude: CornerSide
  gpt: CornerSide
  line: Line
}

export type ScriptedMatch = {
  seed: number
  flip: boolean
  expect: { winner: Fighter | null; cause: Cause }
  line?: Line
}

export type Bout = {
  name: string
  rules: Rules
  bell: Line
  matches: ScriptedMatch[]
  /** The match replayed in slow motion when the bout ends. */
  highlight: number
  replay: Line
}

export const OPEN: Rules = { boosts: 0, closeEvery: null }
export const BOOSTS: Rules = { boosts: 3, closeEvery: null }
export const RING: Rules = { boosts: 3, closeEvery: 25 }

/** First to this many match wins takes a bout; two bouts take the round. */
export const MATCHES_TO_WIN = 3

export const INTRO: Line = {
  voice: 'play',
  text: 'Welcome to Bot Brawl! The models do not play this one. Their code does.',
}

/** Corner 0 is the build before bout 1; corners 1 and 2 come after bouts 1 and 2. */
export const CORNERS: readonly Corner[] = [
  {
    rule: 'Open floor',
    detail: 'Two light cycles leave solid trails. Hit a wall or any trail and you crash.',
    claude: {
      bot: 'claude-1',
      from: null,
      note: 'Go where there is the most room. Flood fill every move, and never step next to GPT’s head.',
      tests: [
        { against: 'house-hugger', seed: 900, expect: 'win' },
        { against: 'house-greedy', seed: 901, expect: 'win' },
        { against: 'house-hugger', seed: 902, expect: 'win' },
      ],
      verdict: 'Three wins. Shipping v1.',
    },
    gpt: {
      bot: 'gpt-1',
      from: null,
      note: 'Territory hunter. Count the cells I reach before Claude, and lean into its path to cut it off.',
      tests: [
        { against: 'house-hugger', seed: 900, expect: 'win' },
        { against: 'house-greedy', seed: 901, expect: 'win' },
        { against: 'house-hugger', seed: 902, expect: 'win' },
      ],
      verdict: 'Three wins. Shipping v1.',
    },
    line: {
      voice: 'color',
      text: 'The build. Each model writes a bot from the rules alone. Claude goes for open space. GPT goes hunting.',
    },
  },
  {
    rule: 'Boosts',
    detail: 'Three boosts per match. A boost moves two cells in one tick.',
    claude: {
      bot: 'claude-2',
      from: 'claude-1',
      claim: { match: 3, cause: 'wall', text: 'GPT got to the open space first and walled me in.' },
      note: 'Room alone is not enough. Count only the cells I reach before GPT, and boost to win races.',
      tests: [
        { against: 'house-hugger', seed: 910, expect: 'win' },
        { against: 'house-greedy', seed: 911, expect: 'win' },
        { against: 'claude-1', seed: 912, expect: 'win' },
      ],
      verdict: 'Three wins. Shipping v2.',
    },
    gpt: {
      bot: 'gpt-2',
      from: 'gpt-1',
      claim: {
        match: 2,
        cause: 'own-trail',
        text: 'Lost match 2 by turning into my own trail mid-chase.',
      },
      note: 'Cut-offs work. Add boosts: when Claude is close and its lane is open, get there first.',
      tests: [
        { against: 'house-hugger', seed: 910, expect: 'crash' },
        { against: 'house-greedy', seed: 911, expect: 'win' },
        { against: 'gpt-1', seed: 916, expect: 'win' },
      ],
      verdict: 'One test crashed near the edge. Rare case. Shipping v2.',
    },
    line: {
      voice: 'color',
      text: 'New rule: boosts. And look at GPT’s first test. Its bot crashed. GPT shipped it anyway.',
    },
  },
  {
    rule: 'Closing ring',
    detail: 'Every 25 ticks the outer ring turns to wall. Anyone still on it crashes.',
    claude: {
      bot: 'claude-3',
      from: 'claude-2',
      claim: {
        match: 1,
        cause: 'their-trail',
        text: 'Match 1: GPT boosted across my lane and boxed me in.',
      },
      note: 'Treat the ring that is about to close as wall already. Keep a boost back to dodge GPT’s boosts.',
      tests: [
        { against: 'house-hugger', seed: 920, expect: 'win' },
        { against: 'house-greedy', seed: 921, expect: 'win' },
        { against: 'claude-2', seed: 922, expect: 'win' },
      ],
      verdict: 'Three wins. Shipping v3.',
    },
    gpt: {
      bot: 'gpt-3',
      from: 'gpt-2',
      claim: {
        match: 2,
        cause: 'bug',
        text: 'Match 2: TypeError. My check of Claude’s lane read past the edge of the board.',
      },
      note: 'Fix the crash: check the lane is on the board before reading it.',
      tests: [
        { against: 'house-hugger', seed: 920, expect: 'win' },
        { against: 'house-greedy', seed: 921, expect: 'win' },
        { against: 'gpt-2', seed: 922, expect: 'draw' },
      ],
      verdict: 'No crashes. Shipping v3.',
    },
    line: {
      voice: 'color',
      text: 'Claude says GPT boxed it in. The engine says Claude turned into its own trail. GPT read its error and fixed it. But nobody taught GPT’s bot about the ring.',
    },
  },
]

export const BOUTS: readonly Bout[] = [
  {
    name: 'Open floor',
    rules: OPEN,
    bell: { voice: 'play', text: 'Bout one! Open floor. First to three matches.' },
    matches: [
      {
        seed: 101,
        flip: false,
        expect: { winner: 'gpt', cause: 'own-trail' },
        line: {
          voice: 'play',
          text: 'Claude runs out of room and turns into its own trail! First blood to GPT.',
        },
      },
      {
        seed: 114,
        flip: true,
        expect: { winner: 'claude', cause: 'own-trail' },
        line: { voice: 'play', text: 'GPT chases too hard and folds into its own trail! One all.' },
      },
      {
        seed: 105,
        flip: false,
        expect: { winner: 'gpt', cause: 'wall' },
        line: { voice: 'play', text: 'GPT cuts across and walls Claude in!' },
      },
      {
        seed: 102,
        flip: true,
        expect: { winner: 'gpt', cause: 'wall' },
        line: { voice: 'play', text: 'Again! GPT takes bout one, three to one.' },
      },
    ],
    highlight: 2,
    replay: {
      voice: 'color',
      text: 'Watch GPT. It counts the cells it reaches before Claude does, and takes the middle first. Claude only counted room.',
    },
  },
  {
    name: 'Boosts',
    rules: BOOSTS,
    bell: { voice: 'play', text: 'Bout two! Three boosts each.' },
    matches: [
      {
        seed: 201,
        flip: false,
        expect: { winner: 'gpt', cause: 'own-trail' },
        line: { voice: 'play', text: 'GPT takes the opener!' },
      },
      {
        seed: 204,
        flip: true,
        expect: { winner: 'claude', cause: 'bug' },
        line: {
          voice: 'play',
          text: 'GPT’s bot throws an error and stops dead! That is a bug! Knockdown!',
        },
      },
      {
        seed: 211,
        flip: false,
        expect: { winner: 'claude', cause: 'own-trail' },
        line: { voice: 'play', text: 'Claude goes ahead, two to one.' },
      },
      {
        seed: 202,
        flip: true,
        expect: { winner: 'gpt', cause: 'their-trail' },
        line: { voice: 'play', text: 'Claude runs into GPT’s trail! Two all!' },
      },
      {
        seed: 219,
        flip: false,
        expect: { winner: 'claude', cause: 'wall' },
        line: {
          voice: 'play',
          text: 'GPT hits the wall! Claude takes bout two, three to two. One bout each!',
        },
      },
    ],
    highlight: 1,
    replay: {
      voice: 'color',
      text: 'There is the edge case from its own test. Claude runs along the bottom wall, GPT’s bot looks two cells past the board, and crashes.',
    },
  },
  {
    name: 'Closing ring',
    rules: RING,
    bell: {
      voice: 'play',
      text: 'Final bout! The ring closes every twenty five ticks. Winner takes Bot Brawl.',
    },
    matches: [
      {
        seed: 311,
        flip: false,
        expect: { winner: 'gpt', cause: 'their-trail' },
        line: { voice: 'play', text: 'GPT strikes first in the decider!' },
      },
      {
        seed: 304,
        flip: true,
        expect: { winner: 'claude', cause: 'ring' },
        line: { voice: 'play', text: 'The ring closes and GPT is still on it! One all!' },
      },
      {
        seed: 303,
        flip: false,
        expect: { winner: 'gpt', cause: 'own-trail' },
        line: {
          voice: 'play',
          text: 'Nineteen ticks! Claude is boxed in and turns into its own trail!',
        },
      },
      {
        seed: 306,
        flip: true,
        expect: { winner: 'claude', cause: 'their-trail' },
        line: {
          voice: 'play',
          text: 'GPT runs into Claude’s trail! Two all. It comes down to this!',
        },
      },
      {
        seed: 321,
        flip: false,
        expect: { winner: 'claude', cause: 'ring' },
        line: {
          voice: 'play',
          text: 'The ring closes again, and it takes GPT! Claude wins Bot Brawl!',
        },
      },
    ],
    highlight: 4,
    replay: {
      voice: 'color',
      text: 'GPT fixed its bug, but never taught its bot about the closing ring. Claude did. That was the round.',
    },
  },
]

/** One sandbox job: a corner test or a bout match, in the order the broadcast needs them. */
export type Job = {
  id: string
  seed: number
  flip: boolean
  rules: Rules
  bots: Record<Fighter, string>
}

export const testId = (corner: number, fighter: Fighter, index: number) =>
  `c${corner}-${fighter}-${index}`
export const matchId = (bout: number, match: number) => `b${bout}-m${match}`

/**
 * Every sandbox job a schedule needs, in the order the broadcast plays them: each corner's tests
 * under the rules of the bout that follows it, then that bout's matches.
 */
export function jobsFor(corners: readonly Corner[], bouts: readonly Bout[]): Job[] {
  const cornerRules = (corner: number) => bouts[corner]?.rules ?? OPEN
  const list: Job[] = []
  corners.forEach((corner, c) => {
    for (const fighter of ['claude', 'gpt'] as const) {
      const side = corner[fighter]
      side.tests.forEach((test, t) => {
        // The tested bot keeps its own color and always starts on the left.
        const bots: Record<Fighter, string> =
          fighter === 'claude'
            ? { claude: side.bot, gpt: test.against }
            : { claude: test.against, gpt: side.bot }
        list.push({
          id: testId(c, fighter, t),
          seed: test.seed,
          flip: fighter === 'gpt',
          rules: cornerRules(c),
          bots,
        })
      })
    }
    const bout = bouts[c]
    bout?.matches.forEach((match, m) => {
      list.push({
        id: matchId(c, m),
        seed: match.seed,
        flip: match.flip,
        rules: bout.rules,
        bots: { claude: corner.claude.bot, gpt: corner.gpt.bot },
      })
    })
  })
  return list
}

/** The scripted demo's jobs. */
export const jobs = () => jobsFor(CORNERS, BOUTS)

export type DemoLine = { id: string; line: Line }

/** Every commentary line with a stable id. The voice script renders these. */
export function demoLines(): DemoLine[] {
  const lines: DemoLine[] = [{ id: 'brawl-intro', line: INTRO }]
  CORNERS.forEach((corner, c) => {
    lines.push({ id: `brawl-c${c}`, line: corner.line })
    const bout = BOUTS[c]
    if (!bout) return
    lines.push({ id: `brawl-b${c + 1}-bell`, line: bout.bell })
    bout.matches.forEach((match, m) => {
      if (match.line) lines.push({ id: `brawl-b${c + 1}-m${m + 1}`, line: match.line })
    })
    lines.push({ id: `brawl-b${c + 1}-replay`, line: bout.replay })
  })
  return lines
}
