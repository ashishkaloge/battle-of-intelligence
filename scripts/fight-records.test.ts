import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkBroadcastSlot, fightsDir, nextLeft, saveRecord } from './fight-setup.ts'

const directory = vi.hoisted(() => ({ value: '' }))
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>()
  return {
    ...actual,
    resolve: (...paths: string[]) =>
      paths[1] === '..' && paths[2] === 'src' && paths[3] === 'games'
        ? actual.resolve(directory.value, paths[4] ?? '')
        : actual.resolve(...paths),
  }
})

beforeEach(async () => {
  directory.value = await mkdtemp(join(tmpdir(), 'boi-record-test-'))
})
afterEach(async () => {
  await rm(directory.value, { recursive: true, force: true })
})
const fail = (message: string): never => {
  throw new Error(message)
}
const record = {
  playedAt: '2026-10-23T12:00:00.000Z',
  models: { claude: { name: 'Claude Test' }, gpt: { name: 'GPT-1 Test' } },
}

describe('saved fight records', () => {
  it('saves simultaneous fights without overwriting or exposing incomplete JSON', async () => {
    const saved = await Promise.all(
      Array.from({ length: 8 }, (_, sequence) => saveRecord('ring', { ...record, sequence })),
    )
    expect(new Set(saved.map((item) => item.id)).size).toBe(8)
    const files = await readdir(fightsDir('ring'))
    expect(files).toHaveLength(8)
    const records = await Promise.all(
      files.map(async (file) => JSON.parse(await readFile(join(fightsDir('ring'), file), 'utf8'))),
    )
    expect(records.map((item) => item.sequence).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    for (const item of records) expect(files).toContain(`${item.id}.json`)
  })

  it('keeps model names within a safe filename and rejects invalid dates and rounds', async () => {
    const saved = await saveRecord('ring', {
      ...record,
      models: { claude: { name: '../../unsafe/name' }, gpt: { name: 'model/with spaces' } },
    })
    expect(saved.id).not.toContain('/')
    expect(saved.id).not.toContain('..')
    expect(() => fightsDir('../../outside')).toThrow('unknown fight round')
    await expect(saveRecord('ring', { ...record, playedAt: '../../outside' })).rejects.toThrow(
      'invalid fight date',
    )
  })

  it('does not save an interrupted fight', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(saveRecord('ring', record, controller.signal)).rejects.toThrow('stopped')
    expect(await readdir(directory.value)).toEqual([])
  })

  it('alternates the Ring opener from its saved record just like the other games', async () => {
    expect(nextLeft('ring', undefined, fail)).toBe('claude')
    await saveRecord('ring', { ...record, opener: 'gpt' })
    expect(nextLeft('ring', undefined, fail)).toBe('claude')
    await saveRecord('ring', { ...record, playedAt: '2026-10-23T12:00:01.000Z', opener: 'claude' })
    expect(nextLeft('ring', undefined, fail)).toBe('gpt')
  })
})

describe('named broadcast records', () => {
  const named = {
    ...record,
    broadcast: 'launch-1',
    models: {
      claude: { id: 'claude-test', name: 'Claude Test' },
      gpt: { id: 'gpt-test', name: 'GPT Test' },
    },
    effort: { claude: 'medium', gpt: 'medium' },
    turns: [{ claude: { ruling: 'played' }, gpt: { ruling: 'played' } }],
  }

  it('stores a stable round identity and prevents duplicates, including concurrent saves', async () => {
    const saves = await Promise.allSettled([saveRecord('ring', named), saveRecord('ring', named)])
    expect(saves.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await readdir(fightsDir('ring'))).toEqual(['broadcast-launch-1-ring.json'])
    expect(() => checkBroadcastSlot('ring', named)).toThrow('already has a ring round')
    expect(() => checkBroadcastSlot('mirror', named)).not.toThrow()
  })

  it('rejects mixed models or efforts before a new round starts', async () => {
    await saveRecord('ring', named)
    expect(() =>
      checkBroadcastSlot('mirror', { ...named, effort: { claude: 'low', gpt: 'low' } }),
    ).toThrow('same models and effort')
    expect(() =>
      checkBroadcastSlot('mirror', {
        ...named,
        models: { ...named.models, gpt: { id: 'different', name: 'different' } },
      }),
    ).toThrow('same models and effort')
  })

  it('never saves an error-only broadcast round', async () => {
    await expect(
      saveRecord('ring', {
        ...named,
        turns: [{ claude: { ruling: 'error' }, gpt: { ruling: 'error' } }],
      }),
    ).rejects.toThrow('broadcast round not saved')
    expect(await readdir(directory.value)).toEqual([])
  })
})
