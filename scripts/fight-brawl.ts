/**
 * Plays one real Bot Brawl between Claude and GPT through the signed-in CLIs: both models write
 * bots, the referee tests and fights them in the sandbox, and the fight is saved under
 * src/games/brawl/fights, where the Bot Brawl tab replays every test and match. Both corners
 * always get the same tier, effort and limits.
 *
 *   pnpm fight:brawl                                third tier (Haiku vs Luna), low effort
 *   pnpm fight:brawl --tier second --effort max     a preset effort maps per lab
 *   pnpm fight:brawl --seed 42                      replay the floors and test seeds
 *   pnpm fight:brawl --left gpt                     who starts on the left; by default it
 *                                                   alternates from the last fight
 *
 *   pnpm fight:brawl --clock 300 --round-minutes 120   longer clocks for top effort, both corners
 *
 * Ctrl-C stops the fight, kills both CLIs and saves nothing.
 */
import { parseArgs } from 'node:util'
import { playBrawl } from '../server/brawl.ts'
import { LIMITS } from '../src/games/brawl/live.ts'
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

const NAME = 'fight:brawl'
const fail = failer(NAME)
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: COMMON_OPTIONS,
})

const { tier, effort } = tierAndEffort(values, fail)
const broadcast = prepareBroadcast('brawl', values.broadcast, tier, effort)
const seed = fightSeed(values.seed, fail)
const left: Fighter = nextLeft('brawl', values.left, fail)
const limits = withClocks(LIMITS, values, fail)
const who = (f: Fighter) => (f === 'claude' ? 'Claude' : 'GPT')

async function main() {
  await signedIn(fail)
  const controller = stopOnCtrlC(NAME)
  const { shotClockMs, callsPerCorner, roundMs, matchesToWin } = limits
  console.log(
    `${NAME}: ${tier} tier at ${effort.claude}/${effort.gpt} effort · seed ${seed} · ${who(left)} on the left · first to ${matchesToWin} · shot clock ${shotClockMs / 1000}s · ${callsPerCorner} calls per corner · round clock ${roundMs / 60000} min`,
  )

  const record = await playBrawl({
    tier,
    effort,
    seed,
    left,
    limits,
    signal: controller.signal,
    abortOnProviderError: !!broadcast,
    onReport: (report) => {
      if (report.kind === 'corner') {
        console.log(`\nCorner ${report.corner}`)
        for (const f of ['claude', 'gpt'] as const) {
          const s = report.sides[f]
          const tests = s.tests.map((t) => t.expect).join(',')
          const claim = s.claim ? ` claim m${s.claim.match} ${s.claim.cause}` : ''
          console.log(
            `  ${pad(who(f), 7)} ${pad(s.ruling === 'played' ? s.bot : `${s.ruling}→${s.bot}`, 18)} ${pad(`${s.seconds}s`, 7)} tests ${pad(tests, 20)}${s.fixed ? ' fixed' : ''}${claim}  ${pad(s.note || s.error || '', 60)}`,
          )
        }
      } else {
        const { result, wins } = report
        console.log(
          `  B${report.bout + 1}M${report.match + 1}  ${result.winner ? `${who(result.winner)} wins` : 'draw'} (${result.cause ?? '-'})  · Claude ${wins.claude} · GPT ${wins.gpt}`,
        )
      }
    },
  })

  if (controller.signal.aborted) throw new Error('stopped')
  if (broadcast) record.broadcast = broadcast
  console.log(`${NAME}: referee rulings ${JSON.stringify(fightRulings(record))}`)
  const { id, file } = await saveRecord('brawl', record, controller.signal)
  const { end } = record
  console.log(
    `\n${NAME}: ${end.winner ? `${who(end.winner)} wins` : 'a draw'} · bouts ${end.bouts.claude}–${end.bouts.gpt}`,
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
