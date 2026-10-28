import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Arena } from './Arena.tsx'

describe('Arena recording selection', () => {
  const render = (effort: 'medium' | 'max') =>
    renderToStaticMarkup(
      <Arena settings={{ tier: 'second', effort }} onSettings={() => {}} onStart={() => {}} />,
    )

  it('blocks Start when Max is selected but only Medium fights exist', () => {
    const html = render('max')
    expect(html).toMatch(/<button[^>]*battleground__start[^>]*disabled=""/)
    expect(html).toContain('Not recorded for the selected models and power:')
    expect(html).toContain('0 of 5 recorded')
    expect(html).not.toContain('Recorded at medium effort.')
  })

  it('allows Start when all five recordings match the selected power', () => {
    const html = render('medium')
    const start = html.match(/<button[^>]*battleground__start[^>]*>/)?.[0]
    expect(start).toBeDefined()
    expect(start).not.toContain('disabled')
    expect(html).toContain('Recorded at medium effort.')
    expect(html).not.toContain('Not recorded for the selected models and power:')
  })
})
