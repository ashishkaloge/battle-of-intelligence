# Contributing

Use Node 22.18+ and pnpm 10.24.0. Install with `pnpm install --frozen-lockfile` and start the
viewer with `pnpm dev`. Watching recordings and running tests require no model credentials.

Keep changes focused and explain the observed problem, resulting behavior and checks in a pull
request. For a bug, include reproduction steps and a regression test where practical. Run:

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

The single CI workflow runs those checks. It never records fights or uses provider credentials.

Engine changes must preserve historical recordings or explicitly version their rules. A seed
reproduces the puzzle or floor, not a provider's model response. Keep scripted demos labeled and
check commentary against the engine's actual result. Do not change benchmark claims to imply that
these games reproduce official benchmark scores.

Recording a new fight consumes your own subscription allowance. Use the low-tier commands in the
README for an initial test, review the saved JSON and generated code, and render matching commentary
before submitting it. Never include credentials, account identifiers, local paths, session logs or
provider configuration. Keep environment files, temporary voice models and build output untracked.

The layout and UI primitives already live in `src/ui` and `src/styles`; extend those before adding
another component system. Referee behavior belongs in game engines and recorders, not UI components.
