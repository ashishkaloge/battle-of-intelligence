import claude1 from './bots/claude-1.js?raw'
import claude2 from './bots/claude-2.js?raw'
import claude3 from './bots/claude-3.js?raw'
import gpt1 from './bots/gpt-1.js?raw'
import gpt2 from './bots/gpt-2.js?raw'
import gpt3 from './bots/gpt-3.js?raw'
import greedy from './bots/house-greedy.js?raw'
import hugger from './bots/house-hugger.js?raw'

/** The source of every bot in the demo, exactly as it runs in the sandbox. */
export const BOTS: Record<string, string> = {
  'claude-1': claude1,
  'claude-2': claude2,
  'claude-3': claude3,
  'gpt-1': gpt1,
  'gpt-2': gpt2,
  'gpt-3': gpt3,
  'house-hugger': hugger,
  'house-greedy': greedy,
}
