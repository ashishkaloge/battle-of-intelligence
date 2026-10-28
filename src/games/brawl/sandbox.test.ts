import type { QuickJSWASMModule } from 'quickjs-emscripten-core'
import { beforeAll, describe, expect, it } from 'vitest'
import { startMatch, viewFor } from './cycles.ts'
import { Bot, type BotFault, isFault, LIMITS, loadQuickJS } from './sandbox.ts'

let qjs: QuickJSWASMModule
beforeAll(async () => {
  qjs = await loadQuickJS()
})

const view = viewFor(
  startMatch(
    {
      width: 7,
      height: 5,
      walls: [],
      starts: {
        claude: { pos: { x: 1, y: 2 }, dir: 'right' },
        gpt: { pos: { x: 5, y: 2 }, dir: 'left' },
      },
    },
    { boosts: 0, closeEvery: null },
  ),
  'claude',
)

/** Loads `code`, asks it for one move and disposes it. */
function ask(code: string, times = 1) {
  const bot = Bot.load(qjs, code)
  if (isFault(bot)) return bot
  let reply: ReturnType<Bot['move']> = { kind: 'invalid', message: 'never asked' }
  for (let i = 0; i < times; i++) reply = bot.move(view)
  bot.dispose()
  return reply
}

describe('sandbox', () => {
  it('runs a bot and reads its move, boost and taunt', () => {
    expect(ask(`function move(s) { return { dir: 'up', boost: true, say: ' hi ' } }`)).toEqual({
      dir: 'up',
      boost: true,
      say: 'hi',
    })
    expect(ask(`function move(s) { return s.you.x === 1 ? 'left' : 'right' }`)).toMatchObject({
      dir: 'left',
    })
  })

  it('keeps globals between ticks within a match', () => {
    const reply = ask(`let n = 0; function move() { n++; return n === 3 ? 'down' : 'up' }`, 3)
    expect(reply).toMatchObject({ dir: 'down' })
  })

  it('replays random choices identically in fresh sandboxes without a wall clock', () => {
    const code = `const start = Math.random(); function move() {
      return { dir: 'up', say: start + ':' + Math.random() }
    }`
    const first = ask(code, 1)
    expect(ask(code, 1)).toEqual(first)
    const next = ask(code, 2)
    expect(next).not.toEqual(first)
    expect(ask(code, 2)).toEqual(next)
    expect(ask(`function move() { return { dir: 'up', say: typeof Date } }`)).toMatchObject({
      say: 'undefined',
    })
  })

  it('reports an error with its line number', () => {
    const fault = ask(`function move(s) {\n  return s.grid[-1][0]\n}`) as BotFault
    expect(fault.kind).toBe('error')
    expect(fault.message).toMatch(/TypeError/)
    expect(fault.message).toMatch(/line 2/)
  })

  it('handles malformed thrown fields without throwing or poisoning the interpreter', () => {
    for (const field of ['name', 'message', 'stack']) {
      const fault = ask(`function move() { throw { ${field}: { toString: null } } }`)
      expect(fault).toMatchObject({ kind: 'error' })
    }
    const fault = ask(`function move() { throw new Error('x'.repeat(10000)) }`) as BotFault
    expect(fault.message.length).toBeLessThanOrEqual(240)
    expect(ask(`function move() { return 'down' }`)).toMatchObject({ dir: 'down' })
  })

  it('stops a bot that runs out of time', () => {
    expect(ask(`function move() { for (;;) {} }`)).toMatchObject({ kind: 'timeout' })
    expect(ask(`for (;;) {}\nfunction move() { return 'up' }`)).toMatchObject({ kind: 'timeout' })
  })

  it('stops a bot that runs out of memory', () => {
    const fault = ask(`function move() { const a = []; for (;;) a.push('x'.repeat(1e5)) }`)
    expect(isFault(fault)).toBe(true)
    // QuickJS takes a few seconds to give up at the cap; see LIMITS in sandbox.ts.
  }, 20_000)

  it('counts cumulative typed-array allocations at load and during a move', () => {
    const allocate = `arrays = []; for (let i = 0; i < 24; i++) {
      arrays.push(new Uint8Array(1024 * 1024))
    }`
    expect(ask(`let arrays; ${allocate}; function move() { return 'up' }`)).toMatchObject({
      kind: 'error',
      message: 'Exceeded the bot memory limit',
    })
    expect(ask(`let arrays; function move() { ${allocate}; return 'up' }`)).toMatchObject({
      kind: 'error',
      message: 'Exceeded the bot memory limit',
    })
  })

  it('caps linear memory between checks and recovers after exhausting it', () => {
    expect(
      isFault(
        ask(`function move() { const arrays = []; for (let i = 0; i < 80; i++) {
          arrays.push(new Uint8Array(1024 * 1024))
        }; return 'up' }`),
      ),
    ).toBe(true)
    expect(qjs.getWasmMemory().buffer.byteLength).toBeLessThanOrEqual(LIMITS.moduleMemoryBytes)
    expect(ask(`function move() { return 'down' }`)).toMatchObject({ dir: 'down' })
  })

  it('omits native regular expressions, including literal and string-method paths', () => {
    expect(ask(`function move() { return {dir: 'up', say: typeof RegExp} }`)).toMatchObject({
      say: 'undefined',
    })
    expect(ask(`function move() { return /a/.test('a') ? 'up' : 'down' }`)).toMatchObject({
      kind: 'error',
    })
    expect(ask(`function move() { return 'aaa'.match('a') ? 'up' : 'down' }`)).toMatchObject({
      kind: 'error',
    })
  })

  it('rejects anything that is not a move', () => {
    expect(ask(`function move() { return 'north' }`)).toMatchObject({ kind: 'invalid' })
    expect(ask(`function move() {}`)).toMatchObject({ kind: 'invalid' })
    expect(ask(`const nothing = 1`)).toMatchObject({ kind: 'error' })
  })

  it('has no way out: no network, no modules, no host', () => {
    const probe = `function move() {
      const found = ['fetch', 'require', 'process', 'XMLHttpRequest', 'WebSocket', 'importScripts']
        .filter((name) => typeof globalThis[name] !== 'undefined')
      return { dir: 'up', say: found.join(',') || 'sealed' }
    }`
    expect(ask(probe)).toMatchObject({ say: 'sealed' })
  })
})
