import { CORNERS } from '../../arena/corners.ts'
import type { Line } from '../commentary.ts'
import type { Reply } from '../reply.ts'
import { FIGHTERS, type Fighter, other } from '../ring/arena.ts'
import { calibrate } from './calibration.ts'
import type { Hole, Move, ScriptedHand } from './demo.ts'
import {
  type Action,
  anteFor,
  type HandStatus,
  isRight,
  MAX_BET,
  newTable,
  normalize,
  playHand,
  type Question,
  START_STACK,
  type TableEvent,
  type TableState,
} from './table.ts'

/**
 * Live Bluff fights: what each model is told, how its reply is read, the limits both corners play
 * under, and the record a fight leaves behind. The referee in server/bluff.ts drives the CLIs; this
 * file is pure, so prompts and parsing are tested, and a saved fight replays through the same table
 * engine and broadcast as the demo.
 */

export type Limits = {
  hands: number
  /** Wall clock for one decision, retry included. */
  shotClockMs: number
  /** CLI calls one corner may make in the whole round. */
  callsPerCorner: number
  /** Wall clock for the whole round. When it runs out the fight ends at the current stacks. */
  roundMs: number
}

/** Eight hands, the length of the ante ladder. The same for both corners, always. */
export const LIMITS: Limits = {
  hands: 8,
  shotClockMs: 60_000,
  callsPerCorner: 30,
  roundMs: 30 * 60_000,
}

/**
 * 1 had the rules alone; 2 adds what each choice is worth, after callers kept paying right claims;
 * 3 asked for explanations; 4 spells out the simultaneous-bust draw; 5 requests final actions only.
 */
export const PROMPT_VERSION = 5

/** How the referee settled a decision. Anything but `played` is the referee's call. */
export type Ruling = 'played' | 'late' | 'unusable' | 'tools' | 'error' | 'capped'

type Timing = {
  ruling: Ruling
  seconds: number
  calls: number
  /** Legacy field only. New fights neither request nor store reasoning. */
  reasoning?: string
  error?: string
}

export type HoleTurn = Timing & Hole
export type ActTurn = Timing & { action: Action; think: string; say?: string }

export type RecordHand = {
  question: Question
  opener: Fighter
  hole: Record<Fighter, HoleTurn>
  moves: ActTurn[]
}

export type EndReason = 'ko' | 'hands' | 'round-clock'

export type BluffRecord = {
  /** Optional five-round recording session; historical fights have no session. */
  broadcast?: string
  version: 1
  round: 'bluff'
  id: string
  playedAt: string
  models: Record<Fighter, { name: string; id: string }>
  effort: Record<Fighter, string>
  limits: Limits
  /** The seed the questions were drawn from. The questions themselves are saved in `hands`. */
  seed: number
  prompt: number
  /** Who sits on the left and opens the first hand. Fights alternate it. */
  left: Fighter
  hands: RecordHand[]
  end: { reason: EndReason; winner: Fighter | null; stacks: Record<Fighter, number> }
  calls: Record<Fighter, number>
  seconds: number
  commentary?: Record<string, Line>
}

const NAME: Record<Fighter, string> = { claude: CORNERS.claude.name, gpt: CORNERS.gpt.name }

