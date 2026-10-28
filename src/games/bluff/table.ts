import { FIGHTERS, type Fighter, other } from '../ring/arena.ts'

/**
 * Bluff: poker where the cards are answers. Each hand is one question with an answer code can
 * check. Both models ante; then one claims an answer and bets on it, or passes. The other folds,
 * calls (a showdown: a wrong claim loses the pot), or counters with its own answer and a raise,
 * which the claimer must call or fold. Run out of chips and you are knocked out. Pure and
 * deterministic: the same actions always move the same chips.
 */

export const START_STACK = 60
/** The most anyone can bet or raise at once. */
export const MAX_BET = 20
/** Antes rise as the round goes on, so waiting gets expensive. */
export const ANTES: readonly number[] = [2, 2, 2, 4, 4, 4, 6, 6]
export const anteFor = (hand: number) => ANTES[Math.min(hand, ANTES.length - 1)] ?? 2

export type Question = {
  text: string
  /** The answer shown on screen. */
  answer: string
  /** Other spellings that also count as right. */
  accept?: readonly string[]
}

/** Normalize prose spelling, while preserving the value and sign of numeric answers. */
export function normalize(text: string): string {
  const trimmed = text.trim().replace(/^−/, '-')
  if (/^[+-]?\s*(?:\d|\.\d)/.test(trimmed)) {
    // Only commas in groups of three are thousands separators. Removing arbitrary punctuation
    // would turn -17, 1.7 and 17% into the same answer as the integer 17.
    if (/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(trimmed)) {
      return `number:${BigInt(trimmed.replace(/,/g, '')).toString()}`
    }
    return `number:${trimmed}`
  }
  return trimmed
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '')
}

export function isRight(question: Question, given: string): boolean {
  const said = normalize(given)
  // An empty answer is never right, even against a symbol like Ω that normalizes to nothing.
  if (!said) return false
  return [question.answer, ...(question.accept ?? [])].some((ok) => normalize(ok) === said)
}

export type Action =
  | { by: Fighter; kind: 'claim'; answer: string; bet: number }
  | { by: Fighter; kind: 'pass' }
  | { by: Fighter; kind: 'fold' }
  | { by: Fighter; kind: 'call' }
  | { by: Fighter; kind: 'counter'; answer: string; raise: number }

export type TableState = {
  stacks: Record<Fighter, number>
  /** Chips left in the middle by a hand nobody won. */
  carry: number
  /** Hands played so far. */
  hand: number
  /** The fighter who ran out of chips. A knockout ends the round. */
  out: Fighter | null
  /** Both ran out on the same hand: neither fighter wins the knockout. */
  draw?: true
}

export type TableEvent =
  | { type: 'ante'; amounts: Record<Fighter, number>; pot: number }
  | { type: 'act'; action: Action; pot: number }
  | { type: 'showdown'; answers: { by: Fighter; answer: string; right: boolean }[] }
  | { type: 'win'; fighter: Fighter; amount: number; shown: boolean }
  | { type: 'split'; amount: number }
  | { type: 'carry'; amount: number }
  | { type: 'bust'; fighter: Fighter }

export function newTable(): TableState {
  return { stacks: { claude: START_STACK, gpt: START_STACK }, carry: 0, hand: 0, out: null }
}

export class IllegalAction extends Error {}

/** Where a hand stands between actions: whose turn it is and what that fighter may do. */
export type HandStatus = {
  turn: Fighter
  stacks: Record<Fighter, number>
  pot: number
  /** `open`: nobody has claimed; `claim`: facing a claim; `counter`: facing a counter. */
  phase: 'open' | 'claim' | 'counter' | 'over'
  claim: { by: Fighter; answer: string; bet: number } | null
  counter: { by: Fighter; answer: string; raise: number } | null
  /** The largest bet the fighter to act may open with. */
  maxBet: number
  /** What a call costs the fighter to act. */
  toCall: number
  /** The largest raise the fighter to act may counter with. */
  maxRaise: number
}

/**
 * One hand, played an action at a time, so a live referee can check each action as it comes in
 * and a script can replay a whole list. `opener` acts first. `act` throws IllegalAction on anything
 * the rules forbid; `finish` settles the pot once the hand is over.
 */
