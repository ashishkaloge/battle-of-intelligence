import { Check, Lock, Mic, Pause, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react'
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
import { FIGHTERS, type Fighter, other } from '../ring/arena.ts'
import { lineId } from './live.ts'
import { REVEALS, VALUES } from './quiz.ts'
import { type BuzzerShow, SHOWS } from './shows.ts'
import { type Beat, playScript, type TossupPlay } from './timeline.ts'

/** Powers, negs and steals per model across the round, for the end card. */
function statsOf(plays: readonly TossupPlay[]) {
  const zero = () => ({ claude: 0, gpt: 0 })
  const stats = { powers: zero(), negs: zero(), steals: zero() }
  for (const play of plays) {
    let negged = false
    for (const { beat } of play.beats) {
      if (beat.kind !== 'judge') continue
      for (const b of beat.buzzes) {
        if (!b.right) stats.negs[b.fighter] += 1
        else if (negged) stats.steals[b.fighter] += 1
        else if (beat.reveal === 0) stats.powers[b.fighter] += 1
      }
      if (beat.buzzes.some((b) => !b.right)) negged = true
    }
  }
  return stats
}
const NAMES: Record<Fighter, string> = { claude: CORNERS.claude.name, gpt: CORNERS.gpt.name }

/** How long each beat holds, in milliseconds. Judging and the answer also wait for their call. */
const HOLD: Record<Beat['kind'], number> = {
  card: 1500,
  hint: 1300,
  think: 3100,
  decide: 1200,
  judge: 2200,
  end: 1700,
}

type Stage =
  | { kind: 'intro' }
  | { kind: 'tossup'; tossup: number; beat: number }
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

const fresh = (run = 0, playing = false): Player => ({
  stage: playing ? { kind: 'tossup', tossup: 0, beat: 0 } : { kind: 'intro' },
  line: null,
  playing,
  run,
})

function advance(state: Player, plays: readonly TossupPlay[]): Player {
  const { stage } = state
  if (stage.kind === 'intro') {
    return { ...state, stage: { kind: 'tossup', tossup: 0, beat: 0 }, playing: true }
  }
  if (stage.kind === 'tossup') {
    const play = plays[stage.tossup]
    if (play && stage.beat + 1 < play.beats.length)
      return { ...state, stage: { ...stage, beat: stage.beat + 1 } }
    if (stage.tossup + 1 < plays.length)
      return { ...state, stage: { kind: 'tossup', tossup: stage.tossup + 1, beat: 0 } }
    return { ...state, stage: { kind: 'final' } }
  }
  return state
}

function reducer(plays: readonly TossupPlay[]) {
  return (state: Player, command: Command): Player => {
    switch (command.type) {
      case 'start':
        return advance(state, plays)
      case 'advance':
        return command.run === state.run ? advance(state, plays) : state
      case 'line':
        return command.run === state.run
          ? { ...state, line: { id: command.id, line: command.line } }
          : state
      case 'toggle':
        return { ...state, playing: !state.playing }
      case 'restart':
        return fresh(state.run + 1, true)
    }
  }
}

const stageKey = (stage: Stage) =>
  stage.kind === 'tossup' ? `tossup-${stage.tossup}-${stage.beat}` : stage.kind

const voiceUrl = (id: string, line: Line) =>
  `${import.meta.env.BASE_URL}${VOICE_DIR}/${lineFile(id, line)}`

const LADDER = ['Problem', 'Hint 1', 'Hint 2', 'Hint 3'] as const

/** The Buzzer tab: the newest real fight, with the others and the scripted demo a pick away. */
export function Buzzer() {
  const [id, setId] = useState(SHOWS[0]?.id)
  const show = SHOWS.find((s) => s.id === id) ?? SHOWS[0]
  if (!show) return null
  return <BuzzerCast key={show.id} show={show} onPick={setId} />
}

/**
 * Buzzer on air. A math race measured in clues: each problem climbs a ladder of hints, and at
 * every rung both models decide in secret to buzz or wait. Early and right is a power; wrong is a
 * neg and hands the other side a steal. The answer stays hidden from viewers until someone gets
 * it, so they play along. `autoStart` and `onEnd` let a full show run the round without a click.
 */
export function BuzzerCast({
  show,
  onPick,
  autoStart = false,
  onEnd,
  onPlayingChange,
  left: leftOverride,
}: {
  show: BuzzerShow
  onPick?: (id: string) => void
  autoStart?: boolean
  onEnd?: (winner: Fighter | null) => void
  onPlayingChange?: (playing: boolean) => void
  left?: Fighter
}) {
  const plays = useMemo(() => playScript(show.tossups), [show])
  const stats = useMemo(() => statsOf(plays), [plays])
  const tossups = show.tossups
  const left = leftOverride ?? show.left
  const sides: Fighter[] = [left, other(left)]
  const sideOf = (fighter: Fighter) => (fighter === left ? 'left' : 'right')
  const [player, dispatch] = useReducer(reducer(plays), undefined, () => fresh())
  const [muted, setMuted] = useMuted()
  const playback = usePlayback(player.playing)
  useEffect(() => onPlayingChange?.(player.playing), [onPlayingChange, player.playing])
  const [speaking, setSpeaking] = useState(false)
  const latest = useRef(player)
  latest.current = player
  const waiting = useRef<(() => void) | null>(null)
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

    if (stage.kind === 'tossup') {
      const step = plays[stage.tossup]?.beats[stage.beat]
      const tossup = tossups[stage.tossup]
      if (!step || !tossup) return
      const waits: Promise<unknown>[] = [sleep(HOLD[step.beat.kind])]
      const { beat } = step
      if (beat.kind === 'card') {
        if (stage.tossup === 0) {
          // The welcome runs under the first card; restart and leaving the tab stop it.
          const id = show.prefix + lineId.intro
          dispatch({ type: 'line', run, id, line: show.intro })
          setSpeaking(true)
          const voice = speak(voiceUrl(id, show.intro), show.intro.text)
          lingering.current = voice.stop
          void voice.done.then(() => setSpeaking(false))
        }
        if (tossup.double) bell(3)
        playSound('flip')
      } else if (beat.kind === 'hint') {
        playSound('flip')
      } else if (beat.kind === 'decide') {
        const buzzing = Object.values(beat.turns).some((t) => t?.decision.kind === 'buzz')
        if (buzzing) playSound('buzzer')
        else playSound('step')
      } else if (beat.kind === 'judge') {
        const anyRight = beat.buzzes.some((b) => b.right)
        const anyWrong = beat.buzzes.some((b) => !b.right)
        if (anyWrong) playSound('wrong')
        if (anyRight) {
          timers.push(playback.setTimeout(() => bell(1), anyWrong ? 350 : 0))
          playSound(tossup.double ? 'bigroar' : 'roar')
        }
      } else if (beat.kind === 'end') {
        waits.push(say(show.prefix + lineId.tossup(stage.tossup), tossup.line))
      }
      done(waits)
    } else if (stage.kind === 'final') {
      bell(3)
      playSound('bigroar')
      const sum = plays.reduce(
        (t, p) => ({ claude: t.claude + p.points.claude, gpt: t.gpt + p.points.gpt }),
        { claude: 0, gpt: 0 },
      )
      const won: Fighter | null =
        sum.claude === sum.gpt ? null : sum.claude > sum.gpt ? 'claude' : 'gpt'
      void say(show.prefix + lineId.outro, show.outro).then(() => {
        if (!cancelled) timers.push(playback.setTimeout(() => onEnd?.(won), 2500))
      })
    }

    return () => {
      cancelled = true
      for (const timer of timers) playback.clearTimeout(timer)
      for (const stop of stops) stop()
    }
  }, [key, finish])

  const { stage } = player
  const index =
    stage.kind === 'tossup' ? stage.tossup : stage.kind === 'final' ? plays.length - 1 : 0
  const play = plays[index]
  const tossup = tossups[index]
  const beatIndex =
    stage.kind === 'tossup'
      ? stage.beat
      : stage.kind === 'final'
        ? (play?.beats.length ?? 1) - 1
        : -1
  const shown = play?.beats.slice(0, beatIndex + 1) ?? []
  const current = shown.at(-1)
  const final = stage.kind === 'final'
  const totals = final
    ? plays.reduce(
        (sum, p) => ({ claude: sum.claude + p.points.claude, gpt: sum.gpt + p.points.gpt }),
        { claude: 0, gpt: 0 },
      )
    : (current?.score ?? { claude: 0, gpt: 0 })
  const champ: Fighter | null = final
    ? totals.claude === totals.gpt
      ? null
      : totals.claude > totals.gpt
        ? 'claude'
        : 'gpt'
    : null

  // What happened this tossup so far.
  const reveal = current?.reveal ?? 0
  const buzzes = shown.flatMap((s) => (s.beat.kind === 'judge' ? s.beat.buzzes : []))
  const lockedOut = new Set(buzzes.filter((b) => !b.right).map((b) => b.fighter))
  const ended = current?.beat.kind === 'end' ? current.beat : null
  const deciding = current?.beat.kind === 'decide' ? current.beat : null
  const thinkingBeat = current?.beat.kind === 'think' ? current.beat : null
  const latestTurn: Partial<Record<Fighter, string>> = {}
  for (const { beat } of shown) {
    if (beat.kind === 'think') {
      for (const fighter of FIGHTERS) {
        const turn = beat.turns[fighter]
        if (turn) latestTurn[fighter] = turn.think
      }
    }
  }
  const lastJudge = [...shown].reverse().find((s) => s.beat.kind === 'judge')?.beat
  const judging = current?.beat.kind === 'judge' ? current.beat : null
  // A steal is a right buzz after the other side has already negged this tossup.
  const negBefore = shown
    .slice(0, -1)
    .some((s) => s.beat.kind === 'judge' && s.beat.buzzes.some((b) => !b.right))

  const moodOf = (fighter: Fighter): Mood => {
    if (champ) return champ === fighter ? 'happy' : 'idle'
    const mine = buzzes.find((b) => b.fighter === fighter)
    if (mine && (judging || ended)) return mine.right ? 'happy' : 'hit'
    if (lockedOut.has(fighter)) return 'hit'
    if (thinkingBeat?.turns[fighter]) return 'think'
    if (deciding?.turns[fighter]?.decision.kind === 'buzz') return 'locked'
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

  const leader = totals.claude === totals.gpt ? null : totals.claude > totals.gpt ? 'claude' : 'gpt'
  const value = current?.value ?? VALUES[0] ?? 15
  const when =
    stage.kind === 'intro'
      ? 'Buzzer · Math'
      : final
        ? 'Final'
        : `Tossup ${index + 1} of ${tossups.length}${tossup?.double ? ' · Double' : ''} · Worth ${value}`

  return (
    <PlaybackContext.Provider value={playback}>
      <section
        role={onEnd ? undefined : 'main'}
        className="cast buzzer"
        data-paused={flag(!player.playing && player.stage.kind !== 'intro')}
        aria-label="Buzzer"
      >
        {!onEnd && <h1 className="sr-only">Buzzer</h1>}
        <header className="cast__hud">
          <span className="cast__score" data-side="left">
            {NAMES[left]}
            <b className="num" data-lead={flag(leader === left)}>
              {totals[left]}
            </b>
          </span>
          <span className="cast__when">{when}</span>
          <span className="cast__score" data-side="right">
            <b className="num" data-lead={flag(leader === other(left))}>
              {totals[other(left)]}
            </b>
            {NAMES[other(left)]}
          </span>
        </header>

        {sides.map((fighter) => {
          const working = thinkingBeat?.turns[fighter]
          const buzzed = deciding?.turns[fighter]?.decision
          let status: ReactNode = <span className="cast__status">Waiting</span>
          if (champ) {
            status = (
              <span className="cast__status" data-tone={champ === fighter ? 'win' : undefined}>
                {champ === fighter ? 'Winner' : 'Runner-up'}
              </span>
            )
          } else if (lockedOut.has(fighter) && !ended) {
            status = (
              <span className="cast__status" data-tone="loss">
                <Lock size={12} strokeWidth={2.5} aria-hidden="true" /> Locked out
              </span>
            )
          } else if (working) {
            status = (
              <span className="cast__status" data-thinking="">
                Action
              </span>
            )
          } else if (buzzed?.kind === 'buzz') {
            status = (
              <span className="cast__status" data-tone="lock">{`Buzz · ${buzzed.answer}`}</span>
            )
          } else if (buzzed?.kind === 'wait') {
            status = <span className="cast__status">Waits for a hint</span>
          }
          return (
            <aside
              key={fighter}
              className="cast__panel"
              data-side={sideOf(fighter)}
              style={{ '--side': `var(--${fighter})` } as CSSProperties}
              aria-label={`${NAMES[fighter]}’s action`}
            >
              <div className="cast__panel-head">
                <span className="cast__panel-name">{NAMES[fighter]}</span>
              </div>
              <div className="cast__panel-status">{status}</div>
              <Working
                text={
                  final
                    ? ''
                    : (latestTurn[fighter] ??
                      (stage.kind === 'intro' ? 'Waiting for the first problem.' : ''))
                }
                typing={Boolean(working)}
              />
            </aside>
          )
        })}

        <div className="cast__stage">
          {!final && (
            <div className="buzzer__set">
              {sides.map((fighter) => {
                const mine = buzzes.find((b) => b.fighter === fighter)
                const lit =
                  deciding?.turns[fighter]?.decision.kind === 'buzz' ||
                  Boolean(mine && !ended && judging)
                return (
                  <div
                    key={fighter}
                    className="buzzer__podium"
                    data-side={sideOf(fighter)}
                    style={{ '--side': `var(--${fighter})` } as CSSProperties}
                  >
                    <div className="buzzer__face">
                      <Face
                        mood={moodOf(fighter)}
                        look={{ x: fighter === left ? 1 : -1, y: -0.2 }}
                      />
                    </div>
                    <span
                      className="buzzer__light"
                      data-lit={flag(lit)}
                      data-wrong={flag(
                        Boolean(mine && !mine.right && (judging || lockedOut.has(fighter))),
                      )}
                      data-right={flag(Boolean(mine?.right && (judging || ended)))}
                      aria-hidden="true"
                    />
                    {mine && (lastJudge || ended) && (
                      <span
                        className="buzzer__answer"
                        data-right={flag(mine.right)}
                        key={`${index}-${mine.answer}`}
                      >
                        {mine.answer}
                        {mine.right ? (
                          <Check size={14} strokeWidth={3} aria-label="right" />
                        ) : (
                          <X size={14} strokeWidth={3} aria-label="wrong" />
                        )}
                      </span>
                    )}
                    <span className="buzzer__plate">
                      {NAMES[fighter]}
                      <b className="num">{totals[fighter]}</b>
                    </span>
                  </div>
                )
              })}

              <div className="buzzer__middle">
                {tossup && stage.kind === 'tossup' && (
                  <>
                    <p className="buzzer__problem" key={`p-${index}`}>
                      {tossup.problem.text}
                    </p>
                    <ol className="buzzer__ladder" aria-label="Hint ladder">
                      {LADDER.slice(0, REVEALS).map((label, r) => (
                        <li
                          key={label}
                          data-on={flag(r <= reveal)}
                          data-now={flag(r === reveal && !ended)}
                        >
                          <span>{label}</span>
                          <b>{(VALUES[r] ?? 0) * (tossup.double ? 2 : 1)}</b>
                        </li>
                      ))}
                    </ol>
                    <div className="buzzer__hints">
                      {tossup.problem.hints.slice(0, reveal).map((hint, h) => (
                        <p key={hint} className="buzzer__hint">
                          <span>{`Hint ${h + 1}`}</span>
                          {hint}
                        </p>
                      ))}
                    </div>
                    {ended && (
                      <p className="buzzer__truth" key={`a-${index}`}>
                        <span>Answer</span>
                        <strong>{ended.answer}</strong>
                        {ended.winners.length === 2 ? <em>Dead heat</em> : null}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          {judging?.buzzes.some((b) => !b.right) && !judging.buzzes.some((b) => b.right) && (
            <div
              className="cast__banner buzzer__banner"
              style={{ '--side': 'var(--trap)' } as CSSProperties}
            >
              Neg!
              <small>Steal chance</small>
            </div>
          )}
          {judging?.buzzes.some((b) => b.right) && (
            <div
              className="cast__banner buzzer__banner"
              style={
                {
                  '--side': `var(--${judging.buzzes.find((b) => b.right)?.fighter ?? 'claude'})`,
                } as CSSProperties
              }
            >
              {judging.deadHeat
                ? 'Dead heat!'
                : negBefore
                  ? 'Steal!'
                  : judging.reveal === 0
                    ? 'Power!'
                    : 'Right!'}
            </div>
          )}
          {stage.kind === 'intro' && (
            <div className="cast__card">
              <span className="eyebrow">Round 3 · Math · FrontierMath, AIME</span>
              <h2 className="cast__title">Buzzer</h2>
              <p className="cast__rules">
                A race measured in clues, not milliseconds. Each problem climbs a ladder of hints,
                and at every rung both models buzz or wait. Early and right is a power. Wrong is a
                neg, and the other side gets a steal.
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
                First problem
              </Button>
              <p className="cast__fine">{show.fine}</p>
            </div>
          )}
          {final && (
            <div className="cast__card">
              <span className="eyebrow">Final</span>
              <h2 className="cast__title" style={{ color: champ ? `var(--${champ})` : undefined }}>
                {champ ? `${NAMES[champ]} wins Buzzer` : 'A draw'}
              </h2>
              <p className="cast__rules">{`Points ${totals[left]}–${totals[other(left)]} · ${tossups.length} tossups`}</p>
              <p className="cast__fine">
                {`Powers ${stats.powers[left]}–${stats.powers[other(left)]} · Negs ${stats.negs[left]}–${stats.negs[other(left)]} · Steals ${stats.steals[left]}–${stats.steals[other(left)]}`}
              </p>
              <Button size="lg" outline icon={RotateCcw} onClick={restart}>
                Play again
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

function Working({ text, typing }: { text: string; typing: boolean }) {
  const typed = useTyped(text, typing)
  return (
    <p
      className="cast__thought buzzer__working"
      data-typing={flag(typing && typed.length < text.length)}
    >
      {typed}
    </p>
  )
}