function clip(text: string, max: number) {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`
}

const clean = (value: unknown, max: number) =>
  typeof value === 'string' ? clip(value.replace(/\s+/g, ' ').trim(), max) : ''

/** What an action sounds like in a log line. */
export function actionText(action: Action): string {
  const who = NAME[action.by]
  switch (action.kind) {
    case 'claim':
      return `${who} claimed "${action.answer}" and bet ${action.bet}`
    case 'counter':
      return `${who} countered with "${action.answer}" and raised ${action.raise}`
    case 'pass':
      return `${who} passed`
    case 'fold':
      return `${who} folded`
    case 'call':
      return `${who} called`
  }
}

/** One hand as a line of public history: what was said and done, and what a showdown showed. */
export function historyLine(
  hand: number,
  question: Question,
  actions: readonly Action[],
  events: readonly TableEvent[],
): string {
  const parts = [`Hand ${hand + 1}, "${question.text}":`, `${actions.map(actionText).join('; ')}.`]
  for (const e of events) {
    if (e.type === 'showdown') {
      const shown = e.answers
        .map((a) => `${NAME[a.by]}'s "${a.answer}" was ${a.right ? 'right' : 'wrong'}`)
        .join(', ')
      parts.push(`Showdown: ${shown}. The answer was "${question.answer}".`)
    } else if (e.type === 'win') {
      parts.push(`${NAME[e.fighter]} took ${e.amount}${e.shown ? '' : ', answers unseen'}.`)
    } else if (e.type === 'split') parts.push(`The pot of ${e.amount} was split.`)
    else if (e.type === 'carry') parts.push(`The pot of ${e.amount} carried to the next hand.`)
    else if (e.type === 'bust') parts.push(`${NAME[e.fighter]} ran out of chips.`)
  }
  return parts.join(' ')
}

function rules(limits: Limits, me: Fighter) {
  const them = NAME[other(me)]
  return [
    'How it works',
    `- Poker where the cards are answers. Each hand is one question with one answer a computer can check. ${limits.hands} hands; you and ${them} each started with ${START_STACK} chips.`,
    `- Each hand you both ante, then both answer the question in secret and say how sure you are. Neither of you sees the other's secret answer. The audience sees both, and the truth.`,
    `- The opener claims an answer and bets on it, or passes. After a pass the other player may claim or pass; two passes carry the pot to the next hand.`,
    `- Facing a claim you may fold (the claimer takes the pot and nothing is shown), call (a showdown: a right claim takes the pot, a wrong one loses it to you), or counter with a different answer and a raise, which the claimer must then fold or call. At a showdown after a counter, whoever is right takes the pot; both wrong carries it; both right splits it.`,
    `- No bet or raise can be more than ${MAX_BET} or more than either player can cover. Antes rise as the round goes on. Run out of chips and you are knocked out; after the last hand most chips wins.`,
    '- If both players run out on the same hand, the round is a draw and any unclaimed pot is shared.',
    `- When the round ends the audience sees how sure you said you were against how often your secret answer was right.`,
    '',
    'What each choice is worth',
    `- A call says the claim is wrong. If you think the claim is right, calling only pays the claimer more: fold instead and lose just what you already put in. Call when you doubt the claim.`,
    `- Counter when you believe a different answer. If only your answer is right, the whole pot is yours.`,
    `- A claim wins the pot outright when the other player folds, so it can pay even when you are unsure: that is a bluff. It loses if the other player calls and your answer is wrong.`,
    `- A pass costs only your ante. Nobody can see your secret answer or how sure you are, only what you do.`,
  ]
}

const historyBlock = (history: readonly string[]) => [
  'Earlier hands, most recent last:',
  ...(history.length > 0 ? history : ['None. This is the first hand.']),
]

/** The secret answer: asked of both corners at once, with the same words. */
export function holePrompt(input: {
  me: Fighter
  question: Question
  hand: number
  table: TableState
  limits: Limits
  history: readonly string[]
}): string {
  const { me, question, hand, table, limits, history } = input
  const them = other(me)
  return [
    `You are ${NAME[me]}, playing ${NAME[them]} at Bluff, the knowledge round of Battle of Intelligence. An audience is watching live. Play to win.`,
    '',
    ...rules(limits, me),
    '',
    `Hand ${hand + 1} of ${limits.hands}. Chips: you ${table.stacks[me]}, ${NAME[them]} ${table.stacks[them]}. Ante this hand: ${anteFor(hand)}.`,
    '',
    ...historyBlock(history),
    '',
    `The question: ${question.text}`,
    '',
    'First, answer it in secret. Betting comes next.',
    'Reply with only this JSON object and nothing else:',
    '{"answer":"your answer, as short as possible","confidence":0-100}',
    'Do not use any tools or run commands. Answer from what you know.',
  ].join('\n')
}

