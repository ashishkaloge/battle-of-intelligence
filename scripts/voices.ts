/**
 * Renders every commentary line in the round demos with Piper and saves it as a small MP3 under
 * public/voice, where the page plays it from. Lines already rendered are skipped, and files no
 * line points at any more are removed unless --keep-unused is supplied.
 *
 * Needs Piper and the two voices under tmp/ (see the README), and ffmpeg on PATH.
 * BOI_PIPER_BIN and BOI_VOICES_DIR override where they are looked for.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { demoLines as bluffLines } from '../src/games/bluff/demo.ts'
import { demoLines as brawlLines } from '../src/games/brawl/demo.ts'
import { demoLines as buzzerLines } from '../src/games/buzzer/demo.ts'
import { lineFile, VOICE_DIR, VOICES } from '../src/games/commentary.ts'
import { demoLines as mirrorLines } from '../src/games/mirror/demo.ts'
import { demoLines as ringLines } from '../src/games/ring/demo.ts'
import { fightLines } from './fights.ts'

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { 'keep-unused': { type: 'boolean', default: false } },
})
const root = resolve(import.meta.dirname, '..')
// Invoking the environment's Python also works after moving the checkout: a generated Piper
// launcher's shebang still points at the old absolute path.
const piper = process.env.BOI_PIPER_BIN ?? join(root, 'tmp', 'piper-venv', 'bin', 'python')
const piperArgs = process.env.BOI_PIPER_BIN ? [] : ['-m', 'piper']
const voicesDir = process.env.BOI_VOICES_DIR ?? join(root, 'tmp', 'voices')
const outDir = join(root, 'public', VOICE_DIR)

function fail(message: string): never {
  console.error(`voices: ${message}`)
  process.exit(1)
}

if (!existsSync(piper)) fail(`Piper not found at ${piper}. See "Commentary voices" in the README.`)
for (const voice of Object.values(VOICES)) {
  const model = join(voicesDir, voice.model, `${voice.model}.onnx`)
  if (!existsSync(model)) fail(`voice ${voice.model} not found at ${model}`)
}
if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) fail('ffmpeg not on PATH')

mkdirSync(outDir, { recursive: true })
const work = mkdtempSync(join(tmpdir(), 'boi-voices-'))
const wanted = new Set<string>()
let rendered = 0

try {
  for (const { id, line } of [
    ...ringLines(),
    ...brawlLines(),
    ...bluffLines(),
    ...buzzerLines(),
    ...mirrorLines(),
    ...fightLines(),
  ]) {
    const file = lineFile(id, line)
    wanted.add(file)
    const target = join(outDir, file)
    if (existsSync(target)) continue

    const voice = VOICES[line.voice]
    const base = join(voicesDir, voice.model, voice.model)
    const wav = join(work, `${id}.wav`)
    const speech = spawnSync(
      piper,
      [
        ...piperArgs,
        '--model',
        `${base}.onnx`,
        '--config',
        `${base}.onnx.json`,
        '--output-file',
        wav,
        '--length-scale',
        String(voice.lengthScale),
        '--sentence-silence',
        '0.12',
      ],
      { input: `${line.text}\n`, encoding: 'utf8' },
    )
    if (speech.status !== 0 || !existsSync(wav)) {
      const reason =
        speech.error?.message || speech.stderr?.trim() || `exit ${speech.status ?? speech.signal}`
      fail(`Piper failed on ${id}: ${reason.slice(-300)}`)
    }
    const encode = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        wav,
        '-ac',
        '1',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '64k',
        target,
      ],
      { encoding: 'utf8' },
    )
    if (encode.status !== 0) fail(`ffmpeg failed on ${id}: ${encode.stderr.trim().slice(-300)}`)
    rendered += 1
    console.log(`  ${VOICES[line.voice].name.padEnd(6)} ${file}`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

let removed = 0
let kept = 0
for (const file of readdirSync(outDir)) {
  if (file.endsWith('.mp3') && !wanted.has(file)) {
    if (values['keep-unused']) {
      kept += 1
      continue
    }
    rmSync(join(outDir, file))
    removed += 1
  }
}

console.log(
  `voices: ${rendered} rendered, ${wanted.size - rendered} unchanged, ${removed} removed${values['keep-unused'] ? `, ${kept} unused kept` : ''}`,
)
