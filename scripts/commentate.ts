/**
 * Writes The Ring's commentary with an LLM instead of by hand. It replays the fight through the
 * real engine to get an honest play log, then asks a cheap model — through the CLI you are already
 * signed in to, using its existing subscription allowance — to call it as a two-person booth: Bryce on play-by-play
 * in the vein of Peter Drury, Cori on colour in the vein of Ravi Shastri. For the scripted demo the
 * lines land in src/games/ring/commentary.generated.ts; for a recorded fight they are saved into
 * its record. `pnpm voices` renders them to Piper. It is never the same call twice.
 *
 *   pnpm commentate
 *   pnpm commentate --fight src/games/ring/fights/<id>.json
 *   BOI_COMMENTATE_MODEL=claude-sonnet-5-5 BOI_COMMENTATE_EFFORT=high pnpm commentate
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { askCli } from '../server/cli.ts'
import {
  type Arena,
  CLASSIC_RULES,
  type Fighter,
  initialState,
  nextBout,
  type RingRules,
  resolveTurn,
} from '../src/games/ring/arena.ts'
import { type DemoBout, makeDemoArena, SCRIPTED } from '../src/games/ring/demo.ts'
import { describeTurn, openingArena, type RingRecord, recordBouts } from '../src/games/ring/live.ts'
import { stopOnCtrlC } from './fight-setup.ts'

const raw = process.env.BOI_COMMENTATE_LAB
const LAB: 'claude' | 'gpt' = raw === 'gpt' || raw === 'codex' ? 'gpt' : 'claude'
const MODEL =
  process.env.BOI_COMMENTATE_MODEL ?? (LAB === 'gpt' ? 'gpt-6-luna' : 'claude-haiku-5-5')
const EFFORT = process.env.BOI_COMMENTATE_EFFORT ?? 'low'
const NAME: Record<Fighter, string> = { claude: 'Claude', gpt: 'GPT' }

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { fight: { type: 'string' } },
})

type LogBout = Pick<DemoBout, 'turns' | 'highlight'>

/** Replays a fight under its own rules and writes it out as a readable log, one block per turn. */
function playLog(
  arena: Arena,
  bouts: readonly LogBout[],
  rules: RingRules = CLASSIC_RULES,
): string {
  let ring = initialState(arena, rules)
  const blocks: string[] = []
  bouts.forEach((bout, b) => {
    if (b > 0) ring = nextBout(ring)
    blocks.push(`BOUT ${b + 1} of ${bouts.length}`)
    bout.turns.forEach((turn, t) => {
      const before = ring
      const { state: after, events } = resolveTurn(ring, {
        claude: turn.claude.move,
        gpt: turn.gpt.move,
      })
      ring = after
      const what = describeTurn(events, before, after)
      const action = (f: Fighter) => {
        const side = turn[f]
        return `  ${NAME[f]} move: ${side.move}${side.flag ? ` (referee ruling: ${side.flag})` : ''}`
      }
      const lines = [
        `[b${b + 1}-t${t + 1}]${t === bout.highlight ? ' (bout highlight)' : ''}`,
        `  what happens: ${what.length ? what.join('; ') : 'quiet maneuvering'}`,
        `  score after: Claude ${after.fighters.claude.score}–${after.fighters.gpt.score} GPT, knockdowns ${after.fighters.claude.knockdowns}–${after.fighters.gpt.knockdowns}${rules.centerBounty ? `, center bounty Claude ${after.fighters.claude.bounty}–${after.fighters.gpt.bounty} GPT` : ''}`,
        `  positions after: Claude (${after.fighters.claude.pos.x},${after.fighters.claude.pos.y}), GPT (${after.fighters.gpt.pos.x},${after.fighters.gpt.pos.y}); the center is (${arena.center.x},${arena.center.y})`,
        action('claude'),
        action('gpt'),
      ]
      blocks.push(lines.join('\n'))
    })
  })
  return blocks.join('\n\n')
}

const PROMPT = `You are the commentary booth for "The Ring", a head-to-head fighting game between two AI models, Claude and GPT, on a grid whose rules are hidden in the floor. They shove each other, discover belts and traps, and a trap knocks you down. Three knockdowns is a knockout.

Two commentators share the booth:
- Bryce — PLAY-BY-PLAY (voice "play"). Calls the action with the surging, poetic energy of Peter Drury: short declaratives that build to a crescendo on the big moments, vivid verbs, the odd unforgettable turn of phrase. Never flat.
- Cori — ANALYST (voice "color"). Explains the engine result, with the dry wit and sharp read of a great cricket summariser like Ravi Shastri. One memorable, insightful sentence.

Write the commentary for the fight below. Rules:
- Every line is ONE spoken sentence, at most ~18 words. No emojis, no stage directions, no quotation marks around the whole line.
- Describe only the submitted moves and referee events in the log. Do not invent or quote a model's private thoughts, reasoning, intentions or decision process.
- Do NOT call every turn. Stay quiet on routine maneuvering and spend your voice on the real beats: shoves, knockdowns, the center changing hands, clever or reckless plays. This rhythm is what makes it exciting.
- Bryce (play) calls action beats as they happen. Cori (color) adds insight, and usually speaks just after a knockdown or a clever move, not during the scramble.
- For every bout write a "bell" line (Bryce, set the scene for that bout) and a "replay" line (Cori, explain the key idea of that bout's highlighted turn).
- Vary your phrasing. Never reuse a sentence or lean on a catchphrase more than once.

Output ONLY a JSON object mapping line id to {"voice","text"}. Use the ids in brackets in the log for turns you choose to call, plus "b{N}-bell" and "b{N}-replay" for every bout. Example:
{"b1-bell":{"voice":"play","text":"..."},"b1-t5":{"voice":"play","text":"..."},"b1-replay":{"voice":"color","text":"..."}}

THE FIGHT:

`

