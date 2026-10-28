import { Check, Mic, Pause, Play, RotateCcw, Volume2, VolumeX, X, Zap } from 'lucide-react'
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { CORNERS as CORNER_NAMES } from '../../arena/corners.ts'
import { flag } from '../../lib/cx.ts'
import { PlaybackContext, useMuted, useOnce, usePlayback, useTyped } from '../../lib/hooks.ts'
import { Button, IconButton, Select } from '../../ui/index.ts'
import { bell, playSound, speak, unlock } from '../audio.ts'
import { type Line, lineFile, VOICE_DIR, VOICES } from '../commentary.ts'
import type { Mood } from '../Face.tsx'
import { FIGHTERS, type Fighter, other } from '../ring/arena.ts'
import type { Cause } from './cycles.ts'
import { type CornerSide, HOUSE_LABEL, MATCHES_TO_WIN, matchId, testId } from './demo.ts'
import { type DiffLine, diffLines, diffStat } from './diff.ts'
import { Floor } from './Floor.tsx'
import { type Frames, framesOf } from './frames.ts'
import { makeMap } from './maps.ts'
import type { Played } from './match.ts'
import { type BrawlShow, SHOWS } from './shows.ts'
import { useReferee } from './useReferee.ts'

/** Playback speed: ticks per second live, and in the slow-motion replay. */
const TPS = 24
const REPLAY_TPS = 8
/** The replay shows the end of the highlight match: this many ticks before the crash. */
const REPLAY_TICKS = 36
const BELL_MS = 1900
const AFTER_MATCH_MS = 1400
/** How the corner unfolds, in milliseconds from its start. */
const CORNER_AT = { notes: 500, patch: 2300, tests: 3800, testGap: 750, hold: 1800 } as const

type Stage =
  | { kind: 'intro' }
  | { kind: 'corner'; corner: number }
  | { kind: 'bell'; bout: number }
  | { kind: 'match'; bout: number; match: number }
  | { kind: 'replay'; bout: number }
  | { kind: 'final' }

type Player = {
  stage: Stage
  /** Ids of matches already played on screen, in order. */
  done: string[]
  line: { id: string; line: Line } | null
  playing: boolean
  run: number
}

type Action =
  | { type: 'start' }
  | { type: 'advance'; run: number }
  | { type: 'line'; run: number; id: string; line: Line }
  | { type: 'toggle' }
  | { type: 'restart' }

const fresh = (show: BrawlShow, run = 0, stage: Stage = { kind: 'intro' }): Player => ({
  stage,
  done: [],
  line: stage.kind === 'corner' ? { id: `${show.prefix}brawl-intro`, line: show.intro } : null,
  playing: stage.kind !== 'intro',
  run,
})

/** Bouts won so far, and matches won in the bout on screen. */
type Tally = { bouts: Record<Fighter, number>; matches: Record<Fighter, number> }

function advance(state: Player, show: BrawlShow): Player {
  const { stage } = state
  const { bouts, corners, prefix } = show
  switch (stage.kind) {
    case 'intro':
      return {
        ...state,
        stage: { kind: 'corner', corner: 0 },
        line: { id: `${prefix}brawl-intro`, line: show.intro },
        playing: true,
      }
    case 'corner': {
      const bout = bouts[stage.corner]
      if (!bout) return { ...state, stage: { kind: 'final' } }
      return {
        ...state,
        stage: { kind: 'bell', bout: stage.corner },
        line: { id: `${prefix}brawl-b${stage.corner + 1}-bell`, line: bout.bell },
      }
    }
    case 'bell':
      return { ...state, stage: { kind: 'match', bout: stage.bout, match: 0 } }
    case 'match': {
      const bout = bouts[stage.bout]
      const done = [...state.done, matchId(stage.bout, stage.match)]
      const last = stage.match + 1 >= (bout?.matches.length ?? 0)
      if (last || !bout) {
        return {
          ...state,
          done,
          line: { id: `${prefix}brawl-b${stage.bout + 1}-replay`, line: bout?.replay as Line },
          stage: { kind: 'replay', bout: stage.bout },
        }
      }
      return { ...state, done, stage: { ...stage, match: stage.match + 1 } }
    }
    case 'replay': {
      const next = stage.bout + 1
      const corner = corners[next]
      if (!corner || !bouts[next]) return { ...state, stage: { kind: 'final' } }
      return { ...state, stage: { kind: 'corner', corner: next } }
    }
    case 'final':
      return state
  }
}

