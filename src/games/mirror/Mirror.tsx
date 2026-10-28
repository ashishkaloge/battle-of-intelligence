import {
  ArrowDown,
  ArrowRight,
  Check,
  Mic,
  Pause,
  Play,
  RotateCcw,
  ShieldX,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
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
import { bell, playSound, speak, unlock } from '../audio.ts'
import { type Line, lineFile, VOICE_DIR, VOICES } from '../commentary.ts'
import { Face, type Mood } from '../Face.tsx'
import { GridView, MoveChip, RuleChips } from '../forge/ui.tsx'
import { FIGHTERS, type Fighter, other } from '../ring/arena.ts'
import { lineId } from './live.ts'
import { type Match, type MirrorShow, SHOWS } from './shows.ts'
import { TOP_OUT } from './versus.ts'

/** One turn's beats, in order, and how long each holds. The call also waits for its line. */
const BEATS = ['deal', 'think', 'answer', 'judge', 'attack', 'call'] as const
type BeatName = (typeof BEATS)[number]
const HOLD: Record<BeatName, number> = {
  deal: 1500,
  think: 3200,
  answer: 1300,
  judge: 2000,
  attack: 2100,
  call: 900,
}

type Stage = { kind: 'intro' } | { kind: 'turn'; turn: number; beat: number } | { kind: 'final' }
type Player = {
  stage: Stage
  line: { id: string; line: Line } | null
  playing: boolean
  run: number
}
type Command =
  | { type: 'start'; turns: number }
  | { type: 'advance'; run: number; turns: number }
  | { type: 'line'; run: number; id: string; line: Line }
  | { type: 'toggle' }
  | { type: 'restart' }

const NAMES: Record<Fighter, string> = { claude: CORNERS.claude.name, gpt: CORNERS.gpt.name }
const REASON: Record<string, string> = {
  ambiguous: 'More than one answer fits the examples',
  'cannot-apply': 'The rule cannot apply to these grids',
  'test-unchanged': 'It would leave the test unchanged',
  'over-budget': 'Too many moves',
}

function advance(state: Player, turns: number): Player {
  const { stage } = state
  if (stage.kind === 'intro')
    return { ...state, stage: { kind: 'turn', turn: 0, beat: 0 }, playing: true }
  if (stage.kind === 'turn') {
    if (stage.beat + 1 < BEATS.length)
      return { ...state, stage: { ...stage, beat: stage.beat + 1 } }
    if (stage.turn + 1 < turns)
      return { ...state, stage: { kind: 'turn', turn: stage.turn + 1, beat: 0 } }
    return { ...state, stage: { kind: 'final' } }
  }
  return state
}

function reducer(state: Player, command: Command): Player {
  switch (command.type) {
    case 'start':
      return advance(state, command.turns)
    case 'advance':
      return command.run === state.run ? advance(state, command.turns) : state
    case 'line':
      return command.run === state.run
        ? { ...state, line: { id: command.id, line: command.line } }
        : state
    case 'toggle':
      return { ...state, playing: !state.playing }
    case 'restart':
      return {
        stage: { kind: 'turn', turn: 0, beat: 0 },
        line: null,
        playing: true,
        run: state.run + 1,
      }
  }
}

const voiceUrl = (id: string, line: Line) =>
  `${import.meta.env.BASE_URL}${VOICE_DIR}/${lineFile(id, line)}`

/**
 * The engine's verdicts. A recorded fight carries them; the demo plays its match in a worker,
 * since every attack runs the solver, which takes about a second.
 */
function useMatch(show: MirrorShow) {
  const [match, setMatch] = useState<Match | null>(show.match)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the worker
  useEffect(() => {
    if (show.match) return
    setError(false)
    setMatch(null)
    let worker: Worker | undefined
    const fail = () => {
      worker?.terminate()
      window.clearTimeout(timeout)
      setError(true)
    }
    const timeout = window.setTimeout(fail, 60_000)
    try {
      worker = new Worker(new URL('./mirror.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<Match>) => {
        window.clearTimeout(timeout)
        setMatch(event.data)
        worker?.terminate()
      }
      worker.onerror = fail
      worker.onmessageerror = fail
    } catch {
      fail()
    }
    return () => {
      window.clearTimeout(timeout)
      worker?.terminate()
    }
  }, [show, attempt])
  return { match, error, retry: () => setAttempt((n) => n + 1) }
}

/** The Mirror tab: the newest real fight, with the others and the scripted demo a pick away. */
export function Mirror() {
  const [id, setId] = useState(SHOWS[0]?.id)
  const show = SHOWS.find((s) => s.id === id) ?? SHOWS[0]
  if (!show) return null
  return <MirrorCast key={show.id} show={show} onPick={setId} />
}

/**
 * Mirror on air: versus ARC. Both models get the same puzzle on mirrored boards. Clear it and you
 * send an attack, a rule stacked on the opponent's next puzzle, checked fair by the solver before
 * it lands. Miss and your garbage stays. Three stacked attacks is a knockout. `autoStart` and
 * `onEnd` let a full show run the round without a click; `left` overrides the side.
 */
export function MirrorCast({
  show,
  onPick,
  autoStart = false,
  onEnd,
  onPlayingChange,
  left: leftOverride,
}: {
  show: MirrorShow
  onPick?: (id: string) => void
  autoStart?: boolean
  onEnd?: (winner: Fighter | null) => void
  onPlayingChange?: (playing: boolean) => void
  left?: Fighter
}) {
  const TURNS = show.script
  const left = leftOverride ?? show.left
  const sides: Fighter[] = [left, other(left)]
  const sideOf = (fighter: Fighter) => (fighter === left ? 'left' : 'right')
  const { match, error, retry } = useMatch(show)
  const [player, dispatch] = useReducer(reducer, {
    stage: { kind: 'intro' },
    line: null,
    playing: false,
    run: 0,
  })
  const [muted, setMuted] = useMuted()
  const playback = usePlayback(player.playing)
  useEffect(() => onPlayingChange?.(player.playing), [onPlayingChange, player.playing])
  const [speaking, setSpeaking] = useState(false)
  const latest = useRef(player)
  latest.current = player
  const turnsCount = match?.turns.length ?? TURNS.length
  const waiting = useRef<(() => void) | null>(null)
  const lingering = useRef<(() => void) | null>(null)
  useEffect(() => () => lingering.current?.(), [])

  const finish = useCallback(
    (run: number) => {
      const go = () => dispatch({ type: 'advance', run, turns: turnsCount })
      if (latest.current.playing) go()
      else waiting.current = go
    },
    [turnsCount],
  )

  useEffect(() => {
    if (player.playing && waiting.current) {
      const go = waiting.current
      waiting.current = null
      go()
    }
  }, [player.playing])

  const key =
    player.stage.kind === 'turn'
      ? `turn-${player.stage.turn}-${player.stage.beat}:${player.run}`
      : `${player.stage.kind}:${player.run}`

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per stage, keyed by `key`
  useLayoutEffect(() => {
    const { stage, run } = latest.current
    if (!match) return
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

    if (stage.kind === 'turn') {
      const result = match.turns[stage.turn]
      const script = TURNS[stage.turn]
      const beat = BEATS[stage.beat]
      if (!result || !script || !beat) return
      const waits: Promise<unknown>[] = [sleep(HOLD[beat])]
      if (beat === 'deal') {
        if (stage.turn === 0) {
          const id = show.prefix + lineId.intro
          dispatch({ type: 'line', run, id, line: show.intro })
          setSpeaking(true)
          const voice = speak(voiceUrl(id, show.intro), show.intro.text)
          lingering.current = voice.stop
          void voice.done.then(() => setSpeaking(false))
        }
        playSound('flip')
      } else if (beat === 'answer') {
        playSound('chips')
      } else if (beat === 'judge') {
        const anyRight = FIGHTERS.some((f) => result.answers[f].right)
        if (FIGHTERS.some((f) => !result.answers[f].right)) playSound('wrong')
        if (anyRight) timers.push(playback.setTimeout(() => bell(1), 250))
      } else if (beat === 'attack') {
        const attacks = Object.values(result.attacks)
        if (attacks.length) {
          playSound('boost')
          for (const attack of attacks) {
            timers.push(
              playback.setTimeout(() => {
                playSound(attack?.landed ? 'thud' : 'clash')
                if (attack?.ko) playSound('ko')
              }, 900),
            )
          }
          if (attacks.some((a) => a?.landed))
            timers.push(playback.setTimeout(() => playSound('roar'), 950))
        }
      } else if (beat === 'call') {
        waits.push(say(show.prefix + lineId.turn(stage.turn), script.line))
      }
      done(waits)
    } else if (stage.kind === 'final') {
      bell(3)
      const won = match.winner
      void say(show.prefix + lineId.outro, show.outro).then(() => {
        if (!cancelled) timers.push(playback.setTimeout(() => onEnd?.(won), 2500))
      })
    }

    return () => {
      cancelled = true
      for (const timer of timers) playback.clearTimeout(timer)
      for (const stop of stops) stop()
    }
  }, [key, finish, match])

  const { stage } = player
  const turnIndex = stage.kind === 'turn' ? stage.turn : stage.kind === 'final' ? turnsCount - 1 : 0
  const beatIndex =
    stage.kind === 'turn' ? stage.beat : stage.kind === 'final' ? BEATS.length - 1 : -1
  const at = (name: BeatName) => beatIndex >= BEATS.indexOf(name)
  const result = match?.turns[turnIndex]
  const before = turnIndex > 0 ? match?.turns[turnIndex - 1] : undefined
  const base = match?.bases[turnIndex]
  const script = TURNS[turnIndex]
  const final = stage.kind === 'final'
  const ko = at('attack') ? (result?.ko ?? null) : null

  const clears = result
    ? at('judge')
      ? result.clears
      : (before?.clears ?? { claude: 0, gpt: 0 })
    : { claude: 0, gpt: 0 }
  // The garbage on each board: what this turn's puzzle carries, until this turn's attacks land.
  const stacks =
    result && at('attack') ? result.stacks : (before?.stacks ?? { claude: [], gpt: [] })
  const champ = final ? (match?.winner ?? null) : null

  const moodOf = (fighter: Fighter): Mood => {
    if (champ) return champ === fighter ? 'happy' : match?.ko === fighter ? 'ko' : 'idle'
    if (ko === fighter) return 'ko'
    if (!result) return 'idle'
    if (at('judge')) return result.answers[fighter].right ? 'happy' : 'hit'
    if (at('think') && !at('answer')) return 'think'
    if (at('answer')) return 'locked'
    return 'idle'
  }

  const start = () => {
    unlock()
    dispatch({ type: 'start', turns: turnsCount })
  }
  // A full show starts the round itself once the verdicts are in; its one click unlocked the sound.
  useOnce(autoStart && match !== null, () =>
    dispatch({ type: 'start', turns: match?.turns.length ?? turnsCount }),
  )
  const restart = () => {
    unlock()
    lingering.current?.()
    waiting.current = null
    dispatch({ type: 'restart' })
  }
  const toggleMute = () => {
    setMuted(!muted)
  }

  const leader = clears.claude === clears.gpt ? null : clears.claude > clears.gpt ? 'claude' : 'gpt'
  const when =
    stage.kind === 'intro'
      ? 'Mirror · Reasoning'
      : final
        ? 'Final'
        : `Turn ${turnIndex + 1} · Base rule hidden · ${TOP_OUT} stacked is a knockout`

  return (
    <PlaybackContext.Provider value={playback}>
      <section
        role={onEnd ? undefined : 'main'}
        className="cast mirror"
        data-paused={flag(!player.playing && player.stage.kind !== 'intro')}
        aria-label="Mirror"
      >
        {!onEnd && <h1 className="sr-only">Mirror</h1>}
        <header className="cast__hud">
          <span className="cast__score" data-side="left">
            {NAMES[left]}
            <b className="num" data-lead={flag(leader === left)}>
              {clears[left]}
            </b>
          </span>
          <span className="cast__when">{when}</span>
          <span className="cast__score" data-side="right">
            <b className="num" data-lead={flag(leader === other(left))}>
              {clears[other(left)]}
            </b>
            {NAMES[other(left)]}
          </span>
        </header>

        {sides.map((fighter) => {
          const side = script?.[fighter]
          const answer = result?.answers[fighter]
          const attack = result?.attacks[fighter]
          let status: ReactNode = <span className="cast__status">Waiting</span>
          let text = stage.kind === 'intro' ? 'Waiting for the first puzzle.' : ''
          if (champ) {
            status = (
              <span className="cast__status" data-tone={champ === fighter ? 'win' : 'loss'}>
                {champ === fighter ? 'Winner' : match?.ko === fighter ? 'Topped out' : 'Runner-up'}
              </span>
            )
          } else if (stage.kind === 'turn' && side && answer) {
            text = side.think
            if (at('judge')) {
              status = (
                <span className="cast__status" data-tone={answer.right ? 'win' : 'loss'}>
                  {answer.right ? 'Clear' : 'Miss'}
                </span>
              )
            } else if (at('answer')) {
              status = (
                <span className="cast__status" data-tone="lock">
                  Answer in
                </span>
              )
            } else if (at('think')) {
              status = (
                <span className="cast__status" data-thinking="">
                  Submitted action
                </span>
              )
            }
            if (at('attack') && attack && side.attackThink) {
              text = side.attackThink
              status = (
                <span className="cast__status" data-tone={attack.landed ? 'lock' : 'loss'}>
                  {attack.landed ? 'Attack sent' : 'Attack blocked'}
                </span>
              )
            }
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
              <Thought
                text={text}
                typing={
                  beatIndex === BEATS.indexOf('think') || beatIndex === BEATS.indexOf('attack')
                }
              />
              {answer && at('answer') && !champ && (
                <div className="mirror__rule">
                  <span className="mirror__tag">Submitted rule</span>
                  <RuleChips program={answer.hypothesis} />
                </div>
              )}
            </aside>
          )
        })}

        <div className="cast__stage">
          {!match && stage.kind !== 'intro' && (
            <span className="mirror__loading">The referee is checking attacks…</span>
          )}
          {match && result && base && !final && (
            <div className="mirror__boards">
              {sides.map((fighter) => {
                const puzzle = result.puzzles[fighter]
                const answer = result.answers[fighter]
                const garbage = stacks[fighter]
                return (
                  <div
                    key={fighter}
                    className="mirror__board"
                    data-side={sideOf(fighter)}
                    data-ko={flag(ko === fighter)}
                    style={{ '--side': `var(--${fighter})` } as CSSProperties}
                  >
                    <div className="mirror__head">
                      <span className="mirror__face">
                        <Face
                          mood={moodOf(fighter)}
                          look={{ x: fighter === left ? 1 : -1, y: 0.3 }}
                        />
                      </span>
                      <span className="mirror__garbage">
                        <span className="sr-only">{`${garbage.length} stacked attacks`}</span>
                        {garbage.length === 0 ? (
                          <span className="mirror__clean">Clean board</span>
                        ) : (
                          garbage.map((move, i) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: attacks only ever append, so a position is stable
                            <span key={`${i}-${move.op}`} className="mirror__stacked">
                              <MoveChip move={move} />
                            </span>
                          ))
                        )}
                        {Array.from({ length: Math.max(0, TOP_OUT - garbage.length) }, (_, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: empty slots are positional
                          <i key={i} className="mirror__slot" aria-hidden="true" />
                        ))}
                      </span>
                    </div>
                    <div className="mirror__puzzle" key={`${turnIndex}-${fighter}`}>
                      <div className="mirror__examples">
                        {base.examples.map((input, e) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: examples are positional
                          <div key={e} className="mirror__pair">
                            <GridView grid={input} cell={9} label={`Example ${e + 1} input`} />
                            <ArrowRight size={12} strokeWidth={2} aria-hidden="true" />
                            <GridView
                              grid={puzzle.outputs[e] ?? input}
                              cell={9}
                              label={`Example ${e + 1} output`}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="mirror__test">
                        <span className="mirror__tag">Test</span>
                        <GridView grid={base.test} cell={13} label="Test input" />
                        <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
                        <div className="mirror__answer">
                          {at('answer') && answer.grid ? (
                            <GridView
                              grid={answer.grid}
                              cell={13}
                              paint={!at('judge')}
                              truth={at('judge') ? puzzle.truth : undefined}
                              label="Answer"
                            />
                          ) : (
                            <span className="mirror__blank" aria-hidden="true">
                              ?
                            </span>
                          )}
                          {at('judge') && (
                            <span className="mirror__verdict" data-right={flag(answer.right)}>
                              {answer.right ? (
                                <Check size={13} strokeWidth={3} aria-hidden="true" />
                              ) : (
                                <X size={13} strokeWidth={3} aria-hidden="true" />
                              )}
                              {answer.right ? 'Clear' : 'Miss'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              {beatIndex === BEATS.indexOf('attack') &&
                FIGHTERS.map((fighter) => {
                  const attack = result.attacks[fighter]
                  if (!attack) return null
                  return (
                    <span
                      key={`fly-${fighter}`}
                      className="mirror__flight"
                      data-from={sideOf(fighter)}
                      data-blocked={flag(!attack.landed)}
                      style={{ '--side': `var(--${fighter})` } as CSSProperties}
                    >
                      <MoveChip move={attack.move} />
                      {!attack.landed && (
                        <span className="mirror__blocked">
                          <ShieldX size={14} strokeWidth={2.5} aria-hidden="true" />
                          {`Blocked · ${REASON[attack.reason ?? ''] ?? attack.reason}`}
                        </span>
                      )}
                    </span>
                  )
                })}
            </div>
          )}
          {ko && beatIndex >= BEATS.indexOf('attack') && !final && (
            <div
              className="cast__banner"
              data-ko=""
              style={{ '--side': `var(--${other(ko)})` } as CSSProperties}
            >
              K.O.
            </div>
          )}
          {stage.kind === 'intro' && (
            <div className="cast__card">
              <span className="eyebrow">Round 2 · Reasoning · ARC-AGI-2</span>
              <h2 className="cast__title">Mirror</h2>
              <p className="cast__rules">
                Versus ARC. Both models get the same puzzle on mirrored boards. Solve it and you
                send an attack: a rule stacked on your rival’s next puzzle. Miss and your garbage
                stays. Three stacked attacks is a knockout.
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
              {error ? (
                <>
                  <p role="alert">The referee could not load. Try again to check this replay.</p>
                  <Button outline icon={RotateCcw} onClick={retry}>
                    Retry referee
                  </Button>
                </>
              ) : (
                <Button
                  size="lg"
                  tone="strong"
                  outline
                  icon={Play}
                  onClick={start}
                  disabled={!match}
                >
                  {match ? 'First puzzle' : 'Checking attacks…'}
                </Button>
              )}
              <p className="cast__fine">{show.fine}</p>
            </div>
          )}
          {final && match && (
            <div className="cast__card">
              <span className="eyebrow">
                {match.ko ? `Knockout · turn ${match.turns.length}` : 'Final'}
              </span>
              <h2 className="cast__title" style={{ color: champ ? `var(--${champ})` : undefined }}>
                {champ ? `${NAMES[champ]} wins Mirror` : 'A draw'}
              </h2>
              <p className="cast__rules">{`Clears ${clears[left]}–${clears[other(left)]}`}</p>
              <p className="cast__fine">
                {(() => {
                  const all = match.turns.flatMap((t) => Object.values(t.attacks))
                  const landed = all.filter((a) => a?.landed).length
                  return `Attacks landed ${landed} · blocked ${all.length - landed}`
                })()}
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
            <IconButton
              icon={RotateCcw}
              label="Restart"
              tip="none"
              onClick={restart}
              disabled={!match}
            />
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

function Thought({ text, typing }: { text: string; typing: boolean }) {
  const typed = useTyped(text, typing)
  return (
    <p className="cast__thought" data-typing={flag(typing && typed.length < text.length)}>
      {typed}
    </p>
  )
}
