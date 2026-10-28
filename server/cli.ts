import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

export type Lab = 'claude' | 'gpt'

/** Prefer the launchers in ~/.local/bin, since a script may start without them on PATH. */
const bin = (name: string) => {
  const local = join(homedir(), '.local', 'bin', name)
  return existsSync(local) ? local : name
}

const BIN: Record<Lab, string> = { claude: bin('claude'), gpt: bin('codex') }

/** Only the environment needed for local launchers and their own stored subscription login. */
const LAUNCH_ENV =
  /^(PATH|HOME|USER|LOGNAME|SHELL|USERPROFILE|APPDATA|LOCALAPPDATA|SystemRoot|SYSTEMROOT|COMSPEC|PATHEXT|TMPDIR|TMP|TEMP|LANG|LC_[A-Z_]+|CODEX_HOME|XDG_CONFIG_HOME|XDG_DATA_HOME|XDG_CACHE_HOME)$/

export const cliEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => LAUNCH_ENV.test(key)))

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const KILL_GRACE_MS = 1000
const nameOf = (lab: Lab) => (lab === 'claude' ? 'Claude Code' : 'Codex')
const stopped = (signal: AbortSignal) => {
  if (signal.aborted) throw new Error('stopped')
}
const timeoutError = () =>
  Object.assign(new Error('the reply exceeded its shot clock'), { name: 'TimeoutError' })
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** Stop the process group too: CLI launchers can leave descendants holding the output pipes. */
function kill(child: ChildProcess, signal: NodeJS.Signals) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    // Already exited. A missing process is the desired state.
  }
}

function terminate(child: ChildProcess) {
  kill(child, 'SIGTERM')
  return setTimeout(() => kill(child, 'SIGKILL'), KILL_GRACE_MS)
}

/** A leader can close its pipes before descendants finish; closing is not group cleanup. */
function finishTermination(child: ChildProcess, timer: ReturnType<typeof setTimeout> | undefined) {
  if (!timer) return
  clearTimeout(timer)
  kill(child, 'SIGKILL')
}

/** Status output stays in memory; neither account details nor credentials leave this function. */
function subscriptionReady(lab: Lab, signal?: AbortSignal, timeoutMs = 15_000): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false)
    const args =
      lab === 'claude'
        ? ['--safe-mode', '--setting-sources', '', 'auth', 'status', '--json']
        : ['login', 'status']
    const child = spawn(BIN[lab], args, {
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    let output = ''
    let failed = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      failed = true
      killTimer ??= terminate(child)
    }
    const timer = setTimeout(stop, timeoutMs)
    signal?.addEventListener('abort', stop, { once: true })
    const read = (chunk: Buffer) => {
      if (output.length + chunk.length > 64 * 1024) return stop()
      output += chunk.toString()
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('error', () => {
      failed = true
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finishTermination(child, killTimer)
      signal?.removeEventListener('abort', stop)
      if (failed || code !== 0) return resolve(false)
      if (lab === 'gpt') return resolve(/^Logged in using ChatGPT\s*$/im.test(output))
      try {
        const status = object(JSON.parse(output))
        resolve(
          status.loggedIn === true &&
            status.authMethod === 'claude.ai' &&
            status.apiProvider === 'firstParty',
        )
      } catch {
        resolve(false)
      }
    })
  })
}

/**
 * Final-answer-only calls. Claude Code gets no tools at all. Codex disables its shell and uses a
 * read-only sandbox as defense in depth; neither it nor an empty folder is a host boundary.
 * Reasoning output is not requested or collected. Unexpected tools are rules violations.
 */