function reducer(show: BrawlShow) {
  return (state: Player, action: Action): Player => {
    switch (action.type) {
      case 'start':
        return advance(state, show)
      case 'advance':
        return action.run === state.run ? advance(state, show) : state
      case 'line':
        return action.run === state.run
          ? { ...state, line: { id: action.id, line: action.line } }
          : state
      case 'toggle':
        return { ...state, playing: !state.playing }
      case 'restart':
        return fresh(show, state.run + 1, { kind: 'corner', corner: 0 })
    }
  }
}

const stageKey = (stage: Stage) =>
  stage.kind === 'match'
    ? `match-${stage.bout}-${stage.match}`
    : 'bout' in stage
      ? `${stage.kind}-${stage.bout}`
      : 'corner' in stage
        ? `corner-${stage.corner}`
        : stage.kind

const voiceUrl = (id: string, line: Line) =>
  `${import.meta.env.BASE_URL}${VOICE_DIR}/${lineFile(id, line)}`

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const NAMES: Record<Fighter, string> = {
  claude: CORNER_NAMES.claude.name,
  gpt: CORNER_NAMES.gpt.name,
}

const TRUTH: Record<Cause, (name: string, foe: string) => string> = {
  wall: (name) => `${name} was walled in and hit a wall`,
  'own-trail': (name) => `${name} turned into its own trail`,
  'their-trail': (name, foe) => `${name} ran into ${foe}’s trail`,
  'head-on': () => 'Head-on: both crashed',
  ring: (name) => `${name} was caught by the closing ring`,
  bug: (name) => `${name}’s bot crashed with an error`,
}

/** Win, loss, draw or crash, from the tested side's point of view. */
function testOutcome(played: Played, fighter: Fighter) {
  if (played.faults[fighter]) return 'crash'
  if (played.winner === fighter) return 'win'
  return played.winner === null ? 'draw' : 'loss'
}

/** The Bot Brawl tab: the newest real fight, with the others and the scripted demo a pick away. */
export function Brawl() {
  const [id, setId] = useState(SHOWS[0]?.id)
  const show = SHOWS.find((s) => s.id === id) ?? SHOWS[0]
  if (!show) return null
  return <BrawlCast key={show.id} show={show} onPick={setId} />
}

/**
 * Bot Brawl on air. The models never touch the floor: in the corner each one submits and patches its
 * bot and runs tests, then the bots fight in sandboxes while the commentators call it. Corners,
 * bouts, slow-motion replays and the final card all fit one frame. `autoStart` and `onEnd` let a
 * full show run the round without a click; `left` overrides the side.
 */
