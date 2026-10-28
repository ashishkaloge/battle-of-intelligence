import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AskOptions, askCli, cliEnv, cliStatus } from './cli.ts'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

type Plan = {
  output?: string
  stderr?: string
  code?: number
  hold?: boolean
  ignoreTerm?: boolean
}
const children: Array<EventEmitter & { kill: ReturnType<typeof vi.fn> }> = []
const plans: Plan[] = []
const auth = (lab: 'claude' | 'gpt') =>
  lab === 'claude'
    ? JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' })
    : 'Logged in using ChatGPT\n'
const events = (...values: unknown[]) =>
  `${values.map((value) => JSON.stringify(value)).join('\n')}\n`
const reply = events(
  { type: 'item.completed', item: { id: 'reply', type: 'agent_message', text: '{"move":"wait"}' } },
  { type: 'turn.completed' },
)
const base = (): AskOptions => ({
  lab: 'gpt',
  model: 'test-model',
  effort: 'low',
  prompt: 'Test only',
  cwd: '/tmp',
  signal: new AbortController().signal,
  timeoutMs: 10_000,
  onThought: vi.fn(),
})

beforeEach(() => {
  children.length = 0
  plans.length = 0
  vi.mocked(spawn)
    .mockReset()
    .mockImplementation(() => {
      const plan = plans.shift()
      if (!plan) throw new Error('unexpected subprocess')
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
      })
      let closed = false
      const close = (code: number) => {
        if (closed) return
        closed = true
        child.stdout.end()
        child.stderr.end()
        child.emit('close', code)
      }
      child.kill.mockImplementation((signal: string) => {
        if (signal !== 'SIGTERM' || !plan.ignoreTerm) queueMicrotask(() => close(143))
        return true
      })
      children.push(child)
      queueMicrotask(() => {
        if (plan.output) child.stdout.write(plan.output)
        if (plan.stderr) child.stderr.write(plan.stderr)
        if (!plan.hold) close(plan.code ?? 0)
      })
      return child as unknown as ChildProcess
    })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('CLI authentication and isolation', () => {
  it('does not inherit provider credentials, host-session settings or unrelated secrets', () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-token')
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'test-key')
    vi.stubEnv('PRIVATE_SERVICE_SECRET', 'test-secret')
    vi.stubEnv('CLAUDE_CODE_SIMPLE', '1')
    vi.stubEnv('NODE_OPTIONS', '--inspect')
    const env = cliEnv()
    for (const name of [
      'OPENAI_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'AWS_ACCESS_KEY_ID',
      'PRIVATE_SERVICE_SECRET',
      'CLAUDE_CODE_SIMPLE',
      'NODE_OPTIONS',
    ])
      expect(env[name]).toBeUndefined()
    expect(env.PATH).toBe(process.env.PATH)
    // macOS CLI authentication requires the ordinary user identity environment.
    expect(env.USER).toBe(process.env.USER)
    expect(env.HOME).toBe(process.env.HOME)
  })

  it('rejects successful API-key or unknown logins without making a model call', async () => {
    plans.push({ output: 'Logged in using an API key\n' })
    await expect(askCli(base())).rejects.toThrow('verified subscription login')
    expect(spawn).toHaveBeenCalledTimes(1)
    plans.push({
      output: JSON.stringify({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }),
    })
    await expect(askCli({ ...base(), lab: 'claude' })).rejects.toThrow(
      'verified subscription login',
    )
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('requires a verified login for each call and disables shell, rules and API authentication', async () => {
    plans.push({ output: auth('gpt') }, { output: reply })
    await expect(askCli(base())).resolves.toMatchObject({ text: '{"move":"wait"}', toolUse: [] })
    expect(vi.mocked(spawn).mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining([
        'forced_login_method="chatgpt"',
        'features.shell_tool=false',
        'approval_policy="never"',
        'project_doc_max_bytes=0',
        '--ignore-user-config',
        '--ignore-rules',
        '--ephemeral',
      ]),
    )
  })

  it('returns only subscription readiness and generic hints', async () => {
    plans.push({ output: auth('claude') }, { output: 'unrecognized status format' })
    const status = await cliStatus()
    expect(status.claude.ready).toBe(true)
    expect(status.gpt.ready).toBe(false)
    expect(JSON.stringify(status)).not.toContain('unrecognized')
  })
})