function argsFor(lab: Lab, model: string, effort: string, prompt: string): string[] {
  if (lab === 'claude') {
    return [
      '-p',
      prompt,
      '--model',
      model,
      '--effort',
      effort,
      '--output-format',
      'stream-json',
      '--verbose',
      '--tools',
      '',
      '--strict-mcp-config',
      '--safe-mode',
      '--setting-sources',
      '',
      '--disable-slash-commands',
      '--no-session-persistence',
    ]
  }
  return [
    'exec',
    '--model',
    model,
    '-c',
    `model_reasoning_effort="${effort}"`,
    '-c',
    'forced_login_method="chatgpt"',
    '-c',
    'model_provider="openai"',
    '-c',
    'approval_policy="never"',
    '-c',
    'features.shell_tool=false',
    '-c',
    'project_doc_max_bytes=0',
    '-c',
    'web_search="disabled"',
    '--json',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    prompt,
  ]
}

export type AskOptions = {
  lab: Lab
  model: string
  effort: string
  prompt: string
  cwd: string
  signal: AbortSignal
  timeoutMs: number
  /** Ignored compatibility field. Reasoning output is never collected or forwarded. */
  onThought?: (text: string, mode: 'new' | 'append') => void
}

export type AskResult = { text: string; seconds: number; toolUse: string[] }

const UNKNOWN_FAILURE = 'the CLI reported an error'

/** Provider errors can contain account details or secrets; persist only fixed classifications. */
export const failureHint = (text: string) => {
  if (/rate.?limit|too many requests|\b429\b/i.test(text)) return 'the CLI reached a rate limit'
  if (/quota|usage.?(?:limit|allowance)|credit|billing/i.test(text))
    return 'the CLI reached its usage allowance'
  if (/unauthori[sz]ed|authenticat(?:ion|e)|login|sign.?in|\b401\b|\b403\b/i.test(text))
    return 'the CLI could not authenticate its subscription'
  if (/model.*(?:not found|unavailable|not supported|does not exist)/i.test(text))
    return 'the selected model is unavailable in this CLI account'
  if (/provider.*refus|request.*refus|safety.?stop|api_refusal/i.test(text))
    return 'the provider refused this request'
  if (
    /overloaded|temporar(?:y|ily)|connection|network|fetch failed|\b50[0234]\b|\b529\b/i.test(text)
  )
    return 'the CLI encountered a temporary provider or network failure'
  return UNKNOWN_FAILURE
}