export function BrawlCast({
  show,
  onPick,
  autoStart = false,
  onEnd,
  onPlayingChange,
  left: leftOverride,
}: {
  show: BrawlShow
  onPick?: (id: string) => void
  autoStart?: boolean
  onEnd?: (winner: Fighter | null) => void
  onPlayingChange?: (playing: boolean) => void
  left?: Fighter
}) {
  const champRef = useRef<Fighter | null>(null)
  const { corners: CORNERS, bouts: BOUTS, prefix } = show
  const left = leftOverride ?? show.left
  const sides: Fighter[] = [left, other(left)]
  const run = useMemo(() => reducer(show), [show])
  const [player, dispatch] = useReducer(run, undefined, () => fresh(show))
  const [muted, setMuted] = useMuted()
  const [playbackError, setPlaybackError] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [tick, setTick] = useState(0)
  const [frames, setFrames] = useState<Frames | null>(null)
  const [mapSeed, setMapSeed] = useState<{ seed: number; flip: boolean }>({
    seed: 101,
    flip: false,
  })
  const [banner, setBanner] = useState<{
    id: number
    text: string
    sub?: string
    fighter: Fighter
  } | null>(null)
  // Progress through a corner, tagged with the corner it belongs to.
  const [progress, setProgress] = useState({ corner: -1, at: 0, tests: 0 })
  const [replaying, setReplaying] = useState(false)
  const [waitingForBots, setWaitingForBots] = useState(false)
  const shakeRef = useRef<HTMLDivElement | null>(null)
  const referee = useReferee(show.jobs, show.code)
  const running = player.playing && !referee.error && !playbackError
  const playback = usePlayback(running)
  useEffect(() => onPlayingChange?.(running), [onPlayingChange, running])

  const latest = useRef(player)
  latest.current = player
  const waiting = useRef<(() => void) | null>(null)
  const bannerId = useRef(0)

  const finish = useCallback((run: number) => {
    const go = () => dispatch({ type: 'advance', run })
    if (latest.current.playing) go()
    else waiting.current = go
  }, [])

  useEffect(() => {
    if (player.playing && waiting.current) {
      const go = waiting.current
      waiting.current = null
      go()
    }
  }, [player.playing])

  const key = `${stageKey(player.stage)}:${player.run}`

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per stage, keyed by `key`
  useLayoutEffect(() => {
    const { stage, run } = latest.current
    let cancelled = false
    const timers: number[] = []
    const stops: (() => void)[] = []
    const later = (ms: number, fn: () => void) => {
      timers.push(playback.setTimeout(() => !cancelled && fn(), ms))
    }
    const sleep = (ms: number) => new Promise<void>((resolve) => later(ms, resolve))
    const failed = () => {
      if (!cancelled) {
        setWaitingForBots(false)
        setPlaybackError(true)
      }
    }
    const done = (waits: Promise<unknown>[]) => {
      void Promise.all(waits)
        .then(() => {
          if (!cancelled) finish(run)
        })
        .catch(failed)
    }
    const say = (id: string, line: Line) => {
      setSpeaking(true)
      const voice = speak(voiceUrl(id, line), line.text)
      stops.push(voice.stop)
      return voice.done.then(() => {
        if (!cancelled) setSpeaking(false)
      })
    }
    const shake = (power: number) => {
      const el = shakeRef.current
      if (!el || reducedMotion()) return
      const a = 6 * power
      const animation = playback.track(
        el.animate(
          [
            { translate: '0 0' },
            { translate: `${a}px ${-a * 0.6}px` },
            { translate: `${-a * 0.8}px ${a * 0.5}px` },
            { translate: `${a * 0.4}px ${a * 0.3}px` },
            { translate: '0 0' },
          ],
          { duration: 260 + 60 * power, easing: 'ease-out' },
        ),
      )
      stops.push(() => animation.cancel())
    }
    const showBanner = (text: string, fighter: Fighter, sub?: string) => {
      const id = ++bannerId.current
      setBanner(sub ? { id, text, sub, fighter } : { id, text, fighter })
      later(1700, () => setBanner((b) => (b?.id === id ? null : b)))
    }

    /** Plays ticks from `from` to the end at `tps`, firing sounds and effects as they come. */
    const play = (f: Frames, from: number, tps: number) =>
      new Promise<void>((resolve) => {
        let t = from
        setTick(t)
        const timer = playback.setInterval(() => {
          if (cancelled) return playback.clearInterval(timer)
          t += 1
          setTick(t)
          for (const fighter of FIGHTERS) {
            if (f.boosted[fighter][t]) playSound('boost')
            const crash = f.crashes[fighter]
            if (crash?.tick === t) {
              playSound(crash.cause === 'bug' ? 'bug' : 'crash')
              shake(crash.cause === 'bug' ? 1.2 : 1.5)
            }
          }
          if ((f.closed[t] ?? 0) > (f.closed[t - 1] ?? 0)) {
            playSound('close')
            shake(0.6)
          }
          if (t >= f.ticks) {
            playback.clearInterval(timer)
            resolve()
          }
        }, 1000 / tps)
        stops.push(() => playback.clearInterval(timer))
      })

    switch (stage.kind) {
      case 'intro':
        break
      case 'final':
        // A full show moves on once the final card has had its moment.
        later(4000, () => onEnd?.(champRef.current))
        break
      case 'corner': {
        const step = (patch: Partial<{ at: number; tests: number }>) =>
          setProgress((p) => ({
            ...(p.corner === stage.corner ? p : { at: 0, tests: 0 }),
            ...patch,
            corner: stage.corner,
          }))
        step({ at: 0, tests: 0 })
        setReplaying(false)
        const corner = CORNERS[stage.corner]
        if (!corner) break
        const cornerId = `${prefix}brawl-c${stage.corner}`
        const waits: Promise<unknown>[] = []
        if (stage.corner === 0) {
          waits.push(
            say(`${prefix}brawl-intro`, show.intro).then(() => {
              if (cancelled) return
              dispatch({ type: 'line', run, id: cornerId, line: corner.line })
              return say(cornerId, corner.line)
            }),
          )
        }
        later(CORNER_AT.notes, () => step({ at: 1 }))
        later(CORNER_AT.patch, () => step({ at: 2 }))
        const total = Math.max(corner.claude.tests.length, corner.gpt.tests.length)
        const tests = (async () => {
          await sleep(CORNER_AT.tests)
          for (let t = 0; t < total; t++) {
            // A test chip only lights once the sandbox has really played it.
            setWaitingForBots(true)
            await Promise.all(FIGHTERS.map((f) => referee.get(testId(stage.corner, f, t))))
            if (cancelled) return
            setWaitingForBots(false)
            step({ tests: t + 1 })
            playSound('step')
            await sleep(CORNER_AT.testGap)
          }
          step({ at: 3 })
          // After the build, the analyst reads the corner once the tests are in.
          if (stage.corner > 0) {
            dispatch({ type: 'line', run, id: cornerId, line: corner.line })
            await say(cornerId, corner.line)
          }
          await sleep(CORNER_AT.hold)
        })()
        waits.push(tests)
        done(waits)
        break
      }
      case 'bell': {
        const bout = BOUTS[stage.bout]
        if (!bout) break
        bell(3)
        playSound('roar')
        setFrames(null)
        done([sleep(BELL_MS), say(`${prefix}brawl-b${stage.bout + 1}-bell`, bout.bell)])
        break
      }
      case 'match': {
        const script = BOUTS[stage.bout]?.matches[stage.match]
        if (!script) break
        setMapSeed({ seed: script.seed, flip: script.flip })
        setFrames(null)
        setTick(0)
        setWaitingForBots(true)
        void (async () => {
          const played = await referee.get(matchId(stage.bout, stage.match))
          if (cancelled) return
          setWaitingForBots(false)
          const f = framesOf(played)
          setFrames(f)
          await sleep(500)
          await play(f, 0, TPS)
          if (cancelled) return
          const winner = played.winner
          const loser = winner ? other(winner) : null
          const crash = loser ? played.crashes[loser] : null
          if (crash?.cause === 'bug' && loser) {
            showBanner('Bug', loser, played.faults[loser]?.message ?? 'Error')
          } else if (winner) {
            showBanner(`${NAMES[winner]} wins`, winner)
          } else {
            showBanner('Draw', 'claude')
          }
          playSound(crash?.cause === 'bug' ? 'bigroar' : 'roar')
          const id = `${prefix}brawl-b${stage.bout + 1}-m${stage.match + 1}`
          // The caption changes as the call starts, not when the next match does.
          if (script.line) dispatch({ type: 'line', run, id, line: script.line })
          const call = script.line ? say(id, script.line) : Promise.resolve()
          done([sleep(AFTER_MATCH_MS), call])
        })().catch(failed)
        break
      }
      case 'replay': {
        const bout = BOUTS[stage.bout]
        if (!bout) break
        const script = bout.matches[bout.highlight]
        if (!script) break
        void (async () => {
          await sleep(500)
          const played = await referee.get(matchId(stage.bout, bout.highlight))
          if (cancelled) return
          setMapSeed({ seed: script.seed, flip: script.flip })
          const f = framesOf(played)
          setFrames(f)
          setReplaying(true)
          const voice = say(`${prefix}brawl-b${stage.bout + 1}-replay`, bout.replay)
          await play(f, Math.max(0, f.ticks - REPLAY_TICKS), REPLAY_TPS)
          await sleep(700)
          await voice
          if (!cancelled) {
            setReplaying(false)
            finish(run)
          }
        })().catch(failed)
        break
      }
    }

    return () => {
      cancelled = true
      for (const timer of timers) playback.clearTimeout(timer)
      for (const stop of stops) stop()
    }
  }, [key, finish])

  const { stage } = player
  const final = stage.kind === 'final'

  // Score: bouts won, and matches won in the bout on screen, from results already shown.
  const tally: Tally = { bouts: { claude: 0, gpt: 0 }, matches: { claude: 0, gpt: 0 } }
  const bugs: Record<Fighter, number> = { claude: 0, gpt: 0 }
  const shownBout =
    stage.kind === 'match' || stage.kind === 'bell' || stage.kind === 'replay'
      ? stage.bout
      : stage.kind === 'corner'
        ? stage.corner - 1
        : BOUTS.length - 1
  BOUTS.forEach((bout, b) => {
    const wins = { claude: 0, gpt: 0 }
    bout.matches.forEach((_, m) => {
      const id = matchId(b, m)
      const played = referee.peek(id)
      const counted = player.done.includes(id)
      if (!played || !counted) return
      if (played.winner) wins[played.winner] += 1
      for (const fighter of FIGHTERS) if (played.faults[fighter]) bugs[fighter] += 1
    })
    for (const fighter of FIGHTERS) {
      if (wins[fighter] >= MATCHES_TO_WIN) tally.bouts[fighter] += 1
    }
    if (b === shownBout) tally.matches = wins
  })
  const champ = final
    ? tally.bouts.claude === tally.bouts.gpt
      ? null
      : tally.bouts.claude > tally.bouts.gpt
        ? 'claude'
        : 'gpt'
    : null
  champRef.current = champ

  const map = makeMap(mapSeed.seed, mapSeed.flip)
  const moodOf = (fighter: Fighter): Mood => {
    if (champ) return champ === fighter ? 'happy' : 'idle'
    const crash = frames?.crashes[fighter]
    if (crash && crash.tick <= tick) return crash.cause === 'bug' ? 'down' : 'ko'
    const foeCrash = frames?.crashes[other(fighter)]
    if (foeCrash && foeCrash.tick <= tick) return 'happy'
    if (frames?.boosted[fighter][tick]) return 'locked'
    return 'idle'
  }
  const moods = { claude: moodOf('claude'), gpt: moodOf('gpt') }

  const start = () => {
    unlock()
    referee.start()
    dispatch({ type: 'start' })
  }
  // A full show starts the round itself; its one click already unlocked the sound.
  useOnce(autoStart, () => {
    referee.start()
    dispatch({ type: 'start' })
  })
  const restart = () => {
    unlock()
    waiting.current = null
    setBanner(null)
    setFrames(null)
    dispatch({ type: 'restart' })
  }
  const toggleMute = () => {
    setMuted(!muted)
  }

  const corner = stage.kind === 'corner' ? stage.corner : null
  const cornerAt = progress.corner === corner ? progress.at : 0
  const testsShown = progress.corner === corner ? progress.tests : 0
  const bout =
    stage.kind === 'match' || stage.kind === 'bell' || stage.kind === 'replay' ? stage.bout : null
  const when =
    stage.kind === 'intro'
      ? 'Bot Brawl · Coding'
      : final
        ? 'Final'
        : corner !== null
          ? corner === 0
            ? 'The build'
            : `Corner · after bout ${corner}`
          : stage.kind === 'replay'
            ? `Replay · Bout ${(bout ?? 0) + 1}`
            : stage.kind === 'match'
              ? `Bout ${stage.bout + 1} · ${BOUTS[stage.bout]?.name} · Match ${stage.match + 1}`
              : `Bout ${(bout ?? 0) + 1} of ${BOUTS.length} · ${BOUTS[bout ?? 0]?.name}`

  if (referee.error || playbackError) {
    return (
      <section className="replay-error" role="alert">
        <h2>Bot Brawl could not finish loading</h2>
        <p>The referee stopped before this replay could complete. Reload to try again.</p>
        <Button outline onClick={() => window.location.reload()}>
          Reload replay
        </Button>
      </section>
    )
  }

  return (
    <PlaybackContext.Provider value={playback}>
      <section
        role={onEnd ? undefined : 'main'}
        className="cast brawl"
        data-paused={flag(!player.playing && player.stage.kind !== 'intro')}
        aria-label="Bot Brawl"
        data-replay={flag(replaying)}
      >
        {!onEnd && <h1 className="sr-only">Bot Brawl</h1>}
        <header className="cast__hud">
          <span className="cast__score" data-side="left">
            {NAMES[left]}
            <b className="num" data-lead={flag(tally.bouts[left] > tally.bouts[other(left)])}>
              {tally.bouts[left]}
            </b>
          </span>
          <span className="brawl__center">
            <span className="cast__when">{when}</span>
            {(stage.kind === 'match' || stage.kind === 'replay') && (
              <span className="brawl__tally" role="img" aria-label="Matches won this bout">
                <Dots won={tally.matches[left]} side={left} />
                <Dots won={tally.matches[other(left)]} side={other(left)} />
              </span>
            )}
          </span>
          <span className="cast__score" data-side="right">
            <b className="num" data-lead={flag(tally.bouts[other(left)] > tally.bouts[left])}>
              {tally.bouts[other(left)]}
            </b>
            {NAMES[other(left)]}
          </span>
        </header>

        {sides.map((fighter) => (
          <BotPanel
            key={fighter}
            show={show}
            place={fighter === left ? 'left' : 'right'}
            fighter={fighter}
            stage={stage}
            cornerAt={cornerAt}
            testsShown={testsShown}
            bugs={bugs[fighter]}
            champ={champ}
            frames={frames}
            tick={tick}
            peek={referee.peek}
          />
        ))}

        <div className="cast__stage">
          {corner !== null ? (
            <CornerStage show={show} sides={sides} corner={corner} at={cornerAt} />
          ) : (
            <Floor map={map} frames={frames} tick={tick} moods={moods} shakeRef={shakeRef} />
          )}
          {waitingForBots && stage.kind === 'match' && (
            <span className="brawl__loading">Bots are running in the sandbox…</span>
          )}
          {banner && (
            <div
              key={banner.id}
              className="cast__banner brawl__banner"
              style={{ '--side': `var(--${banner.fighter})` } as CSSProperties}
              aria-live="assertive"
            >
              {banner.text}
              {banner.sub && <small>{banner.sub}</small>}
            </div>
          )}
          {replaying && (
            <>
              <span className="cast__letterbox" data-edge="top" aria-hidden="true" />
              <span className="cast__letterbox" data-edge="bottom" aria-hidden="true" />
              <span className="cast__replay-tag">Replay</span>
            </>
          )}
          {stage.kind === 'intro' && (
            <div className="cast__card">
              <span className="eyebrow">Round 4 · Coding · Terminal-Bench, SWE-bench Pro</span>
              <h2 className="cast__title">Bot Brawl</h2>
              <p className="cast__rules">
                The models do not play. Their code does. Each writes a light-cycle bot, then between
                bouts reads what happened, patches its code and runs tests. A bug is a knockdown.
              </p>
              {onPick && SHOWS.length > 1 && (
                <Select
                  label="Which fight"
                  value={show.id}
                  options={SHOWS.map((s) => ({
                    value: s.id,
                    label: s.label,
                    description: s.detail,
                  }))}
                  onChange={onPick}
                  outline
                />
              )}
              <Button size="lg" tone="strong" outline icon={Play} onClick={start}>
                Start the build
              </Button>
              <p className="cast__fine">{show.fine}</p>
            </div>
          )}
          {final && (
            <div className="cast__card" data-final="">
              <span className="eyebrow">Final</span>
              <h2 className="cast__title" style={{ color: champ ? `var(--${champ})` : undefined }}>
                {champ ? `${NAMES[champ]} wins Bot Brawl` : 'A draw'}
              </h2>
              <p className="cast__rules">
                {`Bouts ${tally.bouts[left]}–${tally.bouts[other(left)]} · Bugs ${bugs[left]}–${bugs[other(left)]}`}
              </p>
              <Button size="lg" outline icon={RotateCcw} onClick={restart}>
                Watch again
              </Button>
            </div>
          )}
        </div>

        <footer className="cast__foot">
          <div className="cast__controls">
            <IconButton
              icon={player.playing ? Pause : Play}
              label={player.playing ? 'Pause' : 'Play'}
              tip="none"
              disabled={stage.kind === 'intro' || final}
              onClick={() => dispatch({ type: 'toggle' })}
            />
            <IconButton icon={RotateCcw} label="Restart" tip="none" onClick={restart} />
            <IconButton
              icon={muted ? VolumeX : Volume2}
              label={muted ? 'Sound on' : 'Sound off'}
              tip="none"
              onClick={toggleMute}
            />
          </div>
          <div className="cast__call" aria-live="polite">
            {player.line && stage.kind !== 'intro' && (
              <>
                <span
                  className="cast__mic"
                  data-voice={player.line.line.voice}
                  data-speaking={flag(speaking)}
                >
                  <Mic size={14} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="cast__speaker">
                  {VOICES[player.line.line.voice].name}
                  <em>{VOICES[player.line.line.voice].role}</em>
                </span>
                <p className="cast__line" key={player.line.id} data-said={flag(!speaking)}>
                  {player.line.line.text}
                </p>
              </>
            )}
          </div>
          <span className="cast__demo">{show.tag}</span>
        </footer>
      </section>
    </PlaybackContext.Provider>
  )
}

