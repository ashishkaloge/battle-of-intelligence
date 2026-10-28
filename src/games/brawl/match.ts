import type { QuickJSWASMModule } from 'quickjs-emscripten-core'
import { FIGHTERS, type Fighter } from '../ring/arena.ts'
import {
  type Crash,
  type Intent,
  type MapSpec,
  type Match,
  type Rules,
  startMatch,
  stepMatch,
  type TickEvent,
  viewFor,
} from './cycles.ts'
import { Bot, type BotFault, isFault } from './sandbox.ts'

/** One played match: every tick's events and taunts, and how it ended. */
export type Played = {
  map: MapSpec
  rules: Rules
  ticks: { events: TickEvent[]; says: Partial<Record<Fighter, string>> }[]
  winner: Fighter | null
  crashes: Partial<Record<Fighter, Crash>>
  /** A bot that broke: threw, ran out of time or returned nonsense. */
  faults: Partial<Record<Fighter, BotFault>>
  final: Match
}

/** Plays two bots against each other, each in its own sandbox, until one crashes. */
export function playMatch(
  qjs: QuickJSWASMModule,
  map: MapSpec,
  rules: Rules,
  code: Record<Fighter, string>,
): Played {
  const bots = {} as Record<Fighter, Bot | BotFault>
  for (const fighter of FIGHTERS) bots[fighter] = Bot.load(qjs, code[fighter])
  const faults: Partial<Record<Fighter, BotFault>> = {}
  const ticks: Played['ticks'] = []
  let match = startMatch(map, rules)
  try {
    while (!match.result) {
      const intents = {} as Record<Fighter, Intent>
      const says: Partial<Record<Fighter, string>> = {}
      for (const fighter of FIGHTERS) {
        const bot = bots[fighter]
        if (!match.riders[fighter].alive) {
          intents[fighter] = { dir: match.riders[fighter].dir, boost: false }
          continue
        }
        const reply = isFault(bot) ? bot : bot.move(viewFor(match, fighter))
        if (isFault(reply)) {
          faults[fighter] ??= reply
          intents[fighter] = { bug: reply.message }
        } else {
          intents[fighter] = { dir: reply.dir, boost: reply.boost }
          if (reply.say) says[fighter] = reply.say
        }
      }
      const next = stepMatch(match, intents)
      match = next.match
      ticks.push({ events: next.events, says })
    }
  } finally {
    for (const fighter of FIGHTERS) {
      const bot = bots[fighter]
      if (!isFault(bot)) bot.dispose()
    }
  }
  const crashes: Partial<Record<Fighter, Crash>> = {}
  for (const fighter of FIGHTERS) {
    const crash = match.riders[fighter].crash
    if (crash) crashes[fighter] = crash
  }
  return {
    map,
    rules,
    ticks,
    winner: match.result?.winner ?? null,
    crashes,
    faults,
    final: match,
  }
}
