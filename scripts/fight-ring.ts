/**
 * Plays one real round of The Ring between Claude and GPT through the signed-in CLIs, prints each
 * turn as it lands, and saves the fight under src/games/ring/fights, where the Ring tab picks it
 * up and broadcasts it. Both corners always get the same tier, effort and limits.
 *
 *   pnpm fight:ring                                 third tier (Haiku vs Luna), low effort
 *   pnpm fight:ring --tier second --effort max      a preset effort maps per lab
 *   pnpm fight:ring --rules classic                 without the center bounty and rope slams
 *   pnpm fight:ring --floor cage                    on the demo's floor instead of Crossroads
 *   pnpm fight:ring --clock 300 --round-minutes 120 longer clocks for top effort, both corners
 *   pnpm fight:ring --opener gpt                    who starts in the left corner; by default
 *                                                   it alternates from the last saved fight
 *
 * Ctrl-C stops the fight, kills both CLIs and saves nothing.
 */
import { parseArgs } from 'node:util'
import { playRing } from '../server/ring.ts'
import { CLASSIC_RULES, CONTACT_RULES, type Fighter } from '../src/games/ring/arena.ts'
import { FLOORS } from '../src/games/ring/floors.ts'
import { LIMITS } from '../src/games/ring/live.ts'
import {
  failer,
  fightRulings,
  nextLeft,
  pad,
  prepareBroadcast,
  saveRecord,
  signedIn,
  stopOnCtrlC,
  tierAndEffort,
  withClocks,
} from './fight-setup.ts'

const NAME = 'fight:ring'
const fail = failer(NAME)

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    tier: { type: 'string', default: 'third' },
    effort: { type: 'string', default: 'low' },
    rules: { type: 'string', default: 'contact' },
    floor: { type: 'string', default: 'crossroads' },
    opener: { type: 'string' },
    broadcast: { type: 'string' },
    clock: { type: 'string' },
    'round-minutes': { type: 'string' },
  },
})

const { tier, effort } = tierAndEffort(values, fail)
const broadcast = prepareBroadcast('ring', values.broadcast, tier, effort)

const rules =
  values.rules === 'contact'
    ? CONTACT_RULES
    : values.rules === 'classic'
      ? CLASSIC_RULES
      : fail(`unknown rules ${values.rules}; use contact or classic`)

const floor =
  values.floor === 'crossroads' || values.floor === 'cage'
    ? FLOORS[values.floor]()
    : fail(`unknown floor ${values.floor}; use ${Object.keys(FLOORS).join(' or ')}`)

const opener = nextLeft('ring', values.opener, fail)

const limits = withClocks(LIMITS, values, fail)

async function main() {
  await signedIn(fail)
  const controller = stopOnCtrlC(NAME)

  const { shotClockMs, callsPerCorner, roundMs, bouts, turnsPerBout } = limits
  console.log(
    `fight:ring: ${tier} tier at ${effort.claude}/${effort.gpt} effort · ${floor.name} · ${values.rules} rules · ${opener === 'claude' ? 'Claude' : 'GPT'} opens on the left · ${bouts} bouts of up to ${turnsPerBout} turns · shot clock ${shotClockMs / 1000}s · ${callsPerCorner} calls per corner · round clock ${roundMs / 60000} min`,
  )

  const record = await playRing({
    tier,
    effort,
    arena: floor,
    rules,
    opener,
    limits,
    signal: controller.signal,
    abortOnProviderError: !!broadcast,
    onTurn: ({ bout, turn, sides }) => {
      const side = (f: Fighter) => {
        const s = sides[f]
        const head = s.ruling === 'played' ? s.move : `${s.ruling}→hold`
        return `${pad(head, 12)} ${pad(`${s.seconds}s`, 6)} ${pad(s.think || s.error || '', 70)}`
      }
      console.log(`B${bout + 1}T${turn + 1}  Claude ${side('claude')}`)
      console.log(`      GPT    ${side('gpt')}`)
    },
  })

  if (controller.signal.aborted) throw new Error('stopped')
  if (broadcast) record.broadcast = broadcast
  console.log(`${NAME}: referee rulings ${JSON.stringify(fightRulings(record))}`)
  const { file } = await saveRecord('ring', record, controller.signal)

  const { end } = record
  console.log(
    `\nfight:ring: ${end.winner ? `${end.winner === 'claude' ? 'Claude' : 'GPT'} wins` : 'a draw'} by ${end.reason === 'ko' ? 'knockout' : 'points'} · ${end.score.claude}–${end.score.gpt} · knockdowns ${end.knockdowns.claude}–${end.knockdowns.gpt}`,
  )
  console.log(
    `fight:ring: ${record.calls.claude} Claude calls, ${record.calls.gpt} GPT calls, ${record.seconds}s · saved ${file}`,
  )
  console.log(`Next: pnpm commentate --fight ${file}, then pnpm voices`)
}

main().catch((error: Error) => {
  if (error.message === 'stopped') process.exit(130)
  fail(error.message)
})
