import { Check, Eye, Mic, Pause, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react'
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
import { CORNERS } from '../../arena/corners.ts'
import { flag } from '../../lib/cx.ts'
import { PlaybackContext, useMuted, useOnce, usePlayback, useTyped } from '../../lib/hooks.ts'
import { Button, IconButton, Select } from '../../ui/index.ts'
import { bell, playSound, speak, unlock } from '../audio.ts'
import { type Line, lineFile, VOICE_DIR, VOICES } from '../commentary.ts'
import { Face, type Mood } from '../Face.tsx'
import { type Fighter, other } from '../ring/arena.ts'
import { type Calibration, calibrate } from './calibration.ts'
import type { ScriptedHand } from './demo.ts'
import { lineId } from './live.ts'
import { type BluffShow, SHOWS } from './shows.ts'
import { type Action, anteFor, isRight, START_STACK } from './table.ts'
import { type Beat, type HandPlay, playScript, type Snapshot } from './timeline.ts'

const NAMES: Record<Fighter, string> = { claude: CORNERS.claude.name, gpt: CORNERS.gpt.name }

/** How long each beat holds, in milliseconds. The pot beat also waits for its call. */
const HOLD: Record<Beat['kind'], number> = {
  deal: 1300,
  hole: 3400,
  move: 2500,
  showdown: 2300,
  pot: 1800,
}

type Stage =
  | { kind: 'intro' }
  | { kind: 'hand'; hand: number; beat: number }
  | { kind: 'calibration' }
  | { kind: 'final' }

type Player = {
  stage: Stage
  line: { id: string; line: Line } | null
  playing: boolean
  run: number
}

type Command =
  | { type: 'start' }
  | { type: 'advance'; run: number }
  | { type: 'line'; run: number; id: string; line: Line }
  | { type: 'toggle' }
  | { type: 'restart' }

/** What the player needs from a show: its hands played through the engine, and its lines. */
type Cast = { show: BluffShow; plays: HandPlay[] }

const fresh = (cast: Cast, run = 0, playing = false): Player => ({
  stage: playing ? { kind: 'hand', hand: 0, beat: 0 } : { kind: 'intro' },
  line: playing ? { id: cast.show.prefix + lineId.intro, line: cast.show.intro } : null,
  playing,
  run,
})

function advance(state: Player, { show, plays }: Cast): Player {
  const { stage } = state
  switch (stage.kind) {
    case 'intro':
      return {
        ...state,
        stage: { kind: 'hand', hand: 0, beat: 0 },
        line: { id: show.prefix + lineId.intro, line: show.intro },
        playing: true,
      }
    case 'hand': {
      const play = plays[stage.hand]
      if (play && stage.beat + 1 < play.beats.length)
        return { ...state, stage: { ...stage, beat: stage.beat + 1 } }
      const knockedOut = play?.after.out
      if (!knockedOut && stage.hand + 1 < plays.length) {
        return { ...state, stage: { kind: 'hand', hand: stage.hand + 1, beat: 0 } }
      }
      return {
        ...state,
        stage: { kind: 'calibration' },
        line: { id: show.prefix + lineId.calibration, line: show.calibration },
      }
    }
    case 'calibration':
      return { ...state, stage: { kind: 'final' } }
    case 'final':
      return state
  }
}

function reducer(cast: Cast) {
  return (state: Player, action: Command): Player => {
    switch (action.type) {
      case 'start':
        return advance(state, cast)
      case 'advance':
        return action.run === state.run ? advance(state, cast) : state
      case 'line':
        return action.run === state.run
          ? { ...state, line: { id: action.id, line: action.line } }
          : state
      case 'toggle':
        return { ...state, playing: !state.playing }
      case 'restart':
        return fresh(cast, state.run + 1, true)
    }
  }
}

const stageKey = (stage: Stage) =>
  stage.kind === 'hand' ? `hand-${stage.hand}-${stage.beat}` : stage.kind

const voiceUrl = (id: string, line: Line) =>
  `${import.meta.env.BASE_URL}${VOICE_DIR}/${lineFile(id, line)}`

/** What an action looks like on its chip. */
function actionLabel(action: Action): string {
  switch (action.kind) {
    case 'claim':
      return `Claim · ${action.answer} · bet ${action.bet}`
    case 'counter':
      return `Counter · ${action.answer} · +${action.raise}`
    case 'pass':
      return 'Pass'
    case 'fold':
      return 'Fold'
    case 'call':
      return 'Call'
  }
}

/** The Bluff tab: the newest real fight, with the others and the scripted demo a pick away. */
export function Bluff() {
  const [id, setId] = useState(SHOWS[0]?.id)
  const show = SHOWS.find((s) => s.id === id) ?? SHOWS[0]
  if (!show) return null
  return <BluffCast key={show.id} show={show} onPick={setId} />
}

/**
 * Bluff on air. Poker where the cards are answers: each hand is one question, both models answer
 * in secret, and one claims and bets while the other folds, calls or counters. Viewers see the
 * truth and both secret answers, like poker's hole-card camera; the models do not.
 * `autoStart` and `onEnd` let a full show run the round without a click; `left` overrides the side.
 */
export function BluffCast({
  show,
  onPick,
  autoStart = false,
  onEnd,
  onPlayingChange,
  left: leftOverride,
}: {
  show: BluffShow
  onPick?: (id: string) => void
  autoStart?: boolean
  onEnd?: (winner: Fighter | null) => void
  onPlayingChange?: (playing: boolean) => void
  left?: Fighter
}) {
  const cast = useMemo<Cast>(() => ({ show, plays: playScript(show.hands) }), [show])
  const { plays } = cast
  const hands = show.hands
  const left = leftOverride ?? show.left
  const sides: Fighter[] = [left, other(left)]
  const sideOf = (fighter: Fighter) => (fighter === left ? 'left' : 'right')
  const calibration = useMemo<Record<Fighter, Calibration>>(
    () => ({ claude: calibrate(show.hands, 'claude'), gpt: calibrate(show.hands, 'gpt') }),
    [show],
  )
  const [player, dispatch] = useReducer(reducer(cast), undefined, () => fresh(cast))
  const [muted, setMuted] = useMuted()
  const playback = usePlayback(player.playing)
  useEffect(() => onPlayingChange?.(player.playing), [onPlayingChange, player.playing])
  const [speaking, setSpeaking] = useState(false)
  const latest = useRef(player)
  latest.current = player
  const waiting = useRef<(() => void) | null>(null)
  // The welcome outlives the beat that starts it; restart and leaving the tab stop it.
  const lingering = useRef<(() => void) | null>(null)
  useEffect(() => () => lingering.current?.(), [])

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
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(playback.setTimeout(() => !cancelled && resolve(), ms))
      })
    const say = (id: string, line: Line) => {
      dispatch({ type: 'line', run, id, line })
      setSpeaking(true)
      const voice = speak(voiceUrl(id, line), line.text)
      stops.push(voice.stop)
      return voice.done.then(() => {
        if (!cancelled) setSpeaking(false)
      })
    }
    const done = (waits: Promise<unknown>[]) => {
      void Promise.all(waits).then(() => {
        if (!cancelled) finish(run)
      })
    }

    if (stage.kind === 'hand') {
      const play = plays[stage.hand]
      const step = play?.beats[stage.beat]
      const hand = hands[stage.hand]
      if (!play || !step || !hand) return
      const waits: Promise<unknown>[] = [sleep(HOLD[step.beat.kind])]
      const { beat } = step
      if (beat.kind === 'deal') {
        // The welcome runs under the first deal and hole cards; nothing waits for it.
        if (stage.hand === 0) {
          const id = show.prefix + lineId.intro
          dispatch({ type: 'line', run, id, line: show.intro })
          setSpeaking(true)
          const voice = speak(voiceUrl(id, show.intro), show.intro.text)
          lingering.current = voice.stop
          void voice.done.then(() => setSpeaking(false))
        }
        if (anteFor(stage.hand) > anteFor(stage.hand - 1) && stage.hand > 0) bell(2)
        playSound('chips')
        timers.push(playback.setTimeout(() => playSound('flip'), 450))
      } else if (beat.kind === 'move') {
        const kind = beat.move.action.kind
        playSound(kind === 'fold' || kind === 'pass' ? 'step' : 'chips')
        if (kind === 'counter') playSound('roar')
      } else if (beat.kind === 'showdown') {
        playSound('flip')
        timers.push(playback.setTimeout(() => playSound('thud'), 600))
      } else if (beat.kind === 'pot') {
        const big = beat.result.type === 'win' && beat.result.amount >= 40
        playSound(play.after.out ? 'ko' : big ? 'bigroar' : 'roar')
        playSound('chips')
        waits.push(say(show.prefix + lineId.hand(stage.hand), hand.line))
      }
      done(waits)
    } else if (stage.kind === 'calibration') {
      done([sleep(4500), say(show.prefix + lineId.calibration, show.calibration)])
    } else if (stage.kind === 'final' && onEnd) {
      const last = plays.at(-1)?.after
      const won: Fighter | null = !last
        ? null
        : last.out
          ? other(last.out)
          : last.stacks.claude === last.stacks.gpt
            ? null
            : last.stacks.claude > last.stacks.gpt
              ? 'claude'
              : 'gpt'
      timers.push(playback.setTimeout(() => !cancelled && onEnd(won), 4000))
    }

    return () => {
      cancelled = true
      for (const timer of timers) playback.clearTimeout(timer)
      for (const stop of stops) stop()
    }
  }, [key, finish])

  const { stage } = player
  const handIndex =
    stage.kind === 'hand' ? stage.hand : stage.kind === 'intro' ? 0 : plays.length - 1
  const play = plays[handIndex]
  const hand = hands[handIndex]
  const beatIndex =
    stage.kind === 'hand' ? stage.beat : stage.kind === 'intro' ? -1 : (play?.beats.length ?? 1) - 1
  const shown = play?.beats.slice(0, beatIndex + 1) ?? []
  const current = shown.at(-1)
  const at: Snapshot = current?.at ?? {
    stacks: { claude: START_STACK, gpt: START_STACK },
    pot: 0,
  }
  const final = stage.kind === 'final' || stage.kind === 'calibration'
  const lastState = plays.at(-1)?.after
  const champ: Fighter | null =
    final && lastState
      ? lastState.out
        ? other(lastState.out)
        : lastState.stacks.claude === lastState.stacks.gpt
          ? null
          : lastState.stacks.claude > lastState.stacks.gpt
            ? 'claude'
            : 'gpt'
      : null

  // What each fighter has done this hand, and the answer it put on the table, if any.
  const acted: Partial<Record<Fighter, Action>> = {}
  const staked: Partial<Record<Fighter, Action>> = {}
  let thinking: Partial<Record<Fighter, string>> = {}
  let typingFor: Fighter | 'both' | null = null
  for (const { beat } of shown) {
    if (beat.kind === 'hole' && hand) {
      thinking = { claude: hand.hole.claude.think, gpt: hand.hole.gpt.think }
    }
    if (beat.kind === 'move') {
      const { action } = beat.move
      acted[action.by] = action
      if (action.kind === 'claim' || action.kind === 'counter') staked[action.by] = action
      thinking[action.by] = beat.move.think
    }
  }
  if (current?.beat.kind === 'hole') typingFor = 'both'
  if (current?.beat.kind === 'move') typingFor = current.beat.move.action.by
  const showdown = shown.find((s) => s.beat.kind === 'showdown')?.beat
  const pot = current?.beat.kind === 'pot' ? current.beat.result : null
  const holeOpen = beatIndex >= 1
  const say = current?.beat.kind === 'move' ? current.beat.move.say : undefined

  const moodOf = (fighter: Fighter): Mood => {
    if (champ) return champ === fighter ? 'happy' : lastState?.out === fighter ? 'ko' : 'idle'
    if (pot?.type === 'win') {
      if (play?.after.out === fighter) return 'ko'
      return pot.fighter === fighter ? 'happy' : pot.amount >= 30 ? 'hit' : 'idle'
    }
    if (current?.beat.kind === 'hole') return 'think'
    if (current?.beat.kind === 'move' && current.beat.move.action.by === fighter) return 'locked'
    return 'idle'
  }

  const start = () => {
    unlock()
    dispatch({ type: 'start' })
  }
  // A full show starts the round itself; its one click already unlocked the sound.
  useOnce(autoStart, () => dispatch({ type: 'start' }))
  const restart = () => {
    unlock()
    lingering.current?.()
    waiting.current = null
    dispatch({ type: 'restart' })
  }
  const toggleMute = () => {
    setMuted(!muted)
  }

  const stacks = final && lastState ? lastState.stacks : at.stacks
  const leader = stacks.claude === stacks.gpt ? null : stacks.claude > stacks.gpt ? 'claude' : 'gpt'
  const when =
    stage.kind === 'intro'
      ? 'Bluff · Knowledge'
      : stage.kind === 'calibration'
        ? 'Calibration'
        : stage.kind === 'final'
          ? 'Final'
          : `Hand ${handIndex + 1} of ${show.planned} · Ante ${anteFor(handIndex)}`

  return (
    <PlaybackContext.Provider value={playback}>
      <section
        role={onEnd ? undefined : 'main'}
        className="cast bluff"
        data-paused={flag(!player.playing && player.stage.kind !== 'intro')}
        aria-label="Bluff"
      >
        {!onEnd && <h1 className="sr-only">Bluff</h1>}
        <header className="cast__hud">
          <span className="cast__score" data-side="left">
            {NAMES[sides[0] as Fighter]}
            <b className="num" data-lead={flag(leader === sides[0])}>
              {stacks[sides[0] as Fighter]}
            </b>
          </span>
          <span className="cast__when">{when}</span>
          <span className="cast__score" data-side="right">
            <b className="num" data-lead={flag(leader === sides[1])}>
              {stacks[sides[1] as Fighter]}
            </b>
            {NAMES[sides[1] as Fighter]}
          </span>
        </header>

        {sides.map((fighter) => (
          <aside
            key={fighter}
            className="cast__panel"
            data-side={sideOf(fighter)}
            style={{ '--side': `var(--${fighter})` } as CSSProperties}
            aria-label={`${NAMES[fighter]} action`}
          >
            <div className="cast__panel-head">
              <span className="cast__panel-name">{NAMES[fighter]}</span>
            </div>
            <div className="cast__panel-status">
              <PanelStatus
                fighter={fighter}
                acted={acted[fighter]}
                thinking={current?.beat.kind === 'hole'}
                pot={pot}
                champ={champ}
                out={lastState?.out === fighter && final}
              />
            </div>
            <Thought
              text={
                final
                  ? ''
                  : (thinking[fighter] ?? (stage.kind === 'intro' ? 'Waiting for the deal.' : ''))
              }
              typing={typingFor === 'both' || typingFor === fighter}
            />
          </aside>
        ))}

        <div className="cast__stage">
          {stage.kind === 'calibration' || stage.kind === 'final' ? (
            <CalibrationCard hands={hands} calibration={calibration} sides={sides}>
              {stage.kind === 'final' && (
                <div className="bluff__final">
                  <span className="eyebrow">{lastState?.out ? 'Knockout' : 'Final'}</span>
                  <h2
                    className="cast__title"
                    style={{ color: champ ? `var(--${champ})` : undefined }}
                  >
                    {champ ? `${NAMES[champ]} wins Bluff` : 'A draw'}
                  </h2>
                  <p className="cast__rules">{`Chips ${stacks[left]}–${stacks[other(left)]} · ${plays.length} hands`}</p>
                  <Button size="lg" outline icon={RotateCcw} onClick={restart}>
                    Deal again
                  </Button>
                </div>
              )}
            </CalibrationCard>
          ) : (
            <div className="bluff__table">
              <span className="bluff__felt" aria-hidden="true" />
              {sides.map((fighter) => {
                const hole = hand?.hole[fighter]
                const revealed =
                  showdown?.kind === 'showdown'
                    ? showdown.answers.find((a) => a.by === fighter)
                    : undefined
                // At the showdown the chip shows the answer being judged, not the last thing done.
                const action = revealed ? (staked[fighter] ?? acted[fighter]) : acted[fighter]
                return (
                  <div
                    key={fighter}
                    className="bluff__seat"
                    data-side={sideOf(fighter)}
                    data-win={flag(pot?.type === 'win' && pot.fighter === fighter)}
                    style={{ '--side': `var(--${fighter})` } as CSSProperties}
                  >
                    <div className="bluff__face">
                      <Face
                        mood={moodOf(fighter)}
                        look={{ x: fighter === left ? 1 : -1, y: 0.2 }}
                      />
                      {say &&
                        current?.beat.kind === 'move' &&
                        current.beat.move.action.by === fighter && (
                          <span className="bluff__say" key={say}>
                            {say}
                          </span>
                        )}
                    </div>
                    <span className="bluff__stack">
                      <Chips count={at.stacks[fighter]} />
                      <b className="num">{at.stacks[fighter]}</b>
                    </span>
                    {action && (
                      <span
                        className="bluff__action"
                        key={`${handIndex}-${action.kind}`}
                        data-kind={action.kind}
                      >
                        {actionLabel(action)}
                        {revealed && (
                          <i data-right={flag(revealed.right)}>
                            {revealed.right ? (
                              <Check size={13} strokeWidth={3} aria-label="right" />
                            ) : (
                              <X size={13} strokeWidth={3} aria-label="wrong" />
                            )}
                          </i>
                        )}
                      </span>
                    )}
                    {hole && holeOpen && (
                      <div
                        className="bluff__hole"
                        data-right={
                          hole.submitted === false
                            ? undefined
                            : flag(hand ? isRight(hand.question, hole.answer) : false)
                        }
                      >
                        <span className="bluff__hole-tag">
                          <Eye size={11} strokeWidth={2.5} aria-hidden="true" /> Hole cam · viewers
                          only
                        </span>
                        <strong>{hole.submitted === false ? 'No answer' : hole.answer}</strong>
                        {hole.submitted !== false && <Confidence value={hole.confidence} />}
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="bluff__middle">
                {hand && stage.kind === 'hand' && (
                  <>
                    <p className="bluff__question" key={`q-${handIndex}`}>
                      {hand.question.text}
                    </p>
                    <p className="bluff__truth" key={`t-${handIndex}`}>
                      <span>
                        <Eye size={11} strokeWidth={2.5} aria-hidden="true" /> Truth · viewers only
                      </span>
                      <strong>{hand.question.answer}</strong>
                    </p>
                  </>
                )}
                <span className="bluff__pot" data-moving={flag(pot !== null)}>
                  <Chips count={pot ? 0 : at.pot} />
                  <span>{pot ? <PotResult result={pot} /> : `Pot ${at.pot}`}</span>
                </span>
              </div>
            </div>
          )}
          {stage.kind === 'hand' && play?.after.out && pot && (
            <div
              className="cast__banner"
              data-ko=""
              style={{ '--side': `var(--${other(play.after.out)})` } as CSSProperties}
            >
              K.O.
            </div>
          )}
          {stage.kind === 'intro' && (
            <div className="cast__card">
              <span className="eyebrow">Round 5 · Knowledge · HLE, AA-Omniscience</span>
              <h2 className="cast__title">Bluff</h2>
              <p className="cast__rules">
                Poker where the cards are answers. Both models answer in secret. One claims and
                bets; the other folds, calls or counters. Wrong at a showdown, you lose the pot. Out
                of chips, you are out.
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
                Deal
              </Button>
              <p className="cast__fine">{show.fine}</p>
            </div>
          )}
        </div>

        <footer className="cast__foot">
          <div className="cast__controls">
            <IconButton
              icon={player.playing ? Pause : Play}
              label={player.playing ? 'Pause' : 'Play'}
              tip="none"
              disabled={stage.kind === 'intro' || stage.kind === 'final'}
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

function PanelStatus({
  fighter,
  acted,
  thinking,
  pot,
  champ,
  out,
}: {
  fighter: Fighter
  acted: Action | undefined
  thinking: boolean
  pot: Extract<Beat, { kind: 'pot' }>['result'] | null
  champ: Fighter | null
  out: boolean
}) {
  if (champ) {
    return (
      <span className="cast__status" data-tone={champ === fighter ? 'win' : 'loss'}>
        {champ === fighter ? 'Winner' : out ? 'Knocked out' : 'Runner-up'}
      </span>
    )
  }
  if (pot?.type === 'win') {
    return pot.fighter === fighter ? (
      <span className="cast__status" data-tone="win">{`Takes ${pot.amount}`}</span>
    ) : (
      <span className="cast__status">Loses the pot</span>
    )
  }
  if (thinking)
    return (
      <span className="cast__status" data-thinking="">
        Action
      </span>
    )
  if (acted)
    return (
      <span className="cast__status" data-tone="lock">
        {actionLabel(acted)}
      </span>
    )
  return <span className="cast__status">Waiting</span>
}

function PotResult({ result }: { result: Extract<Beat, { kind: 'pot' }>['result'] }): ReactNode {
  if (result.type === 'win') {
    return (
      <>
        <b style={{ color: `var(--${result.fighter})` }}>{NAMES[result.fighter]}</b>
        {` takes ${result.amount}${result.shown ? '' : ', unseen'}`}
      </>
    )
  }
  if (result.type === 'split') return `Split ${result.amount}`
  return `${result.amount} carries over`
}

/** A small pile of chips; the pile grows with the count, up to a point. */
function Chips({ count }: { count: number }) {
  const n = Math.min(6, Math.ceil(count / 12))
  return (
    <span className="bluff__chips" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: chips are positional
        <i key={i} style={{ '--i': i } as CSSProperties} />
      ))}
    </span>
  )
}

/** Stated confidence as ten dots. */
function Confidence({ value }: { value: number }) {
  return (
    <span className="bluff__sure" role="img" aria-label={`${value}% sure`}>
      <span className="bluff__dots">
        {Array.from({ length: 10 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: dots are positional
          <i key={i} data-on={flag(i < Math.round(value / 10))} />
        ))}
      </span>
      {`${value}% sure`}
    </span>
  )
}

function Thought({ text, typing }: { text: string; typing: boolean }) {
  const typed = useTyped(text, typing)
  return (
    <p className="cast__thought" data-typing={flag(typing && typed.length < text.length)}>
      {typed}
    </p>
  )
}

/**
 * How sure each model said it was, hand by hand, against whether it was right. One row per model,
 * named, so the corner colors are never the only way to tell them apart; right and wrong are
 * filled and hollow marks with a tick or a cross.
 */
function CalibrationCard({
  children,
  hands,
  calibration,
  sides,
}: {
  children?: ReactNode
  hands: readonly ScriptedHand[]
  calibration: Record<Fighter, Calibration>
  sides: readonly Fighter[]
}) {
  const W = 360
  const H = 92
  const x = (hand: number) => 40 + ((hand - 1) / Math.max(1, hands.length - 1)) * (W - 64)
  const y = (pct: number) => H - 10 - (pct / 100) * (H - 20)
  return (
    <div className="bluff__calibration">
      {children}
      <span className="eyebrow">How sure they said they were · how often they were right</span>
      {sides.map((fighter) => {
        const c = calibration[fighter]
        const missing = hands.length - c.points.length
        const summary = c.points.length
          ? `Said ${Math.round(c.said)}% sure · right ${c.hits} of ${c.points.length} (${Math.round(c.right)}%)${missing ? ` · ${missing} missing excluded` : ''}`
          : 'No submitted answers'
        return (
          <figure
            key={fighter}
            className="bluff__cal-row"
            style={{ '--side': `var(--${fighter})` } as CSSProperties}
          >
            <figcaption>
              <span className="bluff__cal-name">{NAMES[fighter]}</span>
              <span>{summary}</span>
            </figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${NAMES[fighter]}: ${summary}`}>
              {[0, 50, 100].map((g) => (
                <g key={g}>
                  <line className="bluff__grid" x1={24} x2={W - 16} y1={y(g)} y2={y(g)} />
                  <text className="bluff__axis" x={18} y={y(g) + 3} textAnchor="end">
                    {g === 0 ? '0' : `${g}%`}
                  </text>
                </g>
              ))}
              {c.points.map((p) => (
                <text
                  key={`h${p.hand}`}
                  className="bluff__axis"
                  x={x(p.hand)}
                  y={H + 6}
                  textAnchor="middle"
                >
                  {p.hand}
                </text>
              ))}
              {c.points.length > 0 && (
                <>
                  <line className="bluff__said" x1={24} x2={W - 16} y1={y(c.said)} y2={y(c.said)} />
                  <line
                    className="bluff__hit"
                    x1={24}
                    x2={W - 16}
                    y1={y(c.right)}
                    y2={y(c.right)}
                  />
                </>
              )}
              {c.points.map((p) => (
                <g
                  key={p.hand}
                  className="bluff__point"
                  data-right={flag(p.right)}
                  transform={`translate(${x(p.hand)} ${y(p.confidence)})`}
                >
                  <title>{`Hand ${p.hand}: ${hands[p.hand - 1]?.hole[fighter].answer} at ${p.confidence}% sure, ${p.right ? 'right' : 'wrong'}`}</title>
                  <circle r="6" />
                  {p.right ? (
                    <path d="M-2.6 0.2 L-0.8 2 L2.8 -2" />
                  ) : (
                    <path d="M-2.2 -2.2 L2.2 2.2 M2.2 -2.2 L-2.2 2.2" />
                  )}
                </g>
              ))}
            </svg>
          </figure>
        )
      })}
      <p className="bluff__cal-key">
        <span data-kind="said">Said (average)</span>
        <span data-kind="hit">Right (share)</span>
        <span data-kind="right">Right answer</span>
        <span data-kind="wrong">Wrong answer</span>
      </p>
      <table className="sr-only">
        <caption>Each model’s secret answer, stated confidence and result, hand by hand</caption>
        <thead>
          <tr>
            <th scope="col">Hand</th>
            {sides.map((f) => (
              <th key={f} scope="col">
                {NAMES[f]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hands.map((h, i) => (
            <tr key={h.question.text}>
              <th scope="row">{i + 1}</th>
              {sides.map((f) => (
                <td key={f}>
                  {h.hole[f].submitted === false
                    ? 'No answer; excluded from calibration'
                    : `${h.hole[f].answer}, ${h.hole[f].confidence}% sure, ${isRight(h.question, h.hole[f].answer) ? 'right' : 'wrong'}`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
