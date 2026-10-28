import { Lock, Mic, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react'
import { CORNERS } from '../../arena/corners.ts'
import { flag } from '../../lib/cx.ts'
import { PlaybackContext, useMuted, useOnce, usePlayback, useTyped } from '../../lib/hooks.ts'
import { Button, IconButton, Select } from '../../ui/index.ts'
import { bell, lockTick, playSound, revealClack, speak, unlock } from '../audio.ts'
import { type Line, lineFile, VOICE_DIR, VOICES } from '../commentary.ts'
import {
  FIGHTERS,
  type Fighter,
  initialState,
  isKnockedOut,
  KO_AT,
  leftCorner,
  nextBout,
  other,
  type RingEvent,
  type RingState,
  resolveTurn,
  winner,
} from './arena.ts'
import { type Badge, Board, MOVE_ICON, MOVE_LABEL, type Pop, type Spark } from './Board.tsx'
import { type Choreo, type Cue, choreograph, type Mood, slowed } from './choreo.ts'
import type { DemoSide, DemoTurn } from './demo.ts'
import { SHOWS, type Show } from './shows.ts'

/** One turn's beats, in milliseconds. Impact runs as long as its choreography. */
const BEAT = { think: 1100, lock: 420, reveal: 460 } as const
/** Action captions type at this many milliseconds a character. */
const TYPE_MS = 17
const THINK_MAX_MS = 3600
const BELL_MS = 1800
const REPLAY_SLOW = 2.6

type Beat = 'think' | 'lock' | 'reveal' | 'impact'
type Stage =
  | { kind: 'intro' }
  | { kind: 'bell'; bout: number }
  | { kind: 'turn'; bout: number; turn: number; beat: Beat }
  | { kind: 'replay'; bout: number }
  | { kind: 'final' }

type Played = { before: RingState; after: RingState; events: RingEvent[] }

type Player = {
  show: Show
  stage: Stage
  /** The engine's state: where the fighters really are. */
  ring: RingState
  /** What the floor shows. Catches up with `ring` when the fighters land. */
  floor: RingState
  /** Every turn played so far, by bout, for replays. */
  played: Played[][]
  line: { id: string; line: Line } | null
  playing: boolean
  /** Bumped on restart so timers from the old run do nothing. */
  run: number
}

type Action =
  | { type: 'start' }
  | { type: 'advance'; run: number }
  | { type: 'floor'; run: number }
  | { type: 'toggle' }
  | { type: 'restart' }

export const createRingPlayer = (show: Show, run = 0, stage: Stage = { kind: 'intro' }): Player => {
  const ring = initialState(show.arena, show.rules)
  return {
    show,
    stage,
    ring,
    floor: ring,
    played: show.bouts.map(() => []),
    line: stage.kind === 'bell' ? bellLine(show, 0) : null,
    playing: stage.kind !== 'intro',
    run,
  }
}

const bellLine = (show: Show, bout: number) => ({
  id: `${show.prefix}b${bout + 1}-bell`,
  line: show.bouts[bout]?.bell as Line,
})

/** The opening beat stretches so the action caption can be read. */
function pace(turn: DemoTurn | undefined) {
  const longest = Math.max(1, ...FIGHTERS.map((f) => turn?.[f].think.length ?? 0))
  const think = Math.min(THINK_MAX_MS, Math.max(BEAT.think, longest * TYPE_MS))
  return { think, typeMs: Math.min(TYPE_MS, think / longest) }
}

function afterBout(state: Player, bout: number): Player {
  const next = bout + 1
  if (state.ring.ko || next >= state.show.bouts.length)
    return { ...state, stage: { kind: 'final' } }
  const ring = nextBout(state.ring)
  return {
    ...state,
    ring,
    floor: ring,
    stage: { kind: 'bell', bout: next },
    line: bellLine(state.show, next),
  }
}

function advance(state: Player): Player {
  const { stage, show } = state
  switch (stage.kind) {
    case 'intro':
      return { ...state, stage: { kind: 'bell', bout: 0 }, line: bellLine(show, 0), playing: true }
    case 'bell':
      return { ...state, stage: { kind: 'turn', bout: stage.bout, turn: 0, beat: 'think' } }
    case 'turn': {
      const { bout, turn, beat } = stage
      if (beat === 'think') return { ...state, stage: { ...stage, beat: 'lock' } }
      if (beat === 'lock') return { ...state, stage: { ...stage, beat: 'reveal' } }
      if (beat === 'reveal') {
        const script = show.bouts[bout]?.turns[turn]
        if (!script) return state
        const { state: after, events } = resolveTurn(state.ring, {
          claude: script.claude.move,
          gpt: script.gpt.move,
        })
        const played = state.played.map((list, i) =>
          i === bout ? [...list, { before: state.ring, after, events }] : list,
        )
        return {
          ...state,
          stage: { ...stage, beat: 'impact' },
          ring: after,
          played,
          line: script.line
            ? { id: `${show.prefix}b${bout + 1}-t${turn + 1}`, line: script.line }
            : state.line,
        }
      }
      const last = (show.bouts[bout]?.turns.length ?? 0) - 1
      if (state.ring.ko || turn >= last) {
        if (show.bouts[bout]?.skipReplay) return afterBout({ ...state, floor: state.ring }, bout)
        const replay = show.bouts[bout]?.replay as Line
        return {
          ...state,
          floor: state.ring,
          stage: { kind: 'replay', bout },
          line: { id: `${show.prefix}b${bout + 1}-replay`, line: replay },
        }
      }
      return {
        ...state,
        floor: state.ring,
        stage: { kind: 'turn', bout, turn: turn + 1, beat: 'think' },
      }
    }
    case 'replay':
      return afterBout(state, stage.bout)
    case 'final':
      return state
  }
}

export function ringPlayerReducer(state: Player, action: Action): Player {
  switch (action.type) {
    case 'start':
      return advance(state)
    case 'advance':
      return action.run === state.run ? advance(state) : state
    case 'floor':
      return action.run === state.run ? { ...state, floor: state.ring } : state
    case 'toggle':
      return { ...state, playing: !state.playing }
    case 'restart':
      return createRingPlayer(state.show, state.run + 1, { kind: 'bell', bout: 0 })
  }
}

const stageKey = (stage: Stage) =>
  stage.kind === 'turn'
    ? `turn-${stage.bout}-${stage.turn}-${stage.beat}`
    : 'bout' in stage
      ? `${stage.kind}-${stage.bout}`
      : stage.kind

type Fx = {
  moods: Partial<Record<Fighter, Mood>>
  pops: Pop[]
  sparks: Spark[]
  banner: { id: number; text: string; fighter?: Fighter | undefined } | null
  says: Partial<Record<Fighter, string>>
  /** True once a replay has rewound to the highlight; the floor flips at its landing cue. */
  rewinding: boolean
  replayLanded: boolean
}

const NO_FX: Fx = {
  moods: {},
  pops: [],
  sparks: [],
  banner: null,
  says: {},
  rewinding: false,
  replayLanded: false,
}

const voiceUrl = (id: string, line: Line) =>
  `${import.meta.env.BASE_URL}${VOICE_DIR}/${lineFile(id, line)}`

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The Ring tab: the newest fight real models played, or the scripted demo. Picking another show
 * starts it over from its intro card.
 */
export function Ring() {
  const [id, setId] = useState(SHOWS[0]?.id)
  const show = SHOWS.find((s) => s.id === id) ?? SHOWS[0]
  if (!show) return null
  return <RingCast key={show.id} show={show} onPick={setId} />
}

/**
 * One show of The Ring, played through the real engine. Each turn has four beats: action captions
 * appear beside the ring, moves lock in, both moves are revealed together, then the moves
 * land with hit-stop, shake and knockback. Two commentators call it. Everything fits one frame;
 * nothing scrolls. `autoStart` and `onEnd` let a full show run the round without a click.
 */
export function RingCast({
  show,
  onPick,
  autoStart = false,
  onEnd,
  onPlayingChange,
}: {
  show: Show
  onPick?: (id: string) => void
  autoStart?: boolean
  onEnd?: (winner: Fighter | null) => void
  onPlayingChange?: (playing: boolean) => void
}) {
  const [player, dispatch] = useReducer(ringPlayerReducer, show, (s) => createRingPlayer(s))
  const [fx, setFx] = useState<Fx>(NO_FX)
  const [muted, setMuted] = useMuted()
  const playback = usePlayback(player.playing)
  const [speaking, setSpeaking] = useState(false)
  const speech = useRef<ReturnType<typeof speak> | null>(null)

  useEffect(() => onPlayingChange?.(player.playing), [onPlayingChange, player.playing])

  const wrap = useRef<Record<Fighter, HTMLDivElement | null>>({ claude: null, gpt: null })
  const shadow = useRef<Record<Fighter, HTMLDivElement | null>>({ claude: null, gpt: null })
  const body = useRef<Record<Fighter, HTMLDivElement | null>>({ claude: null, gpt: null })
  const shakeRef = useRef<HTMLDivElement | null>(null)
  // Effect ids keep counting across beats, since pops outlive the beat that made them.
  const fxId = useRef(0)

  // Effects read the latest player through a ref; each stage runs its work exactly once.
  const latest = useRef(player)
  latest.current = player
  const waiting = useRef<(() => void) | null>(null)

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

  // Commentary belongs to the match, so a new animation beat must not cut it off.
  // Restart and unmount still stop the old match's voice immediately.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup follows the match run
  useLayoutEffect(() => {
    setSpeaking(false)
    return () => {
      const voice = speech.current
      speech.current = null
      voice?.stop()
    }
  }, [player.run])

  const key = `${stageKey(player.stage)}:${player.run}`

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per stage, keyed by `key`
  useLayoutEffect(() => {
    const { stage, run } = latest.current
    let cancelled = false
    const timers: number[] = []
    const animations: Animation[] = []
    const later = (ms: number, fn: () => void) => {
      timers.push(playback.setTimeout(() => !cancelled && fn(), ms))
    }
    const sleep = (ms: number) => new Promise<void>((resolve) => later(ms, resolve))
    const done = (...waits: Promise<void>[]) => {
      void Promise.all(waits).then(() => {
        if (!cancelled) finish(run)
      })
    }
    const say = (id: string, line: Line) => {
      setSpeaking(true)
      const voice = speak(voiceUrl(id, line), line.text)
      speech.current = voice
      return voice.done.then(() => {
        if (speech.current === voice) {
          speech.current = null
          setSpeaking(false)
        }
      })
    }

    const onCue = (cue: Cue, landedFloor: () => void) => {
      switch (cue.type) {
        case 'sound':
          playSound(cue.sound)
          return
        case 'shake': {
          const el = shakeRef.current
          if (!el || reducedMotion()) return
          const a = 6 * cue.power
          animations.push(
            playback.track(
              el.animate(
                [
                  { translate: '0 0' },
                  { translate: `${a}px ${-a * 0.6}px` },
                  { translate: `${-a * 0.8}px ${a * 0.5}px` },
                  { translate: `${a * 0.5}px ${a * 0.3}px` },
                  { translate: `${-a * 0.25}px ${-a * 0.2}px` },
                  { translate: '0 0' },
                ],
                { duration: 240 + 60 * cue.power, easing: 'ease-out' },
              ),
            ),
          )
          return
        }
        case 'flash': {
          const el = body.current[cue.fighter]
          if (el && !reducedMotion()) {
            animations.push(
              playback.track(
                el.animate([{ filter: 'brightness(2.6) saturate(0.3)' }, { filter: 'none' }], {
                  duration: 240,
                  easing: 'ease-out',
                }),
              ),
            )
          }
          return
        }
        case 'spark': {
          const id = fxId.current++
          setFx((f) => ({ ...f, sparks: [...f.sparks, { id, x: cue.x, y: cue.y }] }))
          later(700, () => setFx((f) => ({ ...f, sparks: f.sparks.filter((s) => s.id !== id) })))
          return
        }
        case 'mood':
          setFx((f) => {
            const moods = { ...f.moods }
            if (cue.mood) moods[cue.fighter] = cue.mood
            else delete moods[cue.fighter]
            return { ...f, moods }
          })
          return
        case 'pop': {
          const id = fxId.current++
          const pop = { id, fighter: cue.fighter, text: cue.text, tone: cue.tone }
          setFx((f) => ({ ...f, pops: [...f.pops, pop] }))
          later(1300, () => setFx((f) => ({ ...f, pops: f.pops.filter((p) => p.id !== id) })))
          return
        }
        case 'banner': {
          const id = fxId.current++
          setFx((f) => ({ ...f, banner: { id, text: cue.text, fighter: cue.fighter } }))
          if (!cue.text.endsWith('K.O.')) {
            later(1500, () => setFx((f) => (f.banner?.id === id ? { ...f, banner: null } : f)))
          }
          return
        }
        case 'floor':
          landedFloor()
          return
      }
    }

    /** Plays a choreography: fighters and shadows through their frames, cues on time. */
    const perform = (choreo: Choreo, landedFloor: () => void) => {
      for (const fighter of FIGHTERS) {
        const frames = choreo.frames[fighter].map((frame) => ({
          left: `${(frame.x / show.arena.width) * 100}%`,
          top: `${(frame.y / show.arena.height) * 100}%`,
          opacity: frame.opacity,
          offset: Math.min(1, frame.at / choreo.duration),
          easing: 'cubic-bezier(0.25, 0.8, 0.3, 1)',
        }))
        const last = frames.at(-1)
        if (last && last.offset < 1) frames.push({ ...last, offset: 1 })
        for (const el of [wrap.current[fighter], shadow.current[fighter]]) {
          if (el)
            animations.push(
              playback.track(
                el.animate(reducedMotion() ? frames.slice(-1) : frames, {
                  duration: reducedMotion() ? 1 : choreo.duration,
                  fill: 'both',
                }),
              ),
            )
        }
      }
      for (const cue of choreo.cues) later(cue.at, () => onCue(cue, landedFloor))
    }

    switch (stage.kind) {
      case 'intro':
      case 'final':
        break
      case 'bell': {
        setFx(NO_FX)
        bell(3)
        playSound('roar')
        done(
          sleep(BELL_MS),
          say(`${show.prefix}b${stage.bout + 1}-bell`, show.bouts[stage.bout]?.bell as Line),
        )
        break
      }
      case 'turn': {
        const script = show.bouts[stage.bout]?.turns[stage.turn]
        if (!script) break
        if (stage.beat === 'think') {
          setFx((f) => ({ ...f, says: {}, moods: {}, banner: null }))
          done(sleep(pace(script).think))
        } else if (stage.beat === 'lock') {
          lockTick()
          later(190, lockTick)
          done(sleep(BEAT.lock))
        } else if (stage.beat === 'reveal') {
          revealClack()
          done(sleep(BEAT.reveal))
        } else {
          const turn = latest.current.played[stage.bout]?.[stage.turn]
          if (!turn) break
          const says: Partial<Record<Fighter, string>> = {}
          for (const fighter of FIGHTERS) {
            const line = script[fighter].say
            if (line) says[fighter] = line
          }
          setFx((f) => ({ ...f, says }))
          const choreo = choreograph(turn.before, turn.events)
          perform(choreo, () => dispatch({ type: 'floor', run }))
          // Keep the call alongside this action and let it finish before the next turn.
          // Both the animation clock and voice preserve their position when paused.
          done(
            sleep(choreo.duration),
            ...(script.line
              ? [say(`${show.prefix}b${stage.bout + 1}-t${stage.turn + 1}`, script.line)]
              : []),
          )
        }
        break
      }
      case 'replay': {
        const bout = show.bouts[stage.bout]
        const turn = bout && latest.current.played[stage.bout]?.[bout.highlight]
        if (!bout || !turn) {
          done(sleep(0))
          break
        }
        const ko = latest.current.ring.ko
        const bothOut = FIGHTERS.every((fighter) => isKnockedOut(latest.current.ring, fighter))
        setFx({
          ...NO_FX,
          banner: ko
            ? {
                id: -1,
                text: bothOut ? 'DOUBLE K.O.' : 'K.O.',
                fighter: bothOut ? undefined : ko,
              }
            : null,
        })
        // Let the live moment breathe before rewinding.
        later(ko ? 1300 : 350, () => {
          setFx({ ...NO_FX, rewinding: true })
          const choreo = slowed(choreograph(turn.before, turn.events), REPLAY_SLOW)
          perform(choreo, () => setFx((f) => ({ ...f, replayLanded: true })))
          done(
            sleep(choreo.duration + 400),
            say(`${show.prefix}b${stage.bout + 1}-replay`, bout.replay),
          )
        })
        break
      }
    }

    return () => {
      cancelled = true
      for (const timer of timers) playback.clearTimeout(timer)
      for (const animation of animations) animation.cancel()
    }
  }, [key, finish])

  const { stage, ring } = player
  const replay =
    stage.kind === 'replay'
      ? player.played[stage.bout]?.[show.bouts[stage.bout]?.highlight ?? -1]
      : null
  const rewound = stage.kind === 'replay' && replay && fx.rewinding ? replay : null
  const positions = rewound ? rewound.after : ring
  const floor = rewound ? (fx.replayLanded ? rewound.after : rewound.before) : player.floor
  const final = stage.kind === 'final'
  const champ = final ? winner(ring) : null
  // A full show moves on once the final card has had its moment. The callback lives in a ref: the
  // show re-renders every tick of its clock, and a new callback must not restart the wait.
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd
  useEffect(() => {
    if (!final) return
    const timer = playback.setTimeout(() => onEndRef.current?.(champ), 4000)
    return () => playback.clearTimeout(timer)
  }, [final, champ, playback])

  /** The turn whose action captions the panels show. */
  const shownTurn =
    stage.kind === 'turn'
      ? { bout: stage.bout, turn: stage.turn }
      : stage.kind === 'replay'
        ? { bout: stage.bout, turn: show.bouts[stage.bout]?.highlight ?? 0 }
        : final
          ? { bout: show.bouts.length - 1, turn: (player.played.at(-1)?.length ?? 1) - 1 }
          : null
  const script = shownTurn ? show.bouts[shownTurn.bout]?.turns[shownTurn.turn] : undefined
  const { think: thinkMs, typeMs } = pace(script)
  const beat = stage.kind === 'turn' ? stage.beat : null
  // Before impact the engine state is the start of this turn; from impact on, it is the end.
  const current = stage.kind === 'turn' ? player.played[stage.bout]?.at(-1) : undefined
  const startOfTurn = beat === 'impact' && current ? current.before : ring
  const sitsOut = (fighter: Fighter) => beat !== null && startOfTurn.fighters[fighter].stunned > 0

  const moodOf = (fighter: Fighter): Mood => {
    const cued = fx.moods[fighter]
    if (cued) return cued
    if (isKnockedOut(ring, fighter) && (final || (stage.kind === 'replay' && !rewound))) return 'ko'
    if (champ === fighter) return 'happy'
    if (floor.fighters[fighter].stunned > 0 || sitsOut(fighter)) return 'down'
    if (beat === 'think') return 'think'
    if (beat === 'lock' || beat === 'reveal') return 'locked'
    return 'idle'
  }
  const moods = { claude: moodOf('claude'), gpt: moodOf('gpt') }

  const badges: Partial<Record<Fighter, Badge>> = {}
  const counting: Partial<Record<Fighter, boolean>> = {}
  for (const fighter of FIGHTERS) {
    if (sitsOut(fighter)) {
      if (beat === 'think') counting[fighter] = true
      continue
    }
    if (beat === 'lock') badges[fighter] = { kind: 'lock' }
    if (beat === 'reveal' && script) badges[fighter] = { kind: 'move', move: script[fighter].move }
  }

  const start = () => {
    unlock()
    dispatch({ type: 'start' })
  }
  // A full show starts the round itself; its one click already unlocked the sound.
  useOnce(autoStart, () => dispatch({ type: 'start' }))
  const restart = () => {
    unlock()
    waiting.current = null
    setFx(NO_FX)
    dispatch({ type: 'restart' })
  }
  const toggleMute = () => {
    setMuted(!muted)
  }

  // The scoreboard stays live through replays, like a broadcast; only the floor rewinds.
  const live = player.floor
  const score = { claude: live.fighters.claude.score, gpt: live.fighters.gpt.score }
  const leader = score.claude === score.gpt ? null : score.claude > score.gpt ? 'claude' : 'gpt'
  // Screen sides follow the corners, so when the fighters change corners at the bell, so do they.
  const left = leftCorner(live.arena)
  const right = other(left)
  const bout = 'bout' in stage ? stage.bout : final ? show.bouts.length - 1 : 0
  const turns = show.bouts[bout]?.turns.length ?? 0

  return (
    <PlaybackContext.Provider value={playback}>
      <section
        role={onEnd ? undefined : 'main'}
        className="cast ring"
        data-paused={flag(!player.playing && player.stage.kind !== 'intro')}
        aria-label="The Ring"
        data-replay={flag(Boolean(rewound))}
      >
        {!onEnd && <h1 className="sr-only">The Ring</h1>}
        <header className="cast__hud">
          <span className="cast__score" data-side="left">
            {CORNERS[left].name}
            <b className="num" data-lead={flag(leader === left)}>
              {score[left]}
            </b>
          </span>
          <span className="cast__clock">
            <ShotClock beat={beat} id={key} ms={thinkMs} />
            <span className="cast__when">
              {stage.kind === 'intro'
                ? 'The Ring · Learning by doing'
                : final
                  ? ring.ko
                    ? 'Final · Knockout'
                    : 'Final'
                  : stage.kind === 'replay'
                    ? `Replay · Bout ${bout + 1}`
                    : stage.kind === 'bell'
                      ? `Bout ${bout + 1} of ${show.bouts.length}`
                      : `Bout ${bout + 1} · Turn ${stage.turn + 1} of ${turns}`}
            </span>
          </span>
          <span className="cast__score" data-side="right">
            <b className="num" data-lead={flag(leader === right)}>
              {score[right]}
            </b>
            {CORNERS[right].name}
          </span>
        </header>

        {FIGHTERS.map((fighter) => (
          <ThoughtPanel
            key={fighter}
            fighter={fighter}
            place={fighter === left ? 'left' : 'right'}
            side={script?.[fighter]}
            stage={stage}
            down={sitsOut(fighter)}
            knockdowns={live.fighters[fighter].knockdowns}
            champ={champ}
            koed={final && isKnockedOut(ring, fighter)}
            typing={beat === 'think'}
            typeMs={typeMs}
          />
        ))}

        <div className="cast__stage">
          <Board
            positions={positions}
            floor={floor}
            moods={moods}
            says={fx.says}
            badges={badges}
            counting={counting}
            pops={fx.pops}
            sparks={fx.sparks}
            glide={stage.kind === 'bell'}
            refs={{ wrap, shadow, body }}
            shakeRef={shakeRef}
          />
          {fx.banner && (
            <div
              key={fx.banner.id}
              className="cast__banner"
              data-ko={flag(fx.banner.text.endsWith('K.O.'))}
              style={
                {
                  '--side': fx.banner.fighter ? `var(--${fx.banner.fighter})` : 'var(--text)',
                } as CSSProperties
              }
              aria-live="assertive"
            >
              {fx.banner.text}
            </div>
          )}
          {rewound && (
            <>
              <span className="cast__letterbox" data-edge="top" aria-hidden="true" />
              <span className="cast__letterbox" data-edge="bottom" aria-hidden="true" />
              <span className="cast__replay-tag">Replay</span>
            </>
          )}
          {stage.kind === 'intro' && (
            <div className="cast__card">
              <span className="eyebrow">Round 1 · Learning by doing · ARC-AGI-3</span>
              <h2 className="cast__title">The Ring</h2>
              <p className="cast__rules">{show.ruleText}</p>
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
                Ring the bell
              </Button>
              <p className="cast__fine">{show.fine}</p>
            </div>
          )}
          {final && (
            <div className="cast__card" data-final="">
              <span className="eyebrow">
                {ring.ko
                  ? `${FIGHTERS.every((fighter) => isKnockedOut(ring, fighter)) ? 'Double knockout' : 'Knockout'} · Bout ${bout + 1}`
                  : 'Final bell'}
              </span>
              <h2 className="cast__title" style={{ color: champ ? `var(--${champ})` : undefined }}>
                {champ ? `${CORNERS[champ].name} wins` : 'A draw'}
              </h2>
              <p className="cast__rules">
                {`Points ${score.claude}–${score.gpt} · Knockdowns ${live.fighters.claude.knockdowns}–${live.fighters.gpt.knockdowns}`}
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
            {player.line && (
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

/** Drains during the action caption; locks at the move reveal. */
function ShotClock({ beat, id, ms }: { beat: Beat | null; id: string; ms: number }) {
  if (beat === 'lock' || beat === 'reveal') {
    return (
      <span className="cast__shot" data-locked="">
        <Lock size={12} strokeWidth={2.5} aria-hidden="true" />
      </span>
    )
  }
  return (
    <span className="cast__shot" aria-hidden="true">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle className="cast__shot-track" cx="12" cy="12" r="9" />
        {beat === 'think' && (
          <circle
            key={id}
            className="cast__shot-fill"
            cx="12"
            cy="12"
            r="9"
            style={{ animationDuration: `${ms}ms` }}
          />
        )}
      </svg>
    </span>
  )
}

/** A fighter's recorded action, typed out beside the ring like a broadcast graphic. */
function ThoughtPanel({
  fighter,
  place,
  side,
  stage,
  down,
  knockdowns,
  champ,
  koed,
  typing,
  typeMs,
}: {
  fighter: Fighter
  place: 'left' | 'right'
  side: DemoSide | undefined
  stage: Stage
  down: boolean
  knockdowns: number
  champ: Fighter | null
  koed: boolean
  typing: boolean
  typeMs: number
}) {
  const beat = stage.kind === 'turn' ? stage.beat : null
  const thought =
    stage.kind === 'intro' || stage.kind === 'bell'
      ? 'In the corner, waiting for the bell.'
      : (side?.think ?? '')
  const typed = useTyped(thought, typing, typeMs)
  const Move = side ? MOVE_ICON[side.move] : null

  let status: ReactNode
  if (koed)
    status = (
      <span className="cast__status" data-tone="loss">
        Knocked out
      </span>
    )
  else if (champ === fighter)
    status = (
      <span className="cast__status" data-tone="win">
        Winner
      </span>
    )
  else if (stage.kind === 'replay') status = <span className="cast__status">Replay · action</span>
  else if (down)
    status = (
      <span className="cast__status" data-tone="loss">
        Down
      </span>
    )
  else if (beat === 'think')
    status = (
      <span className="cast__status" data-thinking="">
        Action
      </span>
    )
  else if (beat === 'lock')
    status = (
      <span className="cast__status" data-tone="lock">
        <Lock size={12} strokeWidth={2.5} aria-hidden="true" /> Locked in
      </span>
    )
  else if ((beat === 'reveal' || beat === 'impact') && side?.flag)
    status = (
      <span className="cast__status" data-tone="loss">
        {side.flag}
      </span>
    )
  else if ((beat === 'reveal' || beat === 'impact') && side && Move)
    status = (
      <span className="cast__move" key={`${stage.kind}-${side.think}`}>
        <Move size={20} strokeWidth={2.5} aria-hidden="true" />
        {MOVE_LABEL[side.move]}
      </span>
    )
  else status = <span className="cast__status">Corner</span>

  return (
    <aside
      className="cast__panel"
      data-side={place}
      style={{ '--side': `var(--${fighter})` } as CSSProperties}
      aria-label={`${CORNERS[fighter].name} action`}
    >
      <div className="cast__panel-head">
        <span className="cast__panel-name">{CORNERS[fighter].name}</span>
        <span className="cast__pips" title={`${knockdowns} of ${KO_AT} knockdowns`}>
          {Array.from({ length: KO_AT }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: pips are positional
            <i key={i} data-on={flag(i < knockdowns)} />
          ))}
        </span>
      </div>
      <div className="cast__panel-status">{status}</div>
      <p
        className="cast__thought"
        data-typing={flag(typing && typed.length < thought.length)}
        data-referee={flag(Boolean(side?.flag) && stage.kind !== 'intro' && stage.kind !== 'bell')}
      >
        {typed}
      </p>
    </aside>
  )
}