/** The legal choices for the player to act, spelled out with their numbers. */
export function optionsText(status: HandStatus): string[] {
  if (status.phase === 'open') {
    return [
      status.maxBet >= 1
        ? `- "claim": name an answer and bet 1 to ${status.maxBet} chips on it.`
        : '- "claim" is not possible: someone cannot cover a bet.',
      '- "pass": bet nothing.',
    ]
  }
  if (status.phase === 'claim' && status.claim) {
    const counter =
      status.maxRaise >= 1
        ? [
            `- "counter": name a different answer, put in the ${status.toCall} to match and raise 1 to ${status.maxRaise} more.`,
          ]
        : []
    return [
      '- "fold": give up the pot; nothing is shown.',
      `- "call": put in ${status.toCall} and go to a showdown.`,
      ...counter,
    ]
  }
  return [
    '- "fold": give up the pot; nothing is shown.',
    `- "call": put in ${status.toCall} and go to a showdown.`,
  ]
}

/** One betting decision. Only the player to act is asked. */
export function actPrompt(input: {
  me: Fighter
  question: Question
  hand: number
  hole: Hole
  status: HandStatus
  done: readonly Action[]
  limits: Limits
  history: readonly string[]
}): string {
  const { me, question, hand, hole, status, done, limits, history } = input
  const them = other(me)
  const sofar =
    done.length > 0 ? `This hand so far: ${done.map(actionText).join('; ')}.` : 'You act first.'
  const mine = hole.answer
    ? `Your secret answer: "${hole.answer}", ${hole.confidence}% sure.`
    : 'You gave no secret answer this hand.'
  return [
    `You are ${NAME[me]}, playing ${NAME[them]} at Bluff, the knowledge round of Battle of Intelligence. An audience is watching live. Play to win.`,
    '',
    ...rules(limits, me),
    '',
    ...historyBlock(history),
    '',
    `Hand ${hand + 1} of ${limits.hands}. The question: ${question.text}`,
    mine,
    `Chips: you ${status.stacks[me]}, ${NAME[them]} ${status.stacks[them]}. Pot: ${status.pot}.`,
    sofar,
    '',
    'Your choices:',
    ...optionsText(status),
    '',
    'Reply with only this JSON object and nothing else:',
    `{"action":"one of the choices above","answer":"the answer you claim or counter with, or an empty string","amount":your bet or raise as a number, or 0,"say":"a short taunt to ${NAME[them]}, at most 6 words, or an empty string"}`,
    'Do not use any tools or run commands.',
  ].join('\n')
}

function readJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const numberOf = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*%?\s*$/.test(value)) {
    return Number.parseFloat(value)
  }
  return null
}

const answerCaption = (answer: string, confidence: number) =>
  `Answers "${answer}" with ${confidence}% confidence.`

export function parseHoleReply(text: string): Reply<Hole> {
  const data = readJson(text)
  if (!data) return { ok: false, error: 'no JSON object in the reply' }
  const answer = clean(data.answer, 40)
  if (!answer) return { ok: false, error: '"answer" must be a non-empty string' }
  const confidence = numberOf(data.confidence)
  if (confidence === null || confidence < 0 || confidence > 100) {
    return { ok: false, error: '"confidence" must be a number from 0 to 100' }
  }
  return {
    ok: true,
    value: {
      answer,
      confidence: Math.round(confidence),
      think: answerCaption(answer, Math.round(confidence)),
    },
  }
}

export type ActReply = { action: Action; think: string; say: string }