function Dots({ won, side }: { won: number; side: Fighter }) {
  return (
    <span className="brawl__dots" data-side={side}>
      {Array.from({ length: MATCHES_TO_WIN }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: dots are positional
        <i key={i} data-on={flag(i < won)} />
      ))}
    </span>
  )
}

/** The corner: the new rule up top, then each model's patch to its bot, side by side. */
function CornerStage({
  show,
  sides,
  corner,
  at,
}: {
  show: BrawlShow
  sides: readonly Fighter[]
  corner: number
  at: number
}) {
  const script = show.corners[corner]
  if (!script) return null
  return (
    <div className="brawl__corner">
      <div className="brawl__rule">
        <span className="eyebrow">{corner === 0 ? 'The rules' : 'New rule'}</span>
        <strong>{script.rule}</strong>
        <span>{script.detail}</span>
      </div>
      <div className="brawl__patches" data-shown={flag(at >= 2)}>
        {sides.map((fighter) => (
          <Patch key={fighter} code={show.code} fighter={fighter} side={script[fighter]} />
        ))}
      </div>
    </div>
  )
}

const VERSION = (bot: string) => `v${bot.split('-')[1]}`

function Patch({
  code,
  fighter,
  side,
}: {
  code: Record<string, string>
  fighter: Fighter
  side: CornerSide
}) {
  const after = code[side.bot] ?? ''
  let lines: DiffLine[]
  let label: ReactNode
  if (side.from) {
    const diff = diffLines(code[side.from] ?? '', after)
    const stat = diffStat(diff)
    lines = diff.filter((line) => line.kind !== 'same' && line.text.trim())
    label = (
      <>
        {`${VERSION(side.from)} → ${VERSION(side.bot)}`}
        <span className="brawl__stat" data-kind="add">{`+${stat.added}`}</span>
        <span className="brawl__stat" data-kind="del">{`−${stat.removed}`}</span>
      </>
    )
  } else {
    lines = after.split('\n').map((text) => ({ kind: 'same' as const, text }))
    label = `${VERSION(side.bot)} · ${after.split('\n').length} lines`
  }
  return (
    <figure
      className="brawl__patch"
      style={{ '--side': `var(--${fighter})` } as CSSProperties}
      aria-label={`${NAMES[fighter]}’s code`}
    >
      <figcaption>
        <span className="brawl__patch-name">{NAMES[fighter]}</span>
        <span className="brawl__patch-label">{label}</span>
      </figcaption>
      <pre>
        {lines.slice(0, 28).map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines of one fixed diff
          <code key={i} data-kind={line.kind}>
            {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}
            {line.text}
          </code>
        ))}
      </pre>
    </figure>
  )
}

