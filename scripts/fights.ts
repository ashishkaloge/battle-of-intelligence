import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type BluffRecord, lineId, recordHands } from '../src/games/bluff/live.ts'
import { type BrawlRecord, lineId as brawlLine, recordSchedule } from '../src/games/brawl/live.ts'
import { type BuzzerRecord, lineId as buzzerLine, recordTossups } from '../src/games/buzzer/live.ts'
import { type MirrorRecord, lineId as mirrorLine, recordTurns } from '../src/games/mirror/live.ts'
import { type DemoLine, linesOf } from '../src/games/ring/demo.ts'
import { type RingRecord, recordBouts } from '../src/games/ring/live.ts'

const records = <T>(round: string): T[] => {
  const dir = resolve(import.meta.dirname, '..', 'src', 'games', round, 'fights')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T)
}

/** Every commentary line of every recorded fight, with the ids the broadcasts play them by. */
export function fightLines(): DemoLine[] {
  const ring = records<RingRecord>('ring').flatMap((record) =>
    linesOf(recordBouts(record), `${record.id}-`),
  )
  const bluff = records<BluffRecord>('bluff').flatMap((record) => {
    const { hands, intro, calibration } = recordHands(record)
    const prefix = `${record.id}-`
    return [
      { id: prefix + lineId.intro, line: intro },
      ...hands.map((hand, h) => ({ id: prefix + lineId.hand(h), line: hand.line })),
      { id: prefix + lineId.calibration, line: calibration },
    ]
  })
  const buzzer = records<BuzzerRecord>('buzzer').flatMap((record) => {
    const { tossups, intro, outro } = recordTossups(record)
    const prefix = `${record.id}-`
    return [
      { id: prefix + buzzerLine.intro, line: intro },
      ...tossups.map((t, i) => ({ id: prefix + buzzerLine.tossup(i), line: t.line })),
      { id: prefix + buzzerLine.outro, line: outro },
    ]
  })
  const mirror = records<MirrorRecord>('mirror').flatMap((record) => {
    const { turns, intro, outro } = recordTurns(record)
    const prefix = `${record.id}-`
    return [
      { id: prefix + mirrorLine.intro, line: intro },
      ...turns.map((t, i) => ({ id: prefix + mirrorLine.turn(i), line: t.line })),
      { id: prefix + mirrorLine.outro, line: outro },
    ]
  })
  const brawl = records<BrawlRecord>('brawl').flatMap((record) => {
    const { corners, bouts, intro } = recordSchedule(record)
    const prefix = `${record.id}-`
    return [
      { id: prefix + brawlLine.intro, line: intro },
      ...corners.flatMap((corner, c) => {
        const bout = bouts[c]
        return [
          { id: prefix + brawlLine.corner(c), line: corner.line },
          ...(bout
            ? [
                { id: prefix + brawlLine.bell(c), line: bout.bell },
                ...bout.matches.flatMap((m, i) =>
                  m.line ? [{ id: prefix + brawlLine.match(c, i), line: m.line }] : [],
                ),
                { id: prefix + brawlLine.replay(c), line: bout.replay },
              ]
            : []),
        ]
      }),
    ]
  })
  return [...ring, ...bluff, ...buzzer, ...mirror, ...brawl]
}
