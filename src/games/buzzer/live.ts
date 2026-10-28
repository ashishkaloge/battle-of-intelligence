import { CORNERS } from '../../arena/corners.ts'
import type { Line } from '../commentary.ts'
import type { Reply } from '../reply.ts'
import { FIGHTERS, type Fighter, other } from '../ring/arena.ts'
import type { ScriptedTossup, Turn } from './demo.ts'
import { type Decision, NEG, type Problem, playTossup, type QuizEvent, VALUES } from './quiz.ts'

/**
 * Live Buzzer fights: what each model is told at every reveal, how its reply is read, the limits
 * both corners play under, and the record a fight leaves behind. The referee in server/buzzer.ts
 * drives the CLIs; this file is pure, so prompts and parsing are tested, and a saved fight replays
 * through the same tossup engine and broadcast as the demo.
 */

export type Limits = {
  tossups: number
  shotClockMs: number
  callsPerCorner: number
  roundMs: number
}

/** Seven tossups, the last one double, like the demo. The same for both corners. */
export const LIMITS: Limits = {
  tossups: 7,
  shotClockMs: 60_000,
  callsPerCorner: 40,
  roundMs: 30 * 60_000,
}

/**
 * 1 asked for the answer before the working, and models committed to a number before working it
 * out; 2 asks for the working first; 3 adds what each choice is worth, after every buzz in two
 * fights came before any hint. Version 4 requests final decisions only.
 */
export const PROMPT_VERSION = 4

export type Ruling = 'played' | 'late' | 'unusable' | 'tools' | 'error' | 'capped'

export type LiveTurn = Turn & {
  ruling: Ruling
  seconds: number
  calls: number
  reasoning?: string
  error?: string
}

export type RecordTossup = {
  problem: Problem
  double: boolean
  /** turns[r] holds each model still in the race at reveal r. */
  turns: Partial<Record<Fighter, LiveTurn>>[]
}

export type BuzzerRecord = {
  /** Optional five-round recording session; historical fights have no session. */
  broadcast?: string
  version: 1
  round: 'buzzer'
  id: string
  playedAt: string
  models: Record<Fighter, { name: string; id: string }>
  effort: Record<Fighter, string>
  limits: Limits
  seed: number
  prompt: number
  left: Fighter
  tossups: RecordTossup[]
  end: { reason: 'tossups' | 'round-clock'; winner: Fighter | null; score: Record<Fighter, number> }
  calls: Record<Fighter, number>
  seconds: number
  commentary?: Record<string, Line>
}

const NAME: Record<Fighter, string> = { claude: CORNERS.claude.name, gpt: CORNERS.gpt.name }
const LADDER = ['the problem alone', 'hint 1', 'hint 2', 'hint 3']

const decisionCaption = (decision: Decision) =>
  decision.kind === 'wait' ? 'Waits for the next hint.' : `Buzzes with ${decision.answer}.`

/** A finished tossup as a line of history both models are shown. */
export function historyLine(index: number, problem: Problem, events: readonly QuizEvent[]): string {
  const parts: string[] = []
  for (const e of events) {
    if (e.type === 'buzz') {
      parts.push(
        `${NAME[e.fighter]} buzzed ${e.answer} on ${LADDER[e.reveal]}, ${e.right ? 'right' : 'wrong'}`,
      )
    }
  }
  const what = parts.length > 0 ? parts.join('; ') : 'nobody buzzed'
  return `Tossup ${index + 1}: ${what}. The answer was ${problem.answer}.`
}

