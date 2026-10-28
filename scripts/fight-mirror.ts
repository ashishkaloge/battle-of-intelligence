/**
 * Plays one real round of Mirror between Claude and GPT through the signed-in CLIs, prints each
 * turn as it lands, and saves the fight under src/games/mirror/fights, where the Mirror tab picks
 * it up and broadcasts it. Both corners always get the same tier, effort and limits.
 *
 *   pnpm fight:mirror                               third tier (Haiku vs Luna), low effort
 *   pnpm fight:mirror --tier second --effort max    a preset effort maps per lab
 *   pnpm fight:mirror --seed 42                     replay a puzzle draw
 *   pnpm fight:mirror --left gpt                    who sits on the left; by default it
 *                                                   alternates from the last fight
 *
 *   pnpm fight:mirror --clock 300 --round-minutes 120   longer clocks for top effort, both corners
 *
 * Ctrl-C stops the fight, kills both CLIs and saves nothing.
 */
import { parseArgs } from 'node:util'
import { playMirror } from '../server/mirror.ts'
import { formatMove } from '../src/games/forge/syntax.ts'
import { LIMITS } from '../src/games/mirror/live.ts'
import type { Fighter } from '../src/games/ring/arena.ts'
import {
  COMMON_OPTIONS,
  failer,
  fightRulings,
  fightSeed,
  nextLeft,
  pad,
  prepareBroadcast,
  saveRecord,
  signedIn,
  stopOnCtrlC,
  tierAndEffort,
  withClocks,
} from './fight-setup.ts'

const NAME = 'fight:mirror'
const fail = failer(NAME)
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: COMMON_OPTIONS,
})

const { tier, effort } = tierAndEffort(values, fail)
const broadcast = prepareBroadcast('mirror', values.broadcast, tier, effort)
const seed = fightSeed(values.seed, fail)
const left: Fighter = nextLeft('mirror', values.left, fail)
const limits = withClocks(LIMITS, values, fail)
const who = (f: Fighter) => (f === 'claude' ? 'Claude' : 'GPT')

async function main() {
  await signedIn(fail)
  const controller = stopOnCtrlC(NAME)
  const { turns, shotClockMs, callsPerCorner, roundMs } = limits
  console.log(
    `${NAME}: ${tier} tier at ${effort.claude}/${effort.gpt} effort · seed ${seed} · ${who(left)} on the left · ${turns} turns · shot clock ${shotClockMs / 1000}s · ${callsPerCorner} calls per corner · round clock ${roundMs / 60000} min`,
  )

  const record = await playMirror({
    tier,
    effort,
    seed,
    left,
    limits,
    signal: controller.signal,
    abortOnProviderError: !!broadcast,
    onReport: ({ turn, sides, summary, stacks }) => {
      console.log(`\nT${turn + 1}`)
      for (const f of ['claude', 'gpt'] as const) {
        const s = sides[f]
        const rule = s.ruling === 'played' ? s.hypothesis.map(formatMove).join(' → ') : s.ruling
        const attack = s.attack ? ` ⇒ ${formatMove(s.attack)}` : ''
        console.log(
          `  ${pad(who(f), 7)} ${pad(rule + attack, 44)} ${pad(`${s.seconds}s`, 6)} ${pad(s.think || s.error || '', 60)}`,
        )
      }
      console.log(`  ${summary}  stacks: Claude ${stacks.claude.length} · GPT ${stacks.gpt.length}`)
    },
  })

  if (controller.signal.aborted) throw new Error('stopped')
  if (broadcast) record.broadcast = broadcast
  console.log(`${NAME}: referee rulings ${JSON.stringify(fightRulings(record))}`)
  const { id, file } = await saveRecord('mirror', record, controller.signal)
  const last = record.result.turns.at(-1)
  console.log(
    `\n${NAME}: ${record.result.winner ? `${who(record.result.winner)} wins` : 'a draw'}${record.result.ko ? ' by knockout' : ''} · clears ${last?.clears.claude ?? 0}–${last?.clears.gpt ?? 0}`,
  )
  console.log(
    `${NAME}: ${record.calls.claude} Claude calls, ${record.calls.gpt} GPT calls, ${record.seconds}s · saved ${file} (${id})`,
  )
  console.log('Next: pnpm voices')
}

main().catch((error: Error) => {
  if (error.message === 'stopped') process.exit(130)
  fail(error.message)
})