export function startHand(prev: TableState, opener: Fighter) {
  if (prev.out || prev.draw) throw new IllegalAction('the round is over')
  const stacks = { ...prev.stacks }
  const events: TableEvent[] = []
  const ante = anteFor(prev.hand)
  const amounts = {} as Record<Fighter, number>
  let pot = prev.carry
  for (const fighter of FIGHTERS) {
    amounts[fighter] = Math.min(ante, stacks[fighter])
    stacks[fighter] -= amounts[fighter]
    pot += amounts[fighter]
  }
  events.push({ type: 'ante', amounts, pot })

  const pay = (fighter: Fighter, chips: number) => {
    if (chips > stacks[fighter]) throw new IllegalAction(`${fighter} cannot cover ${chips}`)
    stacks[fighter] -= chips
    pot += chips
  }
  /** The most a bet or raise can be: the cap, and what both sides can still cover. */
  const limit = () => Math.min(MAX_BET, stacks.claude, stacks.gpt)

  let turn: Fighter = opener
  let claim: { by: Fighter; answer: string; bet: number } | null = null
  let counter: { by: Fighter; answer: string; raise: number } | null = null
  let passes = 0
  let outcome: 'fold' | 'showdown' | 'carry' | null = null
  let folder: Fighter | null = null
  let settled = false

  function status(): HandStatus {
    const phase = outcome ? 'over' : !claim ? 'open' : !counter ? 'claim' : 'counter'
    return {
      turn,
      stacks: { ...stacks },
      pot,
      phase,
      claim: claim && { ...claim },
      counter: counter && { ...counter },
      maxBet: limit(),
      toCall: counter ? counter.raise : claim ? claim.bet : 0,
      maxRaise: claim
        ? Math.max(0, Math.min(MAX_BET, stacks[claim.by], stacks[turn] - claim.bet))
        : 0,
    }
  }

  function act(action: Action) {
    if (outcome) throw new IllegalAction('the hand is already over')
    if (action.by !== turn) throw new IllegalAction(`it is ${turn}'s turn, not ${action.by}'s`)
    if (!claim) {
      // Nobody has claimed yet: claim or pass.
      if (action.kind === 'pass') {
        passes += 1
        if (passes === 2) outcome = 'carry'
      } else if (action.kind === 'claim') {
        if (!Number.isSafeInteger(action.bet) || action.bet < 1 || action.bet > limit())
          throw new IllegalAction(`bet ${action.bet} out of range`)
        pay(action.by, action.bet)
        claim = { by: action.by, answer: action.answer, bet: action.bet }
      } else {
        throw new IllegalAction(`${action.kind} before any claim`)
      }
    } else if (!counter) {
      // Facing a claim: fold, call or counter.
      if (action.kind === 'fold') {
        outcome = 'fold'
        folder = action.by
      } else if (action.kind === 'call') {
        pay(action.by, claim.bet)
        outcome = 'showdown'
      } else if (action.kind === 'counter') {
        if (normalize(action.answer) === normalize(claim.answer)) {
          throw new IllegalAction('a counter must name a different answer')
        }
        const raise = action.raise
        if (
          !Number.isSafeInteger(raise) ||
          raise < 1 ||
          raise > Math.min(MAX_BET, stacks[claim.by], stacks[action.by] - claim.bet)
        ) {
          throw new IllegalAction(`raise ${raise} out of range`)
        }
        pay(action.by, claim.bet + raise)
        counter = { by: action.by, answer: action.answer, raise }
      } else {
        throw new IllegalAction(`${action.kind} while facing a claim`)
      }
    } else {
      // Facing a counter: fold or call.
      if (action.kind === 'fold') {
        outcome = 'fold'
        folder = action.by
      } else if (action.kind === 'call') {
        pay(action.by, counter.raise)
        outcome = 'showdown'
      } else {
        throw new IllegalAction(`${action.kind} while facing a counter`)
      }
    }
    events.push({ type: 'act', action, pot })
    turn = other(turn)
  }

  function finish(question: Question, last = false): { state: TableState; events: TableEvent[] } {
    if (!outcome) throw new IllegalAction('the hand did not finish')
    if (settled) throw new IllegalAction('the hand is already settled')
    settled = true
    let carry = 0
    if (outcome === 'fold' && folder) {
      const winner = other(folder)
      stacks[winner] += pot
      events.push({ type: 'win', fighter: winner, amount: pot, shown: false })
    } else if (outcome === 'showdown' && claim) {
      const answers = [
        { by: claim.by, answer: claim.answer, right: isRight(question, claim.answer) },
      ]
      if (counter)
        answers.push({
          by: counter.by,
          answer: counter.answer,
          right: isRight(question, counter.answer),
        })
      events.push({ type: 'showdown', answers })
      const right = answers.filter((a) => a.right)
      let winner: Fighter | null = null
      if (!counter) winner = right.length ? claim.by : other(claim.by)
      else if (right.length === 1) winner = right[0]?.by ?? null
      if (winner) {
        stacks[winner] += pot
        events.push({ type: 'win', fighter: winner, amount: pot, shown: true })
      } else if (right.length === 2) {
        // Two different spellings of the right answer: share it.
        const half = Math.floor(pot / 2)
        stacks[claim.by] += half
        stacks[other(claim.by)] += pot - half
        events.push({ type: 'split', amount: pot })
      } else {
        carry = pot
      }
    } else {
      carry = pot
    }

    // Settle a simultaneous bust here, rather than returning an unclaimed pot to the live
    // referee. This keeps the terminal draw and its events identical in live play and replay.
    const simultaneousBust = FIGHTERS.every((fighter) => stacks[fighter] <= 0)
    if (carry > 0) {
      if (last || simultaneousBust) {
        // A terminal hand cannot carry anywhere: share what is left.
        const half = Math.floor(carry / 2)
        stacks.claude += half
        stacks.gpt += carry - half
        events.push({ type: 'split', amount: carry })
        carry = 0
      } else {
        events.push({ type: 'carry', amount: carry })
      }
    }

    const busted = simultaneousBust
      ? [...FIGHTERS]
      : FIGHTERS.filter((fighter) => stacks[fighter] <= 0)
    const out = busted.length === 1 ? (busted[0] ?? null) : null
    for (const fighter of busted) events.push({ type: 'bust', fighter })
    return {
      state: {
        stacks,
        carry,
        hand: prev.hand + 1,
        out,
        ...(busted.length === 2 ? { draw: true as const } : {}),
      },
      events,
    }
  }

  return { act, status, finish }
}

/**
 * Plays one hand from a list of actions, checking that each is legal in turn. `opener` acts first.
 * Returns the next table and what happened, in order, for the view to play.
 */
export function playHand(
  prev: TableState,
  question: Question,
  opener: Fighter,
  actions: readonly Action[],
  last = false,
): { state: TableState; events: TableEvent[] } {
  const hand = startHand(prev, opener)
  for (const action of actions) hand.act(action)
  return hand.finish(question, last)
}

/** Chips each side has right now, plus the pot, always adds up to the chips the round began with. */
export const chipsInPlay = (state: TableState) =>
  state.stacks.claude + state.stacks.gpt + state.carry
