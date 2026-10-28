export type Rule = { title: string; body: string }

/** Rules Ashish has set. Changing one is a design decision, not a copy edit. */
export const AGREED_RULES: readonly Rule[] = [
  {
    title: 'Champion stays',
    body: 'Every new model fights the reigning champion. Win and you hold the title until someone beats you.',
  },
  {
    title: 'Same tier, same effort',
    body: 'Tier and effort are set once for the whole fight and apply to both corners. Frontier fights frontier at the same effort, so the race is fair.',
  },
  {
    title: 'Championship effort',
    body: 'Championship fights use Extra, Max or Ultra effort. Development recordings can use lower effort to test the games; each replay shows the effort actually used.',
  },
  {
    title: 'Their own brains',
    body: 'Models win by reasoning, never by luck. No random moves.',
  },
  {
    title: 'Five rounds',
    body: 'Every fight is five rounds, one per benchmark, played back to back.',
  },
  {
    title: 'Five benchmarks',
    body: 'Each round tests one of five skills labs publish benchmark scores for. See Benchmarks.',
  },
  {
    title: 'Show the explanation',
    body: 'Viewers see a short explanation supplied by each model alongside its move. These are public summaries, not access to the model’s private reasoning.',
  },
  {
    title: 'No ordinary games',
    body: 'Every round is a game built for this fight, with a twist a plain benchmark would not have.',
  },
  {
    title: 'Claude vs GPT',
    body: 'Every fight is Claude against GPT.',
  },
  {
    title: 'Open game',
    body: 'Anyone can propose a game, a rule or a fix through a pull request or a fork.',
  },
  {
    title: 'Always improving',
    body: 'The game gets better after every win, so the test never goes stale.',
  },
]

/** Suggestions that still need Ashish's yes before they count. */
export const PROPOSED_RULES: readonly Rule[] = [
  {
    title: 'Fresh challenges',
    body: 'Each fight generates new puzzles from a published seed. Nothing can be memorised, and anyone can replay the fight.',
  },
  {
    title: 'No tools',
    body: 'No web search, files or code execution during a turn. Only the model reasoning.',
  },
  {
    title: 'Scored by code',
    body: 'Answers are checked by code, never by another model’s opinion.',
  },
  {
    title: 'Equal conditions',
    body: 'Both corners get the same challenge, the same prompt and the same time limit.',
  },
]
