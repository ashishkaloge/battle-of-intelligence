import {
  DefaultIntrinsics,
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core'
import { type BotView, DIRS, type Dir } from './cycles.ts'

/**
 * Runs bot code that a model wrote. Each bot gets its own QuickJS interpreter compiled to
 * WebAssembly: no file system, no network, no imports, bounded memory, and a fixed budget of steps
 * per tick. The budget counts interpreter work rather than wall-clock time, so a bot that is too
 * slow is too slow on every machine and a replay always ends the same way.
 *
 * A bot is one script that defines `function move(state)`. It returns a direction, or
 * `{ dir, boost, say }`. Globals survive between ticks within one match.
 */

/**
 * QuickJS 0.32 undercounts allocations in its Emscripten allocator. Check its full heap census
 * independently and bound the module's linear memory as a backstop between interrupt checks.
 * Native operations can delay interrupt checks; this is not a wall-clock isolation boundary.
 */
export const LIMITS = {
  memoryBytes: 16 * 1024 * 1024,
  /** Shared by the two bot runtimes, including interpreter overhead and transient allocations. */
  moduleMemoryBytes: 64 * 1024 * 1024,
  stackBytes: 512 * 1024,
  /** Interrupt checks allowed per call; QuickJS checks roughly every 10,000 operations. */
  checksPerTick: 300,
  checksToLoad: 300,
  /** Heap census is linear in live objects; sample it instead of scanning on every interrupt. */
  checksPerMemoryScan: 16,
  sayLength: 24,
} as const

export type BotReply = { dir: Dir; boost: boolean; say: string | null }
/** Something the bot did wrong. In a fight this is a knockdown. */
export type BotFault = { kind: 'error' | 'timeout' | 'invalid'; message: string }

let quickjs: Promise<QuickJSWASMModule> | null = null

/** Loads the interpreter once, on first use. */
export function loadQuickJS(): Promise<QuickJSWASMModule> {
  quickjs ??= import('@jitl/quickjs-wasmfile-release-sync').then((variant) =>
    newQuickJSWASMModuleFromVariant(
      newVariant(variant.default, {
        wasmMemory: new WebAssembly.Memory({
          initial: 256,
          maximum: LIMITS.moduleMemoryBytes / 65536,
        }),
      }),
    ),
  )
  return quickjs
}

const BOOTSTRAP = `
globalThis.__step = (json) => {
  const reply = move(JSON.parse(json))
  return JSON.stringify(reply === undefined ? null : reply)
}
`

// Bots are rerun in a browser to replay the recorded fight. Neither random choices nor the
// local wall clock may change those results. Both corners start the same repeatable sequence.
const DETERMINISTIC_GLOBALS = `
(() => {
  let seed = 0
  const imul = Math.imul
  Object.defineProperty(Math, 'random', { value: () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = imul(t ^ (t >>> 15), t | 1)
    t ^= t + imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }, writable: false, configurable: false })
  Object.defineProperty(globalThis, 'Date', {
    value: undefined, writable: false, configurable: false
  })
})()
`

export class Bot {
  private readonly runtime: QuickJSRuntime
  private readonly vm: QuickJSContext
  private readonly step: QuickJSHandle
  private readonly budget: Budget

  private constructor(
    runtime: QuickJSRuntime,
    vm: QuickJSContext,
    step: QuickJSHandle,
    budget: Budget,
  ) {
    this.runtime = runtime
    this.vm = vm
    this.step = step
    this.budget = budget
  }

  /** Loads a bot's code. A bot that fails to load comes back as a fault, not a throw. */
  static load(qjs: QuickJSWASMModule, code: string): Bot | BotFault {
    const runtime = qjs.newRuntime()
    runtime.setMemoryLimit(LIMITS.memoryBytes)
    runtime.setMaxStackSize(LIMITS.stackBytes)
    const budget: Budget = { left: LIMITS.checksToLoad, memoryExceeded: false }
    // Native regex backtracking can run between interrupt checks. Grid bots do not need it.
    const vm = runtime.newContext({
      intrinsics: { ...DefaultIntrinsics, RegExp: false, RegExpCompiler: false },
    })
    runtime.setInterruptHandler(
      () =>
        --budget.left < 0 ||
        (budget.left % LIMITS.checksPerMemoryScan === 0 && exceedsMemory(runtime, vm, budget)),
    )
    const configured = vm.evalCode(DETERMINISTIC_GLOBALS, 'sandbox.js')
    if (configured.error) {
      const fault = describe(vm, configured.error, budget)
      configured.error.dispose()
      vm.dispose()
      runtime.dispose()
      return fault
    }
    configured.value.dispose()
    budget.left = LIMITS.checksToLoad
    const loaded = vm.evalCode(`${code}\n${BOOTSTRAP}`, 'bot.js')
    if (loaded.error || exceedsMemory(runtime, vm, budget)) {
      const fault = loaded.error ? describe(vm, loaded.error, budget) : memoryFault()
      ;(loaded.error ?? loaded.value).dispose()
      vm.dispose()
      runtime.dispose()
      return fault
    }
    loaded.value.dispose()
    const step = vm.getProp(vm.global, '__step')
    return new Bot(runtime, vm, step, budget)
  }

  /** Asks the bot for its move. Anything but a valid reply is a fault. */
  move(view: BotView): BotReply | BotFault {
    this.budget.left = LIMITS.checksPerTick
    const arg = this.vm.newString(JSON.stringify(view))
    const result = this.vm.callFunction(this.step, this.vm.undefined, arg)
    arg.dispose()
    if (result.error || exceedsMemory(this.runtime, this.vm, this.budget)) {
      const fault = result.error ? describe(this.vm, result.error, this.budget) : memoryFault()
      ;(result.error ?? result.value).dispose()
      return fault
    }
    const raw = this.vm.getString(result.value)
    result.value.dispose()
    return parseReply(raw)
  }

  dispose() {
    this.step.dispose()
    this.vm.dispose()
    this.runtime.dispose()
  }
}

export const isFault = (value: unknown): value is BotFault =>
  typeof value === 'object' && value !== null && 'kind' in value

type Budget = { left: number; memoryExceeded: boolean }
const memoryFault = (): BotFault => ({ kind: 'error', message: 'Exceeded the bot memory limit' })

/** Read a fresh native census, never guest-defined getters or JSON serialization. */
function exceedsMemory(runtime: QuickJSRuntime, vm: QuickJSContext, budget: Budget): boolean {
  if (budget.memoryExceeded) return true
  const usage = runtime.computeMemoryUsage()
  try {
    const size = vm.getProp(usage, 'memory_used_size')
    try {
      const bytes = vm.getNumber(size)
      budget.memoryExceeded = !Number.isFinite(bytes) || bytes > LIMITS.memoryBytes
    } finally {
      size.dispose()
    }
  } finally {
    usage.dispose()
  }
  return budget.memoryExceeded
}

function describe(vm: QuickJSContext, error: QuickJSHandle, budget: Budget): BotFault {
  if (budget.memoryExceeded) return memoryFault()
  if (budget.left < 0) return { kind: 'timeout', message: 'Ran out of time on this tick' }
  let dumped: unknown
  try {
    dumped = vm.dump(error)
  } catch {
    return { kind: 'error', message: 'The bot threw an unreadable error' }
  }
  if (typeof dumped !== 'object' || dumped === null) {
    return { kind: 'error', message: String(dumped).slice(0, 240) }
  }
  // A thrown object's fields are untrusted. Coercing one can itself throw in the host.
  const value = dumped as Record<string, unknown>
  const name = typeof value.name === 'string' ? value.name.slice(0, 80) : 'Error'
  const message = typeof value.message === 'string' ? value.message.slice(0, 240) : ''
  const stack = typeof value.stack === 'string' ? value.stack : ''
  const line = /bot\.js:(\d+)/.exec(stack)?.[1]
  const text = `${name}: ${message}`.trim()
  return { kind: 'error', message: (line ? `${text} (line ${line})` : text).slice(0, 240) }
}

function parseReply(raw: string): BotReply | BotFault {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { kind: 'invalid', message: 'Returned something that is not a move' }
  }
  const reply = typeof value === 'string' ? { dir: value } : value
  if (typeof reply !== 'object' || reply === null) {
    return { kind: 'invalid', message: `Returned ${raw.slice(0, 40)} instead of a move` }
  }
  const { dir, boost, say } = reply as { dir?: unknown; boost?: unknown; say?: unknown }
  if (!DIRS.includes(dir as Dir)) {
    return { kind: 'invalid', message: `Unknown direction ${JSON.stringify(dir)?.slice(0, 20)}` }
  }
  return {
    dir: dir as Dir,
    boost: boost === true,
    say: typeof say === 'string' && say.trim() ? say.trim().slice(0, LIMITS.sayLength) : null,
  }
}