/** A corner's panel: submitted code, a claim checked against the engine, tests and verdict. */
function BotPanel({
  show,
  place,
  fighter,
  stage,
  cornerAt,
  testsShown,
  bugs,
  champ,
  frames,
  tick,
  peek,
}: {
  show: BrawlShow
  place: 'left' | 'right'
  fighter: Fighter
  stage: Stage
  cornerAt: number
  testsShown: number
  bugs: number
  champ: Fighter | null
  frames: Frames | null
  tick: number
  peek: (id: string) => Played | null
}) {
  // The corner whose code is in effect: the one on screen, or the last one before this bout.
  const cornerIndex =
    stage.kind === 'corner'
      ? stage.corner
      : stage.kind === 'intro'
        ? 0
        : stage.kind === 'final'
          ? show.corners.length - 1
          : stage.bout
  const side = show.corners[cornerIndex]?.[fighter]
  const inCorner = stage.kind === 'corner'
  const typing = inCorner && cornerAt === 1
  const note = side?.note ?? ''
  const typed = useTyped(note, typing)
  const boostsLeft =
    frames && stage.kind === 'match'
      ? Math.max(
          0,
          (show.bouts[stage.bout]?.rules.boosts ?? 0) -
            frames.boosted[fighter].slice(0, tick + 1).filter(Boolean).length,
        )
      : null

  let status: ReactNode
  if (champ) {
    status = (
      <span className="cast__status" data-tone={champ === fighter ? 'win' : undefined}>
        {champ === fighter ? 'Winner' : 'Runner-up'}
      </span>
    )
  } else if (inCorner) {
    status = (
      <span className="cast__status" data-thinking={flag(cornerAt < 3)}>
        {cornerAt < 3 ? 'In the corner' : 'Ready'}
      </span>
    )
  } else if (side) {
    status = (
      <span className="cast__status" data-tone="lock">
        {`Bot ${VERSION(side.bot)}`}
        {boostsLeft !== null && boostsLeft > 0 && (
          <span className="brawl__boosts" role="img" aria-label={`${boostsLeft} boosts left`}>
            {Array.from({ length: boostsLeft }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: boosts are positional
              <Zap key={i} size={11} strokeWidth={2.5} aria-hidden="true" />
            ))}
          </span>
        )}
      </span>
    )
  }

  const claim = inCorner && side?.claim && cornerIndex > 0 ? side.claim : null
  const claimed = claim ? peek(matchId(cornerIndex - 1, claim.match - 1)) : null
  const truth = claimed ? lossOf(claimed, fighter) : null

  return (
    <aside
      className="cast__panel brawl__panel"
      data-side={place}
      style={{ '--side': `var(--${fighter})` } as CSSProperties}
      aria-label={`${NAMES[fighter]}’s corner`}
    >
      <div className="cast__panel-head">
        <span className="cast__panel-name">{NAMES[fighter]}</span>
        <span className="cast__pips" title={`${bugs} bugs; three is a knockout`}>
          {Array.from({ length: 3 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: pips are positional
            <i key={i} data-on={flag(i < bugs)} />
          ))}
        </span>
      </div>
      <div className="cast__panel-status">{status}</div>
      {claim && truth && cornerAt >= 1 && (
        <div className="brawl__claim">
          <p>
            <span className="brawl__tag">Claim</span>
            {claim.text}
          </p>
          <p data-holds={flag(truth.cause === claim.cause)}>
            <span className="brawl__tag">Engine</span>
            {truth.text}
            {truth.cause === claim.cause ? (
              <Check size={13} strokeWidth={2.75} aria-label="matches" />
            ) : (
              <X size={13} strokeWidth={2.75} aria-label="does not match" />
            )}
          </p>
        </div>
      )}
      <p
        className="cast__thought brawl__note"
        data-typing={flag(typing && typed.length < note.length)}
      >
        {inCorner ? (cornerAt >= 1 ? typed : '') : note}
      </p>
      {inCorner && side && (
        <div className="brawl__tests" data-shown={flag(testsShown > 0)}>
          <span className="brawl__tag">Tests</span>
          <ul>
            {side.tests.map((test, t) => {
              const played = t < testsShown ? peek(testId(cornerIndex, fighter, t)) : null
              const outcome = played ? testOutcome(played, fighter) : null
              return (
                <li key={`${test.against}-${test.seed}`} data-outcome={outcome ?? undefined}>
                  {outcome === 'win' ? (
                    <Check size={12} strokeWidth={3} aria-hidden="true" />
                  ) : outcome === 'crash' || outcome === 'loss' ? (
                    <X size={12} strokeWidth={3} aria-hidden="true" />
                  ) : (
                    <span className="brawl__pending" aria-hidden="true" />
                  )}
                  <span>
                    {`vs ${HOUSE_LABEL[test.against] ?? `own ${VERSION(test.against)}`}`}
                    {outcome && outcome !== 'win' && (
                      <em>
                        {outcome === 'crash'
                          ? (played?.faults[fighter]?.message ?? 'crash')
                          : outcome}
                      </em>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
          {cornerAt >= 3 && <p className="brawl__verdict">{side.verdict}</p>}
        </div>
      )}
    </aside>
  )
}

/** Why `fighter` lost a match, as the engine recorded it. Null when it did not lose. */
function lossOf(played: Played, fighter: Fighter): { cause: Cause; text: string } | null {
  const crash = played.crashes[fighter]
  if (!crash) return null
  const text =
    crash.cause === 'bug'
      ? `${TRUTH.bug(NAMES[fighter], NAMES[other(fighter)])}: ${crash.detail ?? 'error'}, tick ${crash.tick}`
      : `${TRUTH[crash.cause](NAMES[fighter], NAMES[other(fighter)])} at tick ${crash.tick}`
  return { cause: crash.cause, text }
}
