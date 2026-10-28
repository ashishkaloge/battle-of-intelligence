import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Arena } from './arena/Arena.tsx'
import { unlock } from './games/audio.ts'
import { flag } from './lib/cx.ts'
import { useFightSettings, useHashView, type View } from './lib/hooks.ts'
import { Segmented, type SegmentOption } from './ui/index.ts'
import { ViewBoundary } from './ui/ViewBoundary.tsx'

const Primitives = lazy(() =>
  import('./gallery/Primitives.tsx').then((m) => ({ default: m.Primitives })),
)
const Bluff = lazy(() => import('./games/bluff/Bluff.tsx').then((m) => ({ default: m.Bluff })))
const Brawl = lazy(() => import('./games/brawl/Brawl.tsx').then((m) => ({ default: m.Brawl })))
const Buzzer = lazy(() => import('./games/buzzer/Buzzer.tsx').then((m) => ({ default: m.Buzzer })))
const Mirror = lazy(() => import('./games/mirror/Mirror.tsx').then((m) => ({ default: m.Mirror })))
const Ring = lazy(() => import('./games/ring/Ring.tsx').then((m) => ({ default: m.Ring })))
const Benchmarks = lazy(() =>
  import('./pages/Benchmarks.tsx').then((m) => ({ default: m.Benchmarks })),
)
const Rules = lazy(() => import('./pages/Rules.tsx').then((m) => ({ default: m.Rules })))
const FullFight = lazy(() => import('./show/FullFight.tsx').then((m) => ({ default: m.FullFight })))

const NAV: readonly SegmentOption<View>[] = [
  { value: 'arena', label: 'Arena' },
  { value: 'ring', label: 'The Ring' },
  { value: 'mirror', label: 'Mirror' },
  { value: 'buzzer', label: 'Buzzer' },
  { value: 'brawl', label: 'Bot Brawl' },
  { value: 'bluff', label: 'Bluff' },
  { value: 'rules', label: 'Rules' },
  { value: 'benchmarks', label: 'Benchmarks' },
  { value: 'primitives', label: 'Primitives' },
]

export function App() {
  const [view, setView] = useHashView()
  const [settings, onSettings] = useFightSettings()
  // The full fight hides the top bar while it plays, so a screen recording is all broadcast.
  const [presenting, setPresenting] = useState(false)
  // Set by the arena's Start, so the full fight begins as soon as it opens.
  const [launch, setLaunch] = useState(false)
  const present = useCallback((on: boolean) => {
    setPresenting(on)
    if (on) setLaunch(false)
  }, [])
  // Leaving the full fight always brings the top bar back.
  useEffect(() => {
    if (view !== 'fight') setPresenting(false)
  }, [view])

  return (
    <div className="app" data-presenting={flag(presenting && view === 'fight')}>
      <header className="topbar">
        <span className="brand">
          <BrandMark />
          <span className="brand__name">Battle of Intelligence</span>
        </span>

        <Segmented
          className="topbar__nav"
          label="Section"
          value={view === 'fight' ? 'arena' : view}
          options={NAV}
          onChange={setView}
        />
      </header>

      <ViewBoundary key={view} onError={() => present(false)}>
        <Suspense
          fallback={
            <main className="replay-error" role="status">
              Loading replay…
            </main>
          }
        >
          {view === 'arena' && (
            <Arena
              settings={settings}
              onSettings={onSettings}
              onStart={() => {
                // The click is what lets the broadcast play sound, so unlock it here.
                unlock()
                setLaunch(true)
                setView('fight')
              }}
            />
          )}
          {view === 'fight' && (
            <FullFight
              settings={settings}
              onSettings={onSettings}
              autoStart={launch}
              onPresent={present}
              onExit={() => {
                setLaunch(false)
                setView('arena')
              }}
            />
          )}
          {view === 'ring' && <Ring />}
          {view === 'mirror' && <Mirror />}
          {view === 'buzzer' && <Buzzer />}
          {view === 'brawl' && <Brawl />}
          {view === 'bluff' && <Bluff />}
          {view === 'rules' && <Rules />}
          {view === 'benchmarks' && <Benchmarks />}
          {view === 'primitives' && <Primitives />}
        </Suspense>
      </ViewBoundary>
    </div>
  )
}

/** Two pieces on a 2×2 board, facing each other across the diagonal. */
function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="7" height="7" rx="2" fill="currentColor" />
      <rect x="10.5" y="1.5" width="6" height="6" rx="1.5" stroke="currentColor" opacity="0.32" />
      <rect x="1.5" y="10.5" width="6" height="6" rx="1.5" stroke="currentColor" opacity="0.32" />
      <rect x="10" y="10" width="7" height="7" rx="2" fill="currentColor" />
    </svg>
  )
}