type Line = { voice: 'play' | 'color'; text: string }

function parse(text: string): Record<string, Line> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object in the reply')
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  const out: Record<string, Line> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (!/^b\d+-(bell|replay|t\d+)$/.test(id)) continue
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    const line = value as { voice?: unknown; text?: unknown }
    if ((line.voice !== 'play' && line.voice !== 'color') || typeof line.text !== 'string') continue
    const voice = line.voice
    const lineText = line.text.trim().replace(/\s+/g, ' ')
    if (lineText) out[id] = { voice, text: lineText }
  }
  if (Object.keys(out).length === 0) throw new Error('no usable lines in the reply')
  return out
}

function serialise(lines: Record<string, Line>): string {
  const order = (id: string) => {
    const [, bout, kind] = /^b(\d+)-(.*)$/.exec(id) ?? ['', '0', '']
    const rank = kind === 'bell' ? 0 : kind === 'replay' ? 99 : Number(kind.slice(1))
    return Number(bout) * 100 + rank
  }
  const body = Object.keys(lines)
    .sort((a, b) => order(a) - order(b))
    .map((id) => `  '${id}': ${JSON.stringify(lines[id])},`)
    .join('\n')
  return `import type { Line } from '../commentary.ts'

/**
 * LLM-written commentary for The Ring, keyed by line id. Generated by \`pnpm commentate\`; the demo
 * merges it in by id and falls back to the hand-written line where one is missing. Regenerate for a
 * fresh call, and run \`pnpm voices\` to render it to Piper audio.
 *
 * Model: ${LAB} ${MODEL} · effort: ${EFFORT} · ${new Date().toISOString().slice(0, 10)}
 */
export const GENERATED: Record<string, Line> = {
${body}
}
`
}

async function main() {
  const fightPath = values.fight ? resolve(values.fight) : null
  const record = fightPath ? (JSON.parse(await readFile(fightPath, 'utf8')) as RingRecord) : null
  const contact = record?.rules?.centerBounty
    ? "Contact rules are on. Every turn on the center pays a point and adds one to the holder's bounty; knock the holder off the center or down and you take the whole bounty, while stepping off or the bell banks it. A shove into the ropes or a pillar is a knockdown. When a bounty changes hands, that is the story of the turn.\n\n"
    : ''
  const log = record
    ? `This fight really happened: ${record.models.claude.name} (Claude) against ${record.models.gpt.name} (GPT). The log contains submitted moves and the engine's results, including marked referee fallbacks. Call it as it was, and only state what the log shows.\n\n${contact}${playLog(openingArena(record), recordBouts(record), record.rules)}`
    : playLog(makeDemoArena(), SCRIPTED)
  const controller = stopOnCtrlC('commentate')
  const cwd = await mkdtemp(join(tmpdir(), 'boi-commentate-'))
  try {
    console.log(`commentate: ${LAB} ${MODEL} at ${EFFORT} effort…`)
    const result = await askCli({
      lab: LAB,
      model: MODEL,
      effort: EFFORT,
      prompt: PROMPT + log,
      cwd,
      signal: controller.signal,
      timeoutMs: 4 * 60 * 1000,
    })
    if (controller.signal.aborted) throw new Error('stopped')
    if (result.toolUse.length) throw new Error('commentary used a tool and cannot be accepted')
    const lines = parse(result.text)
    if (record && fightPath) {
      await writeFile(
        fightPath,
        `${JSON.stringify({ ...record, commentary: lines, commentaryProtocol: 'actions-v1' }, null, 2)}\n`,
      )
    } else {
      const target = resolve(
        import.meta.dirname,
        '..',
        'src',
        'games',
        'ring',
        'commentary.generated.ts',
      )
      await writeFile(target, serialise(lines))
    }
    console.log(`commentate: wrote ${Object.keys(lines).length} lines in ${result.seconds}s`)
    for (const [id, line] of Object.entries(lines)) {
      console.log(`  ${id.padEnd(10)} ${line.voice === 'play' ? 'Bryce' : 'Cori '}  ${line.text}`)
    }
    console.log('\nNext: pnpm voices (needs Piper) to render the audio.')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

main().catch((error) => {
  if (error instanceof Error && error.message === 'stopped') process.exit(130)
  console.error(`commentate: ${(error as Error).message}`)
  process.exit(1)
})