/** Reads a betting reply and checks it against what the table allows right now. */
export function parseActReply(text: string, me: Fighter, status: HandStatus): Reply<ActReply> {
  const data = readJson(text)
  if (!data) return { ok: false, error: 'no JSON object in the reply' }
  const kind = typeof data.action === 'string' ? data.action.trim().toLowerCase() : ''
  const answer = clean(data.answer, 40)
  const amount = numberOf(data.amount)
  const captioned = (action: Action): ActReply => ({
    action,
    think: `${actionText(action)}.`,
    say: clean(data.say, 40),
  })
  const allowed =
    status.phase === 'open'
      ? status.maxBet >= 1
        ? ['claim', 'pass']
        : ['pass']
      : status.phase === 'claim' && status.maxRaise >= 1
        ? ['fold', 'call', 'counter']
        : ['fold', 'call']
  if (!allowed.includes(kind)) {
    return { ok: false, error: `"action" must be one of ${allowed.join(', ')}` }
  }
  if (kind === 'claim' || kind === 'counter') {
    if (!answer) return { ok: false, error: `a ${kind} needs an "answer"` }
    const top = kind === 'claim' ? status.maxBet : status.maxRaise
    if (amount === null || !Number.isInteger(amount) || amount < 1 || amount > top) {
      return { ok: false, error: `"amount" must be a whole number from 1 to ${top}` }
    }
    if (kind === 'claim') {
      return { ok: true, value: captioned({ by: me, kind, answer, bet: amount }) }
    }
    if (status.claim && normalize(answer) === normalize(status.claim.answer)) {
      return { ok: false, error: 'a counter must name a different answer from the claim' }
    }
    return { ok: true, value: captioned({ by: me, kind, answer, raise: amount }) }
  }
  const action = { by: me, kind } as Action
  return { ok: true, value: captioned(action) }
}

/** What the referee does for a corner that gave nothing usable: pass if it can, otherwise fold. */
export const defaultAction = (me: Fighter, status: HandStatus): Action =>
  status.phase === 'open' ? { by: me, kind: 'pass' } : { by: me, kind: 'fold' }

/** The hand-by-hand table a record leads to, through the real engine. */
export function replayRecord(record: Pick<BluffRecord, 'hands'>) {
  let state = newTable()
  return record.hands.map((hand, h) => {
    const before = state
    const result = playHand(
      state,
      hand.question,
      hand.opener,
      hand.moves.map((m) => m.action),
      h === record.hands.length - 1,
    )
    state = result.state
    return { before, after: result.state, events: result.events }
  })
}

const REFEREE: Record<Exclude<Ruling, 'played'>, string> = {
  late: 'No reply inside the shot clock.',
  unusable: 'Its reply could not be used.',
  tools: 'It reached for a tool, which is against the rules.',
  error: 'Its CLI could not answer.',
  capped: 'Out of calls for this round.',
}

function refereeThink(turn: Timing, decided: string): string {
  return turn.ruling === 'played' ? '' : `${REFEREE[turn.ruling]} ${decided}`
}

/** The call after a hand, from what the engine says happened. */
export function handLine(hand: RecordHand, events: readonly TableEvent[], after: TableState): Line {
  const truth = hand.question.answer
  const showdown = events.find((e) => e.type === 'showdown')
  const win = events.find((e) => e.type === 'win')
  const bust = events.find((e) => e.type === 'bust')
  const ko = after.draw
    ? ' Both players run out of chips together. The round is a draw!'
    : bust
      ? ` ${NAME[bust.fighter]} is out of chips! ${NAME[other(bust.fighter)]} wins by knockout!`
      : ''
  if (!showdown && win) {
    const folder = other(win.fighter)
    const had = isRight(hand.question, hand.hole[folder].answer)
    // The answer the winner put chips on: its counter if it made one, otherwise its claim.
    const staked = hand.moves
      .map((m) => m.action)
      .filter((a) => a.by === win.fighter && (a.kind === 'claim' || a.kind === 'counter'))
      .at(-1)
    const wrong =
      staked && (staked.kind === 'claim' || staked.kind === 'counter')
        ? !isRight(hand.question, staked.answer) && staked.answer
        : false
    const bluff = wrong ? ` And ${NAME[win.fighter]}'s ${wrong} was wrong. A bluff!` : ''
    const knew = had ? ` ${NAME[folder]} had it right${bluff ? ' all along' : ', too'}.` : ''
    return {
      voice: bluff || had ? 'color' : 'play',
      text: `${NAME[folder]} folds, and ${NAME[win.fighter]} takes ${win.amount} without a showdown.${bluff}${knew}${ko}`,
    }
  }
  if (showdown?.type === 'showdown') {
    const said = showdown.answers.map((a) => `${NAME[a.by]} says ${a.answer}`).join(', ')
    const result = win
      ? `${NAME[win.fighter]} takes ${win.amount}!`
      : events.some((e) => e.type === 'split')
        ? showdown.answers.every((answer) => answer.right)
          ? 'Both right, so they split it.'
          : 'Both wrong, and the unclaimed pot is shared.'
        : 'Both wrong, so the pot rides on.'
    return { voice: 'play', text: `Showdown! ${said}. The answer is ${truth}. ${result}${ko}` }
  }
  const carry = events.find((e) => e.type === 'carry')
  if (carry) {
    return {
      voice: 'color',
      text: `Nobody will put chips on it. ${carry.amount} rides to the next hand. It was ${truth}.`,
    }
  }
  const lead =
    after.stacks.claude === after.stacks.gpt
      ? 'Level on chips.'
      : `${after.stacks.claude > after.stacks.gpt ? NAME.claude : NAME.gpt} leads.`
  return { voice: 'color', text: `The pot is shared. It was ${truth}. ${lead}${ko}` }
}

