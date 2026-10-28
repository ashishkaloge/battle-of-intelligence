/** Play-by-play calls the action; color explains the thinking. */
export type Voice = 'play' | 'color'
export type Line = { voice: Voice; text: string }

/**
 * The two commentators use Piper voices whose model cards describe public-domain datasets.
 * See THIRD_PARTY_NOTICES.md for provenance and scope. A faster speed energizes the play-by-play.
 */
export type VoiceSpec = { name: string; role: string; model: string; lengthScale: number }

export const VOICES: Record<Voice, VoiceSpec> = {
  play: { name: 'Bryce', role: 'Play-by-play', model: 'en_US-bryce-medium', lengthScale: 0.84 },
  color: { name: 'Cori', role: 'Analyst', model: 'en_GB-cori-high', lengthScale: 0.95 },
}

/** Where rendered lines live, under Vite's public folder. */
export const VOICE_DIR = 'voice'

/** FNV-1a: tiny, stable, and the same in Node and the browser. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * A line's file name. The hash covers the words and the voice settings, so editing a line points
 * at a new file and a stale recording is never played against new captions.
 */
export function lineFile(id: string, line: Line): string {
  const voice = VOICES[line.voice]
  return `${id}-${fnv1a(`${voice.model}|${voice.lengthScale}|${line.text}`)}.mp3`
}
