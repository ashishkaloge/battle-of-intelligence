import { Check, RotateCcw, X } from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Arena } from '../arena/Arena.tsx'
import { CORNERS, type FightSettings } from '../arena/corners.ts'
import { bell, playSound, unlock } from '../games/audio.ts'
import { BluffCast } from '../games/bluff/Bluff.tsx'
import { BrawlCast } from '../games/brawl/Brawl.tsx'
import { BuzzerCast } from '../games/buzzer/Buzzer.tsx'
import { MirrorCast } from '../games/mirror/Mirror.tsx'
import { type Fighter, leftCorner, other } from '../games/ring/arena.ts'
import { RingCast } from '../games/ring/Ring.tsx'
import { flag } from '../lib/cx.ts'
import { useOnce } from '../lib/hooks.ts'
import { Button, IconButton } from '../ui/index.ts'
import { type Lineup, lineupFor, missing, ROUNDS } from './lineup.ts'

/** How long the card before each round holds, in milliseconds. */
const CARD_MS = 4200

type Stage =
  | { kind: 'intro' }
  | { kind: 'card'; round: number }
  | { kind: 'round'; round: number }
  | { kind: 'final' }

const NAMES: Record<Fighter, string> = { claude: CORNERS.claude.name, gpt: CORNERS.gpt.name }

/** m:ss, or h:mm:ss past an hour. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = `${total % 60}`.padStart(2, '0')
  return h > 0 ? `${h}:${`${m}`.padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** Rounds won by each side; a drawn round counts for nobody. */
export function series(winners: readonly (Fighter | null)[]): Record<Fighter, number> {
  const won = { claude: 0, gpt: 0 }
  for (const w of winners) if (w) won[w] += 1
  return won
}

/** Broadcast runtime excludes pauses reported by the current round. */
export class FightRuntime {
  private started: number | null = null
  private pausedAt: number | null = null
  private pausedMs = 0

  get active() {
    return this.started !== null
  }

  get paused() {
    return this.pausedAt !== null
  }

  start(now: number) {
    this.started = now
    this.pausedAt = null
    this.pausedMs = 0
  }

  reset() {
    this.started = null
    this.pausedAt = null
    this.pausedMs = 0
  }

  setPlaying(playing: boolean, now: number) {
    if (!this.active) return
    if (playing && this.pausedAt !== null) {
      this.pausedMs += now - this.pausedAt
      this.pausedAt = null
    } else if (!playing && this.pausedAt === null) {
      this.pausedAt = now
    }
  }

  elapsed(now: number) {
    return this.started === null
      ? 0
      : Math.max(0, (this.pausedAt ?? now) - this.started - this.pausedMs)
  }
}

/**
 * The whole fight, start to finish: five rounds back to back from one click, with a card before
 * each, the series score carried between them and a clock that ends on the total runtime. Every
 * round plays the selected broadcast, or the latest fight at the chosen tier and effort. A named
 * broadcast never borrows a round from elsewhere; a missing round holds the start. Sides
 * swap every round, starting from The Ring's opener. While it plays the app's top bar steps
 * aside, through the final card, so a screen recording holds nothing but the broadcast.
 * `autoStart` starts it on arrival, for the arena's Start, whose click already unlocked the sound.
 */
