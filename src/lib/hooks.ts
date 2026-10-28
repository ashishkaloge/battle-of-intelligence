import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { type FightSettings, fightSettingsUrl, readFightSettings } from '../arena/corners.ts'
import { getMuted, pauseAudio, setMuted, subscribeMuted } from '../games/audio.ts'
import { PlaybackClock } from './playback.ts'

export const PlaybackContext = createContext<PlaybackClock | null>(null)

/** Short model explanations type at the replay's pace and honor reduced-motion preferences. */
export function useTyped(text: string, active: boolean, stepMs = 16) {
  const clock = useContext(PlaybackContext)
  const [count, setCount] = useState(active ? 0 : text.length)
  useEffect(() => {
    if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(text.length)
      return
    }
    setCount(0)
    const clear = (id: number) => (clock ? clock.clearInterval(id) : window.clearInterval(id))
    const tick = () =>
      setCount((n) => {
        if (n >= text.length) clear(timer)
        return Math.min(text.length, n + 1)
      })
    const timer = clock ? clock.setInterval(tick, stepMs) : window.setInterval(tick, stepMs)
    return () => clear(timer)
  }, [clock, text, active, stepMs])
  return text.slice(0, count)
}

/** All rounds share audio preferences, including when a full fight changes rounds. */
export function useMuted() {
  const muted = useSyncExternalStore(subscribeMuted, getMuted, () => false)
  return [muted, setMuted] as const
}

/** Pause timers, animations and commentary together; tear them down when leaving the round. */
export function usePlayback(playing: boolean) {
  const [clock] = useState(() => new PlaybackClock())
  useLayoutEffect(() => {
    clock.setPaused(!playing)
    pauseAudio(!playing)
  }, [clock, playing])
  useLayoutEffect(
    () => () => {
      clock.clear()
      pauseAudio(false)
    },
    [clock],
  )
  return clock
}

export const VIEWS = [
  'arena',
  'fight',
  'ring',
  'mirror',
  'buzzer',
  'brawl',
  'bluff',
  'rules',
  'benchmarks',
  'primitives',
] as const
export type View = (typeof VIEWS)[number]

const isView = (value: string): value is View => (VIEWS as readonly string[]).includes(value)

const readView = (): View => {
  const hash = window.location.hash.slice(1)
  return isView(hash) ? hash : 'arena'
}

/**
 * Runs `run` once, the first time `when` is true. React's development mode mounts every effect
 * twice, and starting a broadcast twice would skip its first beat.
 */
export function useOnce(when: boolean, run: () => void) {
  const done = useRef(false)
  useEffect(() => {
    if (!when || done.current) return
    done.current = true
    run()
  }, [when, run])
}

/** The current view, kept in the URL hash so a page can be linked and reloaded. */
export function useHashView() {
  const [view, setView] = useState<View>(readView)

  useEffect(() => {
    const onHashChange = () => setView(readView())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const go = useCallback((next: View) => {
    const url = new URL(window.location.href)
    url.hash = next === 'arena' ? '' : next
    window.history.replaceState(null, '', url)
    setView(next)
  }, [])

  return [view, go] as const
}

/** Keep the selected matchup and broadcast through refreshes and copied launch links. */
export function useFightSettings() {
  const [settings, setSettings] = useState(() => readFightSettings(window.location.search))
  useEffect(() => {
    const onPopState = () => setSettings(readFightSettings(window.location.search))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => {
    const url = fightSettingsUrl(new URL(window.location.href), settings)
    if (url.href !== window.location.href) window.history.replaceState(null, '', url)
  }, [settings])
  const update = useCallback((patch: Partial<FightSettings>) => {
    setSettings((current) => ({ ...current, ...patch }))
  }, [])
  return [settings, update] as const
}
