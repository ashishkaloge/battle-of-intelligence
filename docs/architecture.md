# Architecture

One repository contains a React/TypeScript static viewer, deterministic game engines and local
Node recorders. Vite builds the viewer; Vitest tests engines and recorders; Biome checks formatting
and lint. The browser never calls the provider CLIs.

| Path | Responsibility |
| --- | --- |
| `src/arena` | Shared model tiers, effort mappings, and the broadcast setup screen. |
| `src/show` | Select saved fights, run the five-round broadcast, and show the series score. |
| `src/games/<round>` | Rules, fixtures, record types, replay builders, components and tests. |
| `src/games/forge` | Grid transformations and bounded solver used by Mirror. |
| `src/games/brawl/sandbox.ts` | QuickJS execution budgets and bot isolation. |
| `src/games/audio.ts` | Shared commentary playback, cancellation and mute state. |
| `src/ui`, `src/styles` | Shared controls, design tokens and round-specific layouts. |
| `server/cli.ts`, `server/move.ts` | Local CLI process lifecycle, subscription checks and decision limits. |
| `server/<round>.ts` | Live round orchestration using the same underlying referee rules. |
| `scripts/fight-*.ts` | Explicit recorder entrypoints and common option/persistence helpers. |
| `scripts/commentate.ts`, `scripts/voices.ts` | Optional commentary writing and local speech rendering. |
| `public/voice` | Reviewed generated commentary audio shipped with the static viewer. |
| `.github/workflows/ci.yml` | The single automated validation entrypoint. |

## Recording and playback

1. The operator chooses models, effort, limits, seed and opening side.
2. The recorder checks login and asks each corner for structured moves.
3. The engine scores each turn; invalid or late replies take a declared fallback.
4. A completed record is saved with the exact setup and result.
5. Vite includes records in the viewer; a replay follows their recorded inputs and rule version.

Brawl re-executes stored bots under the same seeded schedule and sandbox budgets. Bot randomness
uses a fixed reproducible sequence and the wall-clock `Date` global is unavailable. Mirror's scripted
demo uses a worker for solver work; recorded Mirror fights contain the already-computed verdicts.
The full broadcast selects one record per round, which can come from different recording sessions.

## Extending a round

Start with its existing engine, parser and record type. Validate model replies before changing
state. Preserve old records and add deterministic regressions for scoring changes. Keep narration
consistent with the result and update the audio only after reviewing its text. New rules should
have a version or explicit record field when they would change a historical replay.
