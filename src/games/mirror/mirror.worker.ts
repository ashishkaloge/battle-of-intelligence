import { playScript } from './demo.ts'

/**
 * Plays the scripted match off the main thread. Every attack runs Forge's solver to prove the
 * attacked puzzle is still fair, which takes about a second; the page stays responsive meanwhile.
 */
const scope = self as unknown as { postMessage: (message: unknown) => void }
scope.postMessage(playScript())