/** Verifies subscription authentication, then runs one bounded CLI call. */
export async function askCli(options: AskOptions): Promise<AskResult> {
  const { lab, model, effort, prompt, cwd, signal, timeoutMs } = options
  const started = performance.now()
  stopped(signal)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
    throw new Error('invalid CLI timeout')
  if (!(await subscriptionReady(lab, signal, Math.min(15_000, timeoutMs)))) {
    stopped(signal)
    if (performance.now() - started >= timeoutMs) throw timeoutError()
    throw new Error(
      `${nameOf(lab)} requires a verified subscription login; API-key and unknown authentication are disabled`,
    )
  }
  stopped(signal)
  const remaining = timeoutMs - (performance.now() - started)
  if (remaining <= 0) throw timeoutError()

  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('stopped'))
    const child = spawn(BIN[lab], argsFor(lab, model, effort, prompt), {
      cwd,
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })

    let finalText = ''
    let completed = false
    let failure: string | null = null
    let outputBytes = 0
    const toolUse: string[] = []
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      killTimer ??= terminate(child)
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      failure =
        timeoutMs >= 120_000
          ? `no reply within ${Math.round(timeoutMs / 60000)} minutes`
          : `no reply within ${Math.round(timeoutMs / 1000)} seconds`
      stop()
    }, remaining)
    const onAbort = () => {
      failure = 'stopped'
      stop()
    }
    signal.addEventListener('abort', onAbort, { once: true })

    // Classify diagnostic fragments in memory; only the fixed hint can leave this function.
    // Keep a short overlap for a classification word split across chunks, never a raw log.
    let stderrTail = ''
    let stderrHint: string | null = null
    child.stderr.on('data', (chunk: Buffer) => {
      const text = stderrTail + chunk.toString()
      const hint = failureHint(text)
      if (hint !== UNKNOWN_FAILURE) stderrHint = hint
      stderrTail = text.slice(-128)
    })
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > MAX_OUTPUT_BYTES) {
        failure = 'CLI output exceeded the safety limit'
        // Readline otherwise retains an unfinished line until the process finally exits.
        lines.close()
        child.stdout.resume()
        stop()
      }
    })

    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      if (failure) return
      let event: Record<string, unknown>
      try {
        event = object(JSON.parse(line))
      } catch {
        return
      }
      try {
        if (lab === 'claude') readClaude(event)
        else readCodex(event)
      } catch {
        failure = 'could not process the CLI response'
        stop()
      }
    })

    function readClaude(event: Record<string, unknown>) {
      const type = event.type
      if (
        type === 'system' &&
        typeof event.api_refusal_category === 'string' &&
        event.api_refusal_category !== ''
      ) {
        // A structured provider refusal is not an availability failure. Its explanation may
        // contain request/account details, so retain only this fixed classification.
        failure = 'the provider refused this request'
        return
      }
      if (type === 'stream_event') return
      if (type === 'assistant') {
        const message = object(event.message)
        const content = Array.isArray(message.content) ? message.content : []
        for (const value of content) {
          const block = object(value)
          if (block.type === 'tool_use') toolUse.push(String(block.name ?? 'tool'))
        }
        return
      }
      if (type === 'result') {
        const result = typeof event.result === 'string' ? event.result : ''
        if (event.is_error === true || event.subtype !== 'success') {
          const errors = Array.isArray(event.errors)
            ? event.errors.filter((value): value is string => typeof value === 'string')
            : []
          failure = failureHint([result, ...errors].join('\n'))
        } else {
          finalText = result
          completed = true
        }
      }
    }

    function readCodex(event: Record<string, unknown>) {
      const type = String(event.type ?? '')
      if (type === 'turn.completed') completed = true
      const item = object(event.item)
      if (item && type.startsWith('item.')) {
        const kind = String(item.type ?? '')
        if (kind === 'reasoning') return
        if (kind === 'agent_message' && type === 'item.completed') {
          finalText = typeof item.text === 'string' ? item.text : ''
        } else if (kind && kind !== 'agent_message' && kind !== 'error') {
          if (type === 'item.started' || type === 'item.completed') {
            if (!toolUse.includes(kind)) toolUse.push(kind)
          }
        }
        return
      }
      if (type === 'error' || type === 'turn.failed') {
        const error = object(event.error)
        failure = failureHint(String(event.message ?? error.message ?? 'Codex reported an error'))
      }
    }

    child.on('error', () => {
      failure = `could not start ${nameOf(lab)}; check that its CLI is installed`
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      finishTermination(child, killTimer)
      lines.close()
      signal.removeEventListener('abort', onAbort)
      const seconds = Math.round((performance.now() - started) / 100) / 10
      const text = finalText
      if (failure) {
        // Callers with a shot clock tell a late reply apart from a broken one by this name.
        const error = new Error(failure === UNKNOWN_FAILURE ? (stderrHint ?? failure) : failure)
        if (timedOut) error.name = 'TimeoutError'
        return reject(error)
      }
      if (code !== 0 || !completed || !text) {
        return reject(
          new Error(
            stderrHint ??
              `${nameOf(lab)} exited ${code ?? 'without an exit code'} without a completed reply`,
          ),
        )
      }
      resolve({ text, seconds, toolUse })
    })
  })
}

/** Require subscription authentication; a successful API-key login must not pass this gate. */
export async function cliStatus(): Promise<Record<Lab, { ready: boolean; hint: string }>> {
  const [claude, gpt] = await Promise.all([subscriptionReady('claude'), subscriptionReady('gpt')])
  return {
    claude: {
      ready: claude,
      hint: claude
        ? 'Claude Code subscription is signed in'
        : 'Run: claude auth login (subscription required)',
    },
    gpt: {
      ready: gpt,
      hint: gpt ? 'Codex ChatGPT account is signed in' : 'Run: codex login (ChatGPT required)',
    },
  }
}
