/**
 * Plays one real round of Bluff between Claude and GPT through the signed-in CLIs, prints each
 * decision as it lands, and saves the fight under src/games/bluff/fights, where the Bluff tab
 * picks it up and broadcasts it. Both corners always get the same tier, effort and limits.
 *
 *   pnpm fight:bluff                                third tier (Haiku vs Luna), low effort
 *   pnpm fight:bluff --tier second --effort max     a preset effort maps per lab
 *   pnpm fight:bluff --seed 42                      replay a question draw
 *   pnpm fight:bluff --left gpt                     who sits on the left and opens hand 1;
 *                                                   by default it alternates from the last fight
 *
 *   pnpm fight:bluff --clock 300 --round-minutes 120   longer clocks for top effort, both corners
 *
 * Ctrl-C stops the fight, kills both CLIs and saves nothing.
 */
import { parseArgs } from 'node:util'
import { playBluff } from '../server/bluff.ts'
import { LIMITS } from '../src/games/bluff/live.ts'
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

const NAME = 'fight:bluff'
const fail = failer(NAME)
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: COMMON_OPTIONS,
})

const { tier, effort } = tierAndEffort(values, fail)
const broadcast = prepareBroadcast('bluff', values.broadcast, tier, effort)
const seed = fightSeed(values.seed, fail)
const left: Fighter = nextLeft('bluff', values.left, fail)
const limits = withClocks(LIMITS, values, fail)
const who = (f: Fighter) => (f === 'claude' ? 'Claude' : 'GPT')

async function main() {
  await signedIn(fail)
  const controller = stopOnCtrlC(NAME)
  const { hands, shotClockMs, callsPerCorner, roundMs } = limits
  console.log(
    `${NAME}: ${tier} tier at ${effort.claude}/${effort.gpt} effort · seed ${seed} · ${who(left)} on the left · ${hands} hands · shot clock ${shotClockMs / 1000}s · ${callsPerCorner} calls per corner · round clock ${roundMs / 60000} min`,
  )

  const record = await playBluff({
    tier,
    effort,
    seed,
    left,
    limits,
    signal: controller.signal,
    abortOnProviderError: !!broadcast,
    onReport: (report) => {
      if (report.kind === 'hole') {
        console.log(
          `\nH${report.hand + 1}  ${report.question.text}  [truth: ${report.question.answer}]`,
        )
        for (const f of ['claude', 'gpt'] as const) {
          const h = report.hole[f]
          const head = h.ruling === 'played' ? `${h.answer} @${h.confidence}%` : `${h.ruling}`
          console.log(
            `    ${pad(who(f), 7)} ${pad(head, 26)} ${pad(`${h.seconds}s`, 6)} ${pad(h.think || h.error || '', 70)}`,
          )
        }
      } else if (report.kind === 'act') {
        const { action, ruling, seconds, think, error } = report.turn
        const what =
          action.kind === 'claim'
            ? `claim ${action.answer} bet ${action.bet}`
            : action.kind === 'counter'
              ? `counter ${action.answer} +${action.raise}`
              : action.kind
        const head = ruling === 'played' ? what : `${ruling}→${action.kind}`
        console.log(
          `    ${pad(who(action.by), 7)} ${pad(head, 26)} ${pad(`${seconds}s`, 6)} ${pad(think || error || '', 70)}`,
        )
      } else {
        console.log(
          `    = Claude ${report.table.stacks.claude} · GPT ${report.table.stacks.gpt}${report.table.carry ? ` · carry ${report.table.carry}` : ''}`,
        )
      }
    },
  })

  if (controller.signal.aborted) throw new Error('stopped')
  if (broadcast) record.broadcast = broadcast
  console.log(`${NAME}: referee rulings ${JSON.stringify(fightRulings(record))}`)
  const { id, file } = await saveRecord('bluff', record, controller.signal)
  const { end } = record
  console.log(
    `\n${NAME}: ${end.winner ? `${who(end.winner)} wins` : 'a draw'} by ${end.reason === 'ko' ? 'knockout' : 'chips'} · ${end.stacks.claude}–${end.stacks.gpt}`,
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