/** The prompt at one reveal. Both models still in the race get it at the same moment. */
export function turnPrompt(input: {
  me: Fighter
  problem: Problem
  tossup: number
  reveal: number
  double: boolean
  score: Record<Fighter, number>
  /** What the rival did earlier in this tossup, if it buzzed wrong. */
  rivalOut: { answer: number; reveal: number } | null
  limits: Limits
  history: readonly string[]
}): string {
  const { me, problem, tossup, reveal, double, score, rivalOut, limits, history } = input
  const them = other(me)
  const mult = double ? 2 : 1
  const value = (VALUES[reveal] ?? 0) * mult
  const shown = [
    `Problem: ${problem.text}`,
    ...problem.hints.slice(0, reveal).map((hint, i) => `Hint ${i + 1}: ${hint}`),
  ]
  const race = rivalOut
    ? `${NAME[them]} buzzed ${rivalOut.answer} on ${LADDER[rivalOut.reveal]} and was wrong, so it is locked out of this tossup. Nobody can beat you to it now, but a wrong buzz still costs you.`
    : `${NAME[them]} is still in the race and decides at the same moment you do.`
  return [
    `You are ${NAME[me]}, racing ${NAME[them]} at Buzzer, the math round of Battle of Intelligence. An audience is watching live. Play to win.`,
    '',
    'How it works',
    `- ${limits.tossups} tossups. Each is one problem with a whole-number answer, shown first on its own, then with up to three hints.`,
    `- At every reveal you and ${NAME[them]} each decide in secret: buzz with an answer, or wait for the next hint.`,
    `- A right buzz scores the reveal's value: ${VALUES.join(', then ')} as the hints arrive. If you both buzz right on the same reveal, you both score.`,
    `- A wrong buzz costs ${NEG} and locks you out of that tossup, and ${NAME[them]} keeps going with the next hint. After the last hint, nobody scores.`,
    '- The last tossup is worth double, wrong buzzes too.',
    '',
    'What each choice is worth',
    `- A buzz on the problem alone pays the most, but only if it is right. A wrong buzz costs ${NEG}, locks you out, and hands ${NAME[them]} the next hint with nobody racing it.`,
    '- Each hint is a step of the working. If yours is not finished, waiting one rung costs only a few points.',
    '- If you both buzz right on the same rung, you both score. Being right matters; being first on the same rung does not.',
    '',
    'Earlier tossups, most recent last:',
    ...(history.length > 0 ? history : ['None. This is the first tossup.']),
    '',
    `Score: you ${score[me]}, ${NAME[them]} ${score[them]}.`,
    `Tossup ${tossup + 1} of ${limits.tossups}${double ? ', the double' : ''}. This is ${LADDER[reveal]}: a right buzz now is worth ${value}; a wrong one costs ${NEG * mult}.`,
    race,
    '',
    ...shown,
    '',
    'Reply with only your final decision in this JSON object:',
    '{"action":"buzz or wait","answer":your whole-number answer, or null to wait}',
    'Do not use any tools or run commands. Work it out yourself.',
  ].join('\n')
}

export type TurnReply = { decision: Decision; think: string }

export function parseTurnReply(text: string): Reply<TurnReply> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  let data: Record<string, unknown> | null = null
  if (start >= 0 && end > start) {
    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1))
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        data = value as Record<string, unknown>
      }
    } catch {
      data = null
    }
  }
  if (!data) return { ok: false, error: 'no JSON object in the reply' }
  const action = typeof data.action === 'string' ? data.action.trim().toLowerCase() : ''
  if (action === 'wait')
    return {
      ok: true,
      value: { decision: { kind: 'wait' }, think: decisionCaption({ kind: 'wait' }) },
    }
  if (action !== 'buzz') return { ok: false, error: '"action" must be "buzz" or "wait"' }
  const raw = typeof data.answer === 'string' ? data.answer.trim() : data.answer
  // Accept decimal integers and properly grouped thousands, without turning blank strings,
  // hexadecimal literals or malformed separators into a different answer.
  const answer =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw)
        ? Number(raw.replaceAll(',', ''))
        : Number.NaN
  if (!Number.isSafeInteger(answer)) {
    return { ok: false, error: 'a buzz needs "answer" as a whole number' }
  }
  const decision = { kind: 'buzz' as const, answer }
  return { ok: true, value: { decision, think: decisionCaption(decision) } }
}

/** Every tossup of a record through the real engine, with its running score. */
export function replayRecord(record: Pick<BuzzerRecord, 'tossups'>) {
  const score: Record<Fighter, number> = { claude: 0, gpt: 0 }
  return record.tossups.map((t) => {
    const decisions = t.turns.map((turn) => {
      const out: Partial<Record<Fighter, Decision>> = {}
      for (const f of FIGHTERS) {
        const side = turn[f]
        if (side) out[f] = side.decision
      }
      return out
    })
    const result = playTossup(t.problem, decisions, t.double)
    score.claude += result.points.claude
    score.gpt += result.points.gpt
    return { ...result, score: { ...score } }
  })
}

const REFEREE: Record<Exclude<Ruling, 'played'>, string> = {
  late: 'No reply inside the shot clock. It waits.',
  unusable: 'Its reply could not be used. It waits.',
  tools: 'It reached for a tool, which is against the rules. It waits.',
  error: 'Its CLI could not answer. It waits.',
  capped: 'Out of calls for this round. It waits.',
}