export function FullFight({
  settings,
  onSettings,
  autoStart = false,
  onPresent,
  onExit,
}: {
  settings: FightSettings
  onSettings: (patch: Partial<FightSettings>) => void
  autoStart?: boolean
  onPresent: (presenting: boolean) => void
  onExit: () => void
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'intro' })
  const [winners, setWinners] = useState<(Fighter | null)[]>([])
  const [now, setNow] = useState(0)
  const timer = useRef(new FightRuntime())
  const [paused, setPaused] = useState(false)
  const completed = useRef(new Set<number>())
  const [runtime, setRuntime] = useState<number | null>(null)
  // The lineup is fixed once the fight starts, so changing settings later cannot swap a round.
  const [playing, setPlaying] = useState<Lineup | null>(null)
  const chosen = useMemo(() => lineupFor(settings), [settings])
  const lineup = playing ?? chosen
  const gaps = missing(chosen)

  const first: Fighter = lineup.ring ? leftCorner(lineup.ring.arena) : 'claude'
  const leftFor = (round: number): Fighter => (round % 2 === 0 ? first : other(first))

  const done = useCallback(() => {
    onPresent(false)
    timer.current.reset()
    setPaused(false)
    setRuntime(null)
    setNow(0)
    setWinners([])
    setPlaying(null)
    setStage({ kind: 'intro' })
    onExit()
  }, [onExit, onPresent])

  // Escape stops playback as well as restoring navigation, including on the round cards.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && stage.kind !== 'intro' && !event.defaultPrevented) done()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [done, stage.kind])

  const onPlayingChange = useCallback((playing: boolean) => {
    if (!timer.current.active) return
    const now = performance.now()
    timer.current.setPlaying(playing, now)
    setPaused(timer.current.paused)
    setNow(now)
  }, [])

  // The running clock stops immediately with the current round.
  useEffect(() => {
    if (stage.kind === 'intro' || stage.kind === 'final' || paused) return
    const tick = window.setInterval(() => setNow(performance.now()), 500)
    return () => window.clearInterval(tick)
  }, [stage.kind, paused])

  // Each card holds, then its round starts on its own.
  useEffect(() => {
    if (stage.kind !== 'card') return
    bell(stage.round === ROUNDS.length - 1 ? 3 : 2)
    playSound('roar')
    const timer = window.setTimeout(() => setStage({ kind: 'round', round: stage.round }), CARD_MS)
    return () => window.clearTimeout(timer)
  }, [stage])

  const start = () => {
    if (gaps.length > 0) return
    unlock()
    const now = performance.now()
    timer.current.start(now)
    setPaused(false)
    setNow(now)
    setWinners([])
    completed.current.clear()
    setRuntime(null)
    setPlaying(chosen)
    onPresent(true)
    setStage({ kind: 'card', round: 0 })
  }
  useOnce(autoStart && gaps.length === 0, start)

  const ended = useCallback(
    (round: number) => (winner: Fighter | null) => {
      if (!timer.current.active || completed.current.has(round)) return
      completed.current.add(round)
      setWinners((list) => {
        const next = [...list]
        next[round] = winner
        return next
      })
      const now = performance.now()
      timer.current.setPlaying(true, now)
      setPaused(false)
      setNow(now)
      if (round + 1 < ROUNDS.length) {
        setStage({ kind: 'card', round: round + 1 })
        return
      }
      setRuntime(timer.current.elapsed(now))
      setStage({ kind: 'final' })
      bell(3)
      playSound('bigroar')
    },
    [],
  )

  const won = series(winners)
  const elapsed = runtime ?? timer.current.elapsed(now)
  const champ: Fighter | null =
    won.claude === won.gpt ? null : won.claude > won.gpt ? 'claude' : 'gpt'
  const round = 'round' in stage ? stage.round : null
  const meta = round === null ? null : ROUNDS[round]

  if (stage.kind === 'intro')
    return <Arena settings={settings} onSettings={onSettings} onStart={start} />

  return (
    <main className="fight" aria-label="The full fight">
      <h1 className="sr-only">The full fight</h1>
      <header className="fight__strip" data-live={flag(true)}>
        <span className="fight__brand">Battle of Intelligence</span>
        <span className="fight__where">
          {meta
            ? `Round ${(round ?? 0) + 1} of ${ROUNDS.length} · ${meta.name}`
            : stage.kind === 'final'
              ? 'Final'
              : 'Five rounds'}
        </span>
        <span className="fight__series">
          <span style={{ color: 'var(--claude)' }}>{`${NAMES.claude} ${won.claude}`}</span>
          <span aria-hidden="true">–</span>
          <span style={{ color: 'var(--gpt)' }}>{`${won.gpt} ${NAMES.gpt}`}</span>
        </span>
        <span className="fight__clock num" role="timer" aria-label="Runtime">
          {clock(elapsed)}
        </span>
        <IconButton size="sm" icon={X} label="Stop fight" tip="none" onClick={done} />
      </header>

      <div className="fight__body">
        {stage.kind === 'round' && meta && (
          <Round
            key={stage.round}
            lineup={lineup}
            round={stage.round}
            left={leftFor(stage.round)}
            onEnd={ended(stage.round)}
            onPlayingChange={onPlayingChange}
          />
        )}

        {stage.kind === 'card' && meta && (
          <div className="fight__card" key={stage.round}>
            <span className="eyebrow">{`Round ${stage.round + 1} of ${ROUNDS.length} · ${meta.skill} · ${meta.bench}`}</span>
            <h2 className="fight__title">{meta.name}</h2>
            <Score winners={winners} />
          </div>
        )}

        {stage.kind === 'final' && (
          <div className="fight__card" data-final="">
            <span className="eyebrow">{`Final · Runtime ${clock(runtime ?? 0)}`}</span>
            <h2 className="fight__title" style={{ color: champ ? `var(--${champ})` : undefined }}>
              {champ ? `${NAMES[champ]} wins the fight` : 'A drawn fight'}
            </h2>
            <Score winners={winners} />
            <ol className="fight__lineup">
              {ROUNDS.map((r, i) => {
                const w = winners[i]
                return (
                  <li
                    key={r.key}
                    style={w ? ({ '--side': `var(--${w})` } as CSSProperties) : undefined}
                  >
                    <span className="num">{i + 1}</span>
                    <strong>{r.name}</strong>
                    <em data-won={flag(Boolean(w))}>{w ? `${NAMES[w]} wins` : 'Drawn'}</em>
                  </li>
                )
              })}
            </ol>
            <div className="fight__actions">
              <Button size="lg" outline icon={RotateCcw} onClick={start}>
                Watch again
              </Button>
              <Button size="lg" icon={Check} onClick={done}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function Score({ winners }: { winners: readonly (Fighter | null)[] }) {
  const won = series(winners)
  return (
    <p className="fight__score num">
      <span style={{ color: 'var(--claude)' }}>{`${NAMES.claude} ${won.claude}`}</span>
      <span aria-hidden="true">–</span>
      <span style={{ color: 'var(--gpt)' }}>{`${won.gpt} ${NAMES.gpt}`}</span>
    </p>
  )
}

/** One round on air, started on its own, handing its winner back when its final card has shown. */
function Round({
  lineup,
  round,
  left,
  onEnd,
  onPlayingChange,
}: {
  lineup: Lineup
  round: number
  left: Fighter
  onEnd: (winner: Fighter | null) => void
  onPlayingChange: (playing: boolean) => void
}) {
  switch (ROUNDS[round]?.key) {
    case 'ring':
      return lineup.ring ? (
        <RingCast show={lineup.ring} autoStart onEnd={onEnd} onPlayingChange={onPlayingChange} />
      ) : null
    case 'mirror':
      return lineup.mirror ? (
        <MirrorCast
          show={lineup.mirror}
          autoStart
          onEnd={onEnd}
          onPlayingChange={onPlayingChange}
          left={left}
        />
      ) : null
    case 'buzzer':
      return lineup.buzzer ? (
        <BuzzerCast
          show={lineup.buzzer}
          autoStart
          onEnd={onEnd}
          onPlayingChange={onPlayingChange}
          left={left}
        />
      ) : null
    case 'brawl':
      return lineup.brawl ? (
        <BrawlCast
          show={lineup.brawl}
          autoStart
          onEnd={onEnd}
          onPlayingChange={onPlayingChange}
          left={left}
        />
      ) : null
    case 'bluff':
      return lineup.bluff ? (
        <BluffCast
          show={lineup.bluff}
          autoStart
          onEnd={onEnd}
          onPlayingChange={onPlayingChange}
          left={left}
        />
      ) : null
    default:
      return null
  }
}
