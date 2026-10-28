export type Benchmark = {
  game: string
  skill: string
  /** What a model has to do, in one line. */
  tests: string
  /** Public benchmarks labs report for this skill. The round's game is built on the same skill. */
  names: readonly string[]
}

/** Locked with Ashish on 2026-10-18. One round per benchmark, five rounds per fight. */
export const BENCHMARKS: readonly Benchmark[] = [
  {
    game: 'The Ring',
    skill: 'Learning by doing',
    tests:
      'Work out an unknown game with no instructions, then win it in as few moves as possible.',
    names: ['ARC-AGI-3'],
  },
  {
    game: 'Mirror',
    skill: 'Reasoning',
    tests: 'Find the hidden rule behind a few examples and apply it to a new case.',
    names: ['ARC-AGI-2'],
  },
  {
    game: 'Buzzer',
    skill: 'Math',
    tests: 'Solve fresh problems that have one exact answer.',
    names: ['FrontierMath', 'AIME'],
  },
  {
    game: 'Bot Brawl',
    skill: 'Coding',
    tests: 'Turn a spec into code that works when it runs.',
    names: ['Terminal-Bench', 'SWE-bench Pro'],
  },
  {
    game: 'Bluff',
    skill: 'Knowledge',
    tests: 'Answer what you know, and pass instead of bluffing.',
    names: ['Humanity’s Last Exam', 'AA-Omniscience'],
  },
]