const spoken = (n: number) => n.toLocaleString('en-US')

/** The call after a tossup, from what the engine says happened. */
export function tossupLine(events: readonly QuizEvent[], double: boolean): Line {
  const end = events.find((e) => e.type === 'end')
  const buzzes = events.filter((e) => e.type === 'buzz')
  const wrong = buzzes.filter((b) => !b.right)
  const scores = events.filter((e) => e.type === 'score')
  const answer = end?.type === 'end' ? spoken(end.answer) : ''
  if (events.some((e) => e.type === 'dead-heat')) {
    return {
      voice: 'play',
      text: `Both buzz together, and both are right! ${answer}! A dead heat.`,
    }
  }
  const scored = scores[0]
  if (scored?.type === 'score') {
    const who = NAME[scored.fighter]
    const steal = wrong.length > 0 ? `${NAME[other(scored.fighter)]} negged, and ` : ''
    const power = scored.power ? ' A power!' : ''
    const big = double ? ' Double points!' : ''
    return {
      voice: 'play',
      text: `${steal}${who} has it! ${answer}, for ${scored.points}.${power}${big}`,
    }
  }
  if (wrong.length === 2) {
    return { voice: 'color', text: `Both of them buzzed wrong! The answer was ${answer}.` }
  }
  if (wrong.length === 1 && wrong[0]?.type === 'buzz') {
    return {
      voice: 'color',
      text: `${NAME[wrong[0].fighter]} buzzed wrong, and nobody else would risk it. It was ${answer}.`,
    }
  }
  return { voice: 'color', text: `Nobody buzzed on that one. The answer was ${answer}.` }
}

export function introLine(record: Pick<BuzzerRecord, 'models' | 'tossups'>): Line {
  return {
    voice: 'play',
    text: `Welcome to Buzzer! ${record.models.claude.name} against ${record.models.gpt.name}, live. ${record.tossups.length} problems, four reveals each. Buzz early for big points, buzz wrong and your rival gets a steal.`,
  }
}

export function outroLine(
  score: Record<Fighter, number>,
  tally: Record<'powers' | 'negs', Record<Fighter, number>>,
): Line {
  const lead =
    score.claude === score.gpt
      ? `Level at ${score.claude}.`
      : `${score.claude > score.gpt ? NAME.claude : NAME.gpt} takes the round, ${Math.max(score.claude, score.gpt)} to ${Math.min(score.claude, score.gpt)}.`
  const powers = FIGHTERS.map((f) => `${NAME[f]} ${tally.powers[f]}`).join(', ')
  const negs = FIGHTERS.map((f) => `${NAME[f]} ${tally.negs[f]}`).join(', ')
  return { voice: 'color', text: `${lead} Powers: ${powers}. Wrong buzzes: ${negs}.` }
}

export const lineId = {
  intro: 'buzzer-intro',
  tossup: (t: number) => `buzzer-t${t + 1}`,
  outro: 'buzzer-outro',
}

/** A saved fight in the demo's shape, so the same broadcast plays it. */
export function recordTossups(record: BuzzerRecord): {
  tossups: ScriptedTossup[]
  intro: Line
  outro: Line
} {
  const played = replayRecord(record)
  const tally = { powers: { claude: 0, gpt: 0 }, negs: { claude: 0, gpt: 0 } }
  const tossups = record.tossups.map((t, i): ScriptedTossup => {
    const events = played[i]?.events ?? []
    for (const e of events) {
      if (e.type === 'neg') tally.negs[e.fighter] += 1
      if (e.type === 'score' && e.power) tally.powers[e.fighter] += 1
    }
    const turns = t.turns.map((turn) => {
      const out: Partial<Record<Fighter, Turn>> = {}
      for (const f of FIGHTERS) {
        const side = turn[f]
        if (!side) continue
        out[f] = {
          think: side.ruling === 'played' ? decisionCaption(side.decision) : REFEREE[side.ruling],
          decision: side.decision,
        }
      }
      return out
    })
    return {
      problem: t.problem,
      turns,
      double: t.double,
      line: tossupLine(events, t.double),
    }
  })
  const score = played.at(-1)?.score ?? { claude: 0, gpt: 0 }
  return {
    tossups,
    intro: introLine(record),
    outro: outroLine(score, tally),
  }
}
