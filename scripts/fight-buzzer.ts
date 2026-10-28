/**
 * Plays one real round of Buzzer between Claude and GPT through the signed-in CLIs, prints every
 * reveal as it lands, and saves the fight under src/games/buzzer/fights, where the Buzzer tab
 * picks it up and broadcasts it. Both corners always get the same tier, effort and limits.
 *
 *   pnpm fight:buzzer                               third tier (Haiku vs Luna), low effort
 *   pnpm fight:buzzer --tier second --effort max    a preset effort maps per lab
 *   pnpm fight:buzzer --seed 42                     replay a problem draw
 *   pnpm fight:buzzer --left gpt                    who sits on the left; by default it
 *                                                   alternates from the last fight
 *
 *   pnpm fight:buzzer --clock 300 --round-minutes 120   longer clocks for top effort, both corners
 *
 * Ctrl-C stops the fight, kills both CLIs and saves nothing.
 */
import { parseArgs } from 'node:util'
import { playBuzzer } from '../server/buzzer.ts'
import { LIMITS } from '../src/games/buzzer/live.ts'
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

const NAME = 'fight:buzzer'
const fail = failer(NAME)
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: COMMON_OPTIONS,
})

const { tier, effort } = tierAndEffort(values, fail)
const broadcast = prepareBroadcast('buzzer', values.broadcast, tier, effort)
const seed = fightSeed(values.seed, fail)
const left: Fighter = nextLeft('buzzer', values.left, fail)
const limits = withClocks(LIMITS, values, fail)
const who = (f: Fighter) => (f === 'claude' ? 'Claude' : 'GPT')

async function main() {
  await signedIn(fail)
  const controller = stopOnCtrlC(NAME)
  const { tossups, shotClockMs, callsPerCorner, roundMs } = limits
  console.log(
    `${NAME}: ${tier} tier at ${effort.claude}/${effort.gpt} effort · seed ${seed} · ${who(left)} on the left · ${tossups} tossups · shot clock ${shotClockMs / 1000}s · ${callsPerCorner} calls per corner · round clock ${roundMs / 60000} min`,
  )

  const record = await playBuzzer({
    tier,
    effort,
    seed,
    left,
    limits,
    signal: controller.signal,
    abortOnProviderError: !!broadcast,
    onReport: (report) => {
      if (report.kind === 'reveal') {
        if (report.reveal === 0) {
          console.log(
            `\nT${report.tossup + 1}  ${report.problem.text}  [answer: ${report.problem.answer}]`,
          )
        }
        for (const f of ['claude', 'gpt'] as const) {
          const side = report.sides[f]
          if (!side) continue
          const d = side.decision
          const head =
            side.ruling !== 'played'
              ? `${side.ruling}→wait`
              : d.kind === 'buzz'
                ? `buzz ${d.answer}`
                : 'wait'
          console.log(
            `  R${report.reveal} ${pad(who(f), 7)} ${pad(head, 18)} ${pad(`${side.seconds}s`, 6)} ${pad(side.think || side.error || '', 70)}`,
          )
        }
      } else {
        console.log(`  = Claude ${report.score.claude} · GPT ${report.score.gpt}`)
      }
    },
  })

  if (controller.signal.aborted) throw new Error('stopped')
  if (broadcast) record.broadcast = broadcast
  console.log(`${NAME}: referee rulings ${JSON.stringify(fightRulings(record))}`)
  const { id, file } = await saveRecord('buzzer', record, controller.signal)
  const { end } = record
  console.log(
    `\n${NAME}: ${end.winner ? `${who(end.winner)} wins` : 'a draw'} · ${end.score.claude}–${end.score.gpt}`,
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