/** The round as it was set up, not as it ended: a knockout can stop it early. */
export function introLine(record: Pick<BluffRecord, 'models' | 'limits'>): Line {
  const n = record.limits.hands
  return {
    voice: 'play',
    text: `Welcome to the Bluff table! ${record.models.claude.name} against ${record.models.gpt.name}, live. ${n} ${n === 1 ? 'question' : 'questions'}, real chips, and neither model can see the other's answer. You can.`,
  }
}

export function calibrationLine(hands: readonly ScriptedHand[]): Line {
  const part = (f: Fighter) => {
    const c = calibrate(hands, f)
    if (c.points.length === 0) return `${NAME[f]} submitted no private answers`
    const missing = hands.length - c.points.length
    const skipped = missing
      ? `, with ${missing} missing ${missing === 1 ? 'answer' : 'answers'} excluded`
      : ''
    return `${NAME[f]} said ${Math.round(c.said)} percent and was right ${Math.round(c.right)} percent of the time${skipped}`
  }
  return {
    voice: 'color',
    text: `Here is how sure they were, against how often they were right. ${part('gpt')}. ${part('claude')}.`,
  }
}

/** Stable line ids, shared by the broadcast and the voice script. */
export const lineId = {
  intro: 'bluff-intro',
  hand: (h: number) => `bluff-h${h + 1}`,
  calibration: 'bluff-calibration',
}

/**
 * A saved fight in the demo's shape, with captions and commentary derived from final actions
 * and engine events rather than legacy explanations.
 */
export function recordHands(record: BluffRecord): {
  hands: ScriptedHand[]
  intro: Line
  calibration: Line
} {
  const played = replayRecord(record)
  const hands = record.hands.map((hand, h): ScriptedHand => {
    const step = played[h]
    const hole = {} as Record<Fighter, Hole>
    for (const f of FIGHTERS) {
      const turn = hand.hole[f]
      hole[f] = {
        answer: turn.answer,
        confidence: turn.confidence,
        submitted: turn.ruling === 'played',
        think:
          turn.ruling === 'played'
            ? answerCaption(turn.answer, turn.confidence)
            : refereeThink(turn, 'No answer this hand.'),
      }
    }
    const moves = hand.moves.map(
      (m): Move => ({
        action: m.action,
        think:
          m.ruling === 'played'
            ? `${actionText(m.action)}.`
            : refereeThink(
                m,
                `The referee ${m.action.kind === 'pass' ? 'passes' : 'folds'} for it.`,
              ),
        ...(m.say ? { say: m.say } : {}),
      }),
    )
    const line: Line = step
      ? handLine(hand, step.events, step.after)
      : { voice: 'color', text: 'On we go.' }
    return { question: hand.question, opener: hand.opener, hole, moves, line }
  })
  return {
    hands,
    intro: introLine(record),
    calibration: calibrationLine(hands),
  }
}