describe('CLI response lifecycle', () => {
  it('uses only the final Claude answer and ignores streamed or complete thinking blocks', async () => {
    plans.push(
      { output: auth('claude') },
      {
        output: events(
          {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              delta: { type: 'thinking_delta', thinking: 'PRIVATE_REASONING_CANARY' },
            },
          },
          {
            type: 'assistant',
            message: {
              content: [{ type: 'thinking', thinking: 'PRIVATE_REASONING_CANARY' }],
            },
          },
          { type: 'result', subtype: 'success', result: '{"move":"wait"}' },
        ),
      },
    )
    const onThought = vi.fn()
    const result = await askCli({ ...base(), lab: 'claude', onThought })
    expect(result).toMatchObject({ text: '{"move":"wait"}', toolUse: [] })
    expect(onThought).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('PRIVATE_REASONING_CANARY')
    const args = vi.mocked(spawn).mock.calls[1]?.[1]
    expect(args).not.toContain('--thinking-display')
    expect(args).not.toContain('--include-partial-messages')
  })

  it('uses only the final Codex answer and does not forward reasoning items', async () => {
    plans.push(
      { output: auth('gpt') },
      {
        output: events(
          {
            type: 'item.completed',
            item: { id: 'reasoning', type: 'reasoning', text: 'PRIVATE_REASONING_CANARY' },
          },
          { type: 'item.completed', item: { id: 'reply', type: 'agent_message', text: '{}' } },
          { type: 'turn.completed' },
        ),
      },
    )
    const onThought = vi.fn()
    const result = await askCli({ ...base(), onThought })
    expect(result).toMatchObject({ text: '{}', toolUse: [] })
    expect(onThought).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('PRIVATE_REASONING_CANARY')
    expect(vi.mocked(spawn).mock.calls[1]?.[1]?.join(' ')).not.toContain('model_reasoning_summary')
  })

  it('rejects a nonzero exit even when a completed answer arrived', async () => {
    plans.push({ output: auth('gpt') }, { output: reply, code: 1, stderr: 'private diagnostic' })
    await expect(askCli(base())).rejects.toThrow('exited 1 without a completed reply')
  })

  it('does not accept an interrupted text stream as a completed answer', async () => {
    plans.push(
      { output: auth('claude') },
      {
        output: events({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: '{"move":"wait"}' },
          },
        }),
      },
    )
    await expect(askCli({ ...base(), lab: 'claude' })).rejects.toThrow('without a completed reply')
  })

  it('ignores malformed event shapes and accepts a complete Claude result', async () => {
    plans.push(
      { output: auth('claude') },
      {
        output: events(
          null,
          [],
          {
            type: 'assistant',
            message: { content: [null, 'wrong', { type: 'tool_use', name: 'Read' }] },
          },
          { type: 'result', subtype: 'success', result: '{}' },
        ),
      },
    )
    await expect(askCli({ ...base(), lab: 'claude' })).resolves.toMatchObject({
      text: '{}',
      toolUse: ['Read'],
    })
  })

  it('never copies provider diagnostics into public fight errors', async () => {
    plans.push(
      { output: auth('gpt') },
      { output: events({ type: 'error', message: 'private diagnostic identifier' }) },
    )
    await expect(askCli(base())).rejects.toThrow('the CLI reported an error')
  })

  it('classifies Claude structured error details without returning their contents', async () => {
    plans.push(
      { output: auth('claude') },
      {
        output: events({
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          errors: ['Usage limit reached for PRIVATE_CANARY', null],
        }),
      },
    )
    const error = await askCli({ ...base(), lab: 'claude' }).catch((value: Error) => value)
    expect(error).toMatchObject({ message: 'the CLI reached its usage allowance' })
    expect(String(error)).not.toContain('PRIVATE_CANARY')
  })

  it('uses only a fixed stderr classification when a CLI exits without a reply', async () => {
    plans.push(
      { output: auth('claude') },
      { stderr: 'HTTP 529 overloaded; PRIVATE_CANARY', code: 1 },
    )
    const error = await askCli({ ...base(), lab: 'claude' }).catch((value: Error) => value)
    expect(error).toMatchObject({
      message: 'the CLI encountered a temporary provider or network failure',
    })
    expect(String(error)).not.toContain('PRIVATE_CANARY')
  })

  it('does not turn a diagnostic warning into a failed successful response', async () => {
    plans.push(
      { output: auth('gpt') },
      { output: reply, stderr: 'temporary connection warning; PRIVATE_CANARY' },
    )
    await expect(askCli(base())).resolves.toMatchObject({ text: '{"move":"wait"}' })
  })

  it('recognizes a structured Claude refusal without exposing its explanation', async () => {
    plans.push(
      { output: auth('claude') },
      {
        output: events(
          {
            type: 'system',
            subtype: 'api_refusal',
            api_refusal_category: 'test-category',
            api_refusal_explanation: 'PRIVATE_CANARY',
          },
          { type: 'result', subtype: 'success', is_error: true, result: 'PRIVATE_CANARY' },
        ),
        code: 1,
      },
    )
    const error = await askCli({ ...base(), lab: 'claude' }).catch((value: Error) => value)
    expect(error).toMatchObject({ message: 'the provider refused this request' })
    expect(String(error)).not.toContain('PRIVATE_CANARY')
    expect(String(error)).not.toContain('test-category')
  })

  it('escalates a stuck subprocess to SIGKILL at timeout', async () => {
    vi.useFakeTimers()
    plans.push({ output: auth('gpt') }, { hold: true, ignoreTerm: true })
    const result = askCli(base()).catch((error: Error) => error)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(children[1]?.kill).toHaveBeenCalledWith('SIGTERM')
    await vi.advanceTimersByTimeAsync(1000)
    expect(children[1]?.kill).toHaveBeenCalledWith('SIGKILL')
    expect(await result).toMatchObject({ name: 'TimeoutError' })
  })

  it.skipIf(process.platform === 'win32')(
    'finishes killing the process group when the CLI leader closes during termination',
    async () => {
      vi.useFakeTimers()
      plans.push({ output: auth('gpt') }, { hold: true })
      const result = askCli(base()).catch((error: Error) => error)
      await vi.advanceTimersByTimeAsync(0)
      Object.defineProperty(children[1], 'pid', { value: 23456 })
      const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
        if (signal === 'SIGTERM') queueMicrotask(() => children[1]?.emit('close', 143))
        return true
      })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await result).toMatchObject({ name: 'TimeoutError' })
      // Descendants can outlive their leader after closing inherited output pipes.
      expect(kill.mock.calls).toEqual([
        [-23456, 'SIGTERM'],
        [-23456, 'SIGKILL'],
      ])
    },
  )

  it('cancels an in-progress auth check before any model call starts', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    plans.push({ hold: true })
    const result = askCli({ ...base(), signal: controller.signal }).catch((error: Error) => error)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(await result).toMatchObject({ message: 'stopped' })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(children[0]?.kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('bounds subprocess output and stops the process', async () => {
    plans.push({ output: auth('gpt') }, { output: 'x'.repeat(4 * 1024 * 1024 + 1), hold: true })
    await expect(askCli(base())).rejects.toThrow('safety limit')
    expect(children[1]?.kill).toHaveBeenCalledWith('SIGTERM')
  })
})
