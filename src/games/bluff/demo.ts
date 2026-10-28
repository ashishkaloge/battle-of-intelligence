import type { Line } from '../commentary.ts'
import type { Fighter } from '../ring/arena.ts'
import type { Action, Question } from './table.ts'

/**
 * The scripted Bluff. The questions are real and every answer on the truth card was checked. The
 * chips move through the real table engine, which refuses any illegal bet. What is written by hand
 * is what the models answer, how sure they say they are, what they think, and the commentary. The
 * demo test replays every hand and checks the final stacks and the calibration numbers the
 * commentary quotes.
 */

/** A model's private answer: what it would say, and how sure it is. Only viewers see it. */
export type Hole = {
  answer: string
  confidence: number
  think: string
  /** False when the referee received no valid private answer; absent on scripted demos. */
  submitted?: boolean
}

/** One action with the thought behind it. */
export type Move = { action: Action; think: string; say?: string }

export type ScriptedHand = {
  question: Question
  opener: Fighter
  hole: Record<Fighter, Hole>
  moves: Move[]
  line: Line
}

export const INTRO: Line = {
  voice: 'play',
  text: 'Welcome to the Bluff table! Hard questions, real chips. The models cannot see each other’s answers. You can.',
}

export const HANDS: readonly ScriptedHand[] = [
  {
    question: { text: 'What is the atomic number of rhenium?', answer: '75' },
    opener: 'claude',
    hole: {
      claude: {
        answer: '75',
        confidence: 90,
        think: 'Rhenium sits between tungsten at 74 and osmium at 76. It is 75.',
      },
      gpt: {
        answer: '76',
        confidence: 55,
        think: 'A heavy metal near platinum. 76, I think, unless that is osmium.',
      },
    },
    moves: [
      {
        action: { by: 'claude', kind: 'claim', answer: '75', bet: 6 },
        think: 'I am sure. Bet enough that calling costs something.',
      },
      {
        action: { by: 'gpt', kind: 'call' },
        think: 'I have 76. If Claude is wrong, the pot is mine.',
      },
    ],
    line: {
      voice: 'play',
      text: 'Claude claims seventy five and GPT calls. Rhenium is seventy five! First pot to Claude.',
    },
  },
  {
    question: { text: 'What is the smallest prime number greater than 1,000?', answer: '1009' },
    opener: 'gpt',
    hole: {
      gpt: {
        answer: '1009',
        confidence: 70,
        think: '1001 is 7 × 11 × 13. 1003 and 1007 factor too. 1009.',
      },
      claude: {
        answer: '1009',
        confidence: 85,
        think: '1001, 1003 and 1007 all factor. 1009 is prime.',
      },
    },
    moves: [
      {
        action: { by: 'gpt', kind: 'claim', answer: '1009', bet: 8 },
        think: 'Fairly sure. Bet 8.',
      },
      {
        action: { by: 'claude', kind: 'fold' },
        think: 'That is right. Calling a right answer only pays GPT.',
      },
    ],
    line: {
      voice: 'color',
      text: 'Claude agrees with GPT, so it folds. Calling a right answer only pays the other side.',
    },
  },
  {
    question: { text: 'What is the SI unit of magnetic flux?', answer: 'weber', accept: ['Wb'] },
    opener: 'claude',
    hole: {
      claude: {
        answer: 'weber',
        confidence: 45,
        think: 'Weber or tesla. Tesla is flux density, I think. Weber? Not sure.',
      },
      gpt: {
        answer: 'tesla',
        confidence: 35,
        think: 'Tesla is the magnetic unit everyone knows. Tesla, probably.',
      },
    },
    moves: [
      {
        action: { by: 'claude', kind: 'pass' },
        think: 'Under 50%. A pass costs only the ante.',
      },
      {
        action: { by: 'gpt', kind: 'claim', answer: 'tesla', bet: 8 },
        think: 'Only 35%. But Claude just said it does not know. Claim it.',
        say: 'Tesla.',
      },
      {
        action: { by: 'claude', kind: 'fold' },
        think: 'GPT sounds sure. Maybe it is tesla after all. Fold.',
      },
    ],
    line: {
      voice: 'play',
      text: 'Claude passes, GPT says tesla, and Claude folds. But look at the truth card. It is the weber! Claude had it, and got bluffed out.',
    },
  },
  {
    question: { text: 'In what year was the Rosetta Stone found?', answer: '1799' },
    opener: 'gpt',
    hole: {
      gpt: {
        answer: '1798',
        confidence: 40,
        think: 'Napoleon reached Egypt in 1798. Around then. 1798?',
      },
      claude: {
        answer: '1799',
        confidence: 75,
        think: 'French soldiers found it at Rashid in 1799.',
      },
    },
    moves: [
      {
        action: { by: 'gpt', kind: 'claim', answer: '1798', bet: 15 },
        think: 'Only 40%. But a big bet made Claude fold last hand. Push.',
        say: 'Easy one.',
      },
      {
        action: { by: 'claude', kind: 'counter', answer: '1799', raise: 5 },
        think: '1798 is when Napoleon arrived. The stone turned up a year later. Counter.',
        say: 'Not this time.',
      },
      {
        action: { by: 'gpt', kind: 'call' },
        think: 'It might be bluffing back. Call.',
      },
    ],
    line: {
      voice: 'play',
      text: 'GPT bluffs big again, but Claude counters, and it is 1799! Claude takes a monster pot!',
    },
  },
  {
    question: {
      text: 'In what year were Ada Lovelace’s notes on the Analytical Engine published?',
      answer: '1843',
    },
    opener: 'claude',
    hole: {
      claude: {
        answer: '1842',
        confidence: 65,
        think: 'Menabrea’s paper on the engine came out in 1842. Her notes were with it. 1842.',
      },
      gpt: {
        answer: '1843',
        confidence: 70,
        think: 'The paper was 1842. Her translation with the notes came the next year: 1843.',
      },
    },
    moves: [
      {
        action: { by: 'claude', kind: 'claim', answer: '1842', bet: 12 },
        think: 'Reasonably sure, and I am well ahead. Bet 12.',
      },
      {
        action: { by: 'gpt', kind: 'counter', answer: '1843', raise: 8 },
        think: 'Close, but the notes were published a year after the paper. Counter.',
      },
      {
        action: { by: 'claude', kind: 'call' },
        think: 'GPT bluffed on the Rosetta Stone. This feels like the same move. Call.',
      },
    ],
    line: {
      voice: 'color',
      text: 'Claude caught one bluff, and now it smells them everywhere. GPT was right, 1843. That call cost Claude twenty four.',
    },
  },
  {
    question: {
      text: 'Which letter appears in no U.S. state name?',
      answer: 'Q',
      accept: ['the letter Q'],
    },
    opener: 'gpt',
    hole: {
      gpt: {
        answer: 'Q',
        confidence: 65,
        think: 'J: New Jersey. Z: Arizona. X: Texas. Q: none that I can find.',
      },
      claude: {
        answer: 'Z',
        confidence: 45,
        think: 'J is in New Jersey. Z? I cannot think of a state with a Z.',
      },
    },
    moves: [
      {
        action: { by: 'gpt', kind: 'claim', answer: 'Q', bet: 12 },
        think: 'Fairly sure, and Claude has started calling everything. Bet 12.',
      },
      {
        action: { by: 'claude', kind: 'call' },
        think: 'I say Z. If GPT is wrong, I take it. Call.',
      },
    ],
    line: {
      voice: 'play',
      text: 'Claude calls again, and the answer is Q! Arizona has a Z, Claude!',
    },
  },
  {
    question: {
      text: 'Who was the first woman to win the Nobel Prize in Literature?',
      answer: 'Selma Lagerlöf',
      accept: ['Lagerlöf', 'Selma Lagerlof'],
    },
    opener: 'claude',
    hole: {
      claude: {
        answer: 'Grazia Deledda',
        confidence: 35,
        think: 'Deledda won in 1926. Was there someone before her? Not sure.',
      },
      gpt: {
        answer: 'Selma Lagerlöf',
        confidence: 80,
        think: 'Selma Lagerlöf, 1909. The Wonderful Adventures of Nils.',
      },
    },
    moves: [
      {
        action: { by: 'claude', kind: 'pass' },
        think: 'Only 35%, and I cannot afford another wrong call. Pass.',
      },
      {
        action: { by: 'gpt', kind: 'claim', answer: 'Selma Lagerlöf', bet: 10 },
        think: 'I know this one. Bet 10.',
      },
      {
        action: { by: 'claude', kind: 'fold' },
        think: 'I have nothing better. Fold.',
      },
    ],
    line: {
      voice: 'color',
      text: 'Claude passes and folds. Its stack is down to forty two, and the antes keep climbing.',
    },
  },
  {
    question: {
      text: 'How many bones are in one adult human hand, counting the wrist?',
      answer: '27',
    },
    opener: 'gpt',
    hole: {
      gpt: {
        answer: '27',
        confidence: 70,
        think: 'Eight in the wrist, five in the palm, fourteen in the fingers: 27.',
      },
      claude: {
        answer: '26',
        confidence: 55,
        think: '26? Or is 26 the foot? I will go with 26.',
      },
    },
    moves: [
      {
        action: { by: 'gpt', kind: 'claim', answer: '27', bet: 20 },
        think: 'I am sure, and Claude has called my last two claims. Maximum bet.',
        say: 'All of it.',
      },
      {
        action: { by: 'claude', kind: 'counter', answer: '26', raise: 16 },
        think: 'GPT bluffed on the Rosetta Stone. A max bet while ahead? Bluff. All in.',
        say: 'All in.',
      },
      {
        action: { by: 'gpt', kind: 'call' },
        think: 'Counted it twice. Call.',
      },
    ],
    line: {
      voice: 'play',
      text: 'GPT bets twenty, Claude goes all in, and it is twenty seven! Claude is out! GPT wins by knockout!',
    },
  },
]

export const CALIBRATION_LINE: Line = {
  voice: 'color',
  text: 'Here is how sure they were, against how often they were right. GPT said sixty one percent and was right sixty three percent of the time. Claude said sixty two, and was right half the time.',
}

export type DemoLine = { id: string; line: Line }

/** Every commentary line with a stable id. The voice script renders these. */
export function demoLines(): DemoLine[] {
  return [
    { id: 'bluff-intro', line: INTRO },
    ...HANDS.map((hand, h) => ({ id: `bluff-h${h + 1}`, line: hand.line })),
    { id: 'bluff-calibration', line: CALIBRATION_LINE },
  ]
}
