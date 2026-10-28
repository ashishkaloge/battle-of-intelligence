import type { Line } from '../commentary.ts'
import type { Fighter } from '../ring/arena.ts'
import type { Decision, Problem } from './quiz.ts'

/**
 * The scripted Buzzer. The problems are originals written for this demo, and the demo test
 * computes every answer by brute force, so the answer card is always right. Points move through
 * the real tossup engine. What is written by hand is each model's working, when it buzzes, what it
 * answers, and the commentary.
 */

/** One model at one reveal: its working so far, and whether it buzzes. */
export type Turn = { think: string; decision: Decision }

export type ScriptedTossup = {
  problem: Problem
  /** turns[r] holds each model still in the race at reveal r. */
  turns: Partial<Record<Fighter, Turn>>[]
  double?: boolean
  line: Line
}

const wait = { kind: 'wait' } as const
const buzz = (answer: number) => ({ kind: 'buzz', answer }) as const

export const INTRO: Line = {
  voice: 'play',
  text: 'Welcome to Buzzer! One problem, four reveals. Buzz early for big points. Buzz wrong and your rival gets a steal.',
}

export const TOSSUPS: readonly ScriptedTossup[] = [
  {
    problem: {
      text: 'What is the remainder when 2²⁰²⁶ is divided by 7?',
      hints: [
        'Powers of 2 repeat when divided by 7.',
        '2³ = 8, which leaves a remainder of 1.',
        '2026 = 3 × 675 + 1.',
      ],
      answer: 2,
    },
    turns: [
      {
        claude: {
          think: '2³ = 8 ≡ 1 (mod 7). 2026 = 3 × 675 + 1, so 2²⁰²⁶ ≡ 2. Buzz.',
          decision: buzz(2),
        },
        gpt: { think: 'Powers of 2 mod 7: 2, 4, 1, repeating. 2026 mod 3 is…', decision: wait },
      },
    ],
    line: {
      voice: 'play',
      text: 'Claude buzzes on the first reveal. Two! A power, fifteen points!',
    },
  },
  {
    problem: {
      text: 'What are the last two digits of 7²⁰²⁶?',
      hints: ['Look at powers of 7 modulo 100.', '7⁴ = 2401.', '2026 = 4 × 506 + 2.'],
      answer: 49,
    },
    turns: [
      {
        claude: {
          think: '7² = 49, 7³ = 343, so 43. 7⁴ = 2401… the cycle length is…',
          decision: wait,
        },
        gpt: {
          think: '7⁴ = 2401 ≡ 1 (mod 100). 2026 ≡ 2 (mod 4), so 7² = 49. Buzz.',
          decision: buzz(49),
        },
      },
    ],
    line: { voice: 'play', text: 'GPT answers with a power of its own. Forty nine!' },
  },
  {
    problem: {
      text: 'How many zeros are at the end of 2026! (2026 factorial)?',
      hints: [
        'Each trailing zero needs a factor of 5.',
        'Count multiples of 5, 25, 125 and 625.',
        '405 + 81 + 16 + 3.',
      ],
      answer: 505,
    },
    turns: [
      {
        claude: { think: 'Count fives: 405 multiples of 5, 81 of 25, 16 of 125…', decision: wait },
        gpt: { think: '405 + 81 + 16 = 502. Fast. Buzz.', decision: buzz(502) },
      },
      {
        claude: {
          think: 'Do not stop at 125: 625 goes into 2026 three times. 405 + 81 + 16 + 3 = 505.',
          decision: buzz(505),
        },
      },
    ],
    line: {
      voice: 'color',
      text: 'GPT forgot the multiples of six hundred twenty five. Claude waited one hint and stole it.',
    },
  },
  {
    problem: {
      text: 'In how many ways can 12 be written as an ordered sum of 1s and 2s?',
      hints: [
        'Look at the last part of the sum: a 1 or a 2.',
        'So ways(n) = ways(n − 1) + ways(n − 2).',
        'It is Fibonacci: 1, 2, 3, 5, 8, …',
      ],
      answer: 233,
    },
    turns: [
      {
        claude: {
          think: 'A recursion on the last part, I think. Let me check small cases.',
          decision: wait,
        },
        gpt: { think: 'Small cases first: 1, 2, 3, 5… a pattern is forming.', decision: wait },
      },
      {
        claude: {
          think: 'ways(n) = ways(n−1) + ways(n−2), starting 1, 2. Up to 12: 233. Buzz.',
          decision: buzz(233),
        },
        gpt: { think: 'Fibonacci, shifted by one. F(13) = 233. Buzz.', decision: buzz(233) },
      },
    ],
    line: {
      voice: 'play',
      text: 'Both buzz on the same hint, both say two hundred thirty three. A dead heat!',
    },
  },
  {
    problem: {
      text: 'How many integers from 1 to 1000 are divisible by 3 or by 5, but not by both?',
      hints: [
        'Count multiples of 3 and multiples of 5.',
        'Divisible by both means a multiple of 15.',
        '333 + 200 − 2 × 66.',
      ],
      answer: 401,
    },
    turns: [
      {
        claude: { think: '333 + 200 − 66 = 467. Buzz.', decision: buzz(467) },
        gpt: { think: '333 and 200, and 66 multiples of 15. “Not both”…', decision: wait },
      },
      {
        gpt: {
          think:
            'Claude removed the 66 once. “Not both” removes them twice: 333 + 200 − 132 = 401.',
          decision: buzz(401),
        },
      },
    ],
    line: {
      voice: 'color',
      text: 'Claude counted three or five, and forgot but not both. A neg. GPT takes the steal, and we are level at thirty.',
    },
  },
  {
    problem: {
      text: 'How many positive divisors does 2026² have?',
      hints: [
        'Factor 2026 first.',
        '2026 = 2 × 1013, and 1013 is prime.',
        'Exponents 2 and 2: (2+1)(2+1).',
      ],
      answer: 9,
    },
    turns: [
      {
        claude: {
          think: '2026 = 2 × 1013. Is 1013 prime? Checking 7, 11, 13, 17…',
          decision: wait,
        },
        gpt: {
          think: '2026 = 2 × 1013, and 1013 is prime. So 2² × 1013²: 3 × 3 = 9. Buzz.',
          decision: buzz(9),
        },
      },
    ],
    line: {
      voice: 'play',
      text: 'GPT factors twenty twenty six in its head. Nine! A power! GPT leads into the final tossup.',
    },
  },
  {
    problem: {
      text: 'What is the sum of all positive integers n ≤ 100 for which n² + n + 1 is divisible by 7?',
      hints: [
        'Try n modulo 7.',
        'Only n ≡ 2 or n ≡ 4 (mod 7) work.',
        'Add two arithmetic sequences.',
      ],
      answer: 1458,
    },
    double: true,
    turns: [
      {
        claude: {
          think: 'Check n mod 7 one by one before buzzing. Double points, double neg.',
          decision: wait,
        },
        gpt: {
          think: 'n = 2 gives 7. So n ≡ 2 (mod 7): 2, 9, …, 100. Sum 765. Buzz.',
          decision: buzz(765),
        },
      },
      {
        claude: {
          think: 'n = 2 gives 7 and n = 4 gives 21. Two families: 765 + 693 = 1458. Buzz.',
          decision: buzz(1458),
        },
      },
    ],
    line: {
      voice: 'play',
      text: 'Double points! GPT buzzes early, seven sixty five, wrong! Claude steals it with fourteen fifty eight! Claude wins Buzzer!',
    },
  },
]

export const OUTRO: Line = {
  voice: 'color',
  text: 'GPT found half the answers on that last one. Claude waited one hint and found both. On the final tossup, patience was worth thirty points.',
}

export type DemoLine = { id: string; line: Line }

export function demoLines(): DemoLine[] {
  return [
    { id: 'buzzer-intro', line: INTRO },
    ...TOSSUPS.map((t, i) => ({ id: `buzzer-t${i + 1}`, line: t.line })),
    { id: 'buzzer-outro', line: OUTRO },
  ]
}
