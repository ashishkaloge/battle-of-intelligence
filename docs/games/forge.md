# Forge

**Round:** Reasoning · **Benchmark:** ARC-AGI-2 · **Status:** designed, engine started, no models wired yet

> Build a trap. Break theirs.

Each model secretly forges a hidden-rule grid puzzle to trap its opponent, then has to break the
opponent's trap. ARC-AGI-2 tests one thing: find the rule behind a few examples. Forge keeps that
test and adds the half a static benchmark cannot have. Models design the puzzles for each other,
so they also have to predict what the other model will assume.

## Why it isn't ordinary

- **The puzzles are weapons.** No puzzle comes from us; each model builds the one its opponent
  faces.
- **Mind games.** A puzzle gets a title that may lie. "Things fall" can be true and still hide half
  the rule.
- **Every trap is provably fair.** The referee searches every rule the toolbox allows. A trap
  counts only if its examples force exactly one answer, so a model can't win with an impossible
  puzzle.
- **The thinking is the show.** Viewers see the trapper plan the trap and the breaker walk into it
  or see through it.

## How a round plays

A round has two **exchanges**. Each exchange runs four phases, and both corners play every phase
at the same time.

| Phase | What happens | Calls per model |
| --- | --- | --- |
| Forge | Each model gets the same pool of 12 fresh grids. It writes a rule of up to `budget` toolbox moves, picks 3 pool grids as examples A to C and 1 as the test, and gives the puzzle a title. | 1 |
| Check | The referee runs both rules and searches for any other rule that fits the same examples. Code only, no model. | 0 |
| Break | Each model sees the other's title, the three example pairs and the test input. It answers with the output grid and a one-line guess at the rule. | 1 |
| Reveal | The referee compares each answer cell by cell with the true output, then scores. | 0 |

| Exchange | Move budget | Notes |
| --- | --- | --- |
| 1 | 2 | Warm-up. Fresh pool. |
| 2 | 3 | Harder. Fresh pool. |
| Sudden death | 4 | Only if the round is tied after exchange 2. Fresh pool. |

## The toolbox

A rule is a chain of 1 to `budget` moves from this list. Both models get the full list and its
definitions in every prompt, so the space of possible rules is public. The exact behaviour is the
code in [`src/games/forge/moves.ts`](../../src/games/forge/moves.ts), covered by
[`moves.test.ts`](../../src/games/forge/moves.test.ts).

An **object** is a group of same-colored cells joined edge to edge. Colors are 1 to 9, and 0 is
empty.

| Move | Arguments | What it does |
| --- | --- | --- |
| `rotate` | turns 1 to 3 | Turn the grid 90° clockwise, that many times |
| `mirror` | left-right, top-bottom, diagonal | Flip the grid. Diagonal needs a square grid |
| `shift` | up, down, left, right | Move every cell one step, wrapping around the edge |
| `gravity` | up, down, left, right | Colored cells slide to that edge until blocked, keeping their order |
| `extend` | up, down, left, right | Every colored cell shoots a line of its color until it hits a colored cell or the edge |
| `recolor` | from, to | One color becomes another. `to` 0 erases it |
| `swap` | a, b | Two colors trade places |
| `paint` | largest or smallest, color | That object turns this color. Ties: all of them |
| `keep` | largest or smallest | Only that object stays. Ties: all of them |
| `outline` | color | Every empty cell touching an object edge to edge gets this color |
| `fill` | color | Every empty area sealed off from the border gets this color |
| `crop` | none | Cut to the smallest box holding every colored cell |
| `scale` | none | Every cell becomes 2×2. Not allowed past 30 cells a side |
| `symmetry` | from left, right, top, bottom | Copy one half, mirrored, over the other half |

With the three colors a pool uses, this is 50 distinct moves.

## The pool

- **The pool:** 12 input grids, the same for both corners in an exchange.
- **Grids:** each is 5 to 8 cells a side and holds 2 to 4 objects.
- **Shapes and colors:** objects are dots, bars, blocks, rings with holes and L shapes, in the pool's
  3 colors, with a one-cell gap between objects. Rings exist so `fill` and `outline` have something
  to bite on.
- **Seeding:** the pool comes from a seeded generator in
  [`src/games/forge/pool.ts`](../../src/games/forge/pool.ts). The fight's seed is committed (a
  SHA-256 hash is published) before the fight and revealed after, so anyone can regenerate the
  exact pool.

## The referee check

A forged puzzle goes through four checks, in this order:

1. **Budget:** the rule has 1 to `budget` moves.
2. **Applies:** every move works on every grid used. A diagonal mirror on a non-square grid fails.
3. **Something happens:** the test output differs from the test input.
4. **One answer:** this is the real test. The referee searches **every** chain of toolbox moves up
   to `budget` that reproduces all three example outputs. If any of them gives a different test
   output, the examples don't force the answer and the puzzle is **void**.

Check 4 is a breadth-first search over the tuple *(example A, example B, example C, test)*.
Two chains that reach the same four grids are expanded only once. Move arguments are limited to
colors that appear in the puzzle. Code:
[`src/games/forge/solver.ts`](../../src/games/forge/solver.ts).

**Measured cost** (Node 22, this Mac, seeded pools with 3 colors):

| Budget | Rules checked | Time |
| --- | --- | --- |
| 2 | about 2,400 | 17 to 49 ms |
| 3 | 61,000 to 74,000 | 0.46 to 0.56 s |
| 4 | about 1.4 million | 7.7 s, 103 MB heap |

In those timing runs, 3 of the 6 budget-3 puzzles built from the first pool grids were void, and
1 of the 6 budget-2 puzzles was. Picking examples that pin the rule down is part of the skill.

## Judging

Everything is judged by code. No model judges another.

| Event | Points |
| --- | --- |
| Break the opponent's trap (every cell matches, no partial credit) | **+3** to the breaker |
| Your trap holds (valid, and the opponent's answer is wrong) | **+1** to the maker |
| Your trap is void (fails any referee check) | **0** to the maker, **+3** to the opponent, who skips the break |
| No answer, a malformed answer, or a timeout | Counts as a wrong answer |

- **Why break is worth more than trap:** a model wins by reasoning, not by trickery alone.
- **The round:** add up the points from both exchanges, and more points wins. A tie goes to sudden
  death at budget 4. If it's still tied, the round is shared.
- **The fight:** five rounds, with 1 point per round won and ½ per shared round. If the fight ends
  level, the champion keeps the title.

## Fairness

- **Same everything:** both corners get the same pool, toolbox, budget, prompt template and time
  limit, and they play at the same time.
- **Hidden until the break:** neither sees the other's puzzle, thinking or guess until it's their
  turn to break, and opponents' thoughts are never put in a prompt.
- **Same tier and effort:** both corners use one shared setting, enforced by the arena.
- **Replayable:** seeds are committed in advance, and the referee, solver and scoring are all
  public code.
- **Format slips:** a reply that doesn't match the JSON schema gets one retry with the schema
  error. A second failure counts as no answer.

## What the models see

Grids are rows of digits joined by `/`, the format every model already reads from ARC.

**Forge prompt:** the rules of the round, the toolbox table, the budget, the 12 pool grids
numbered 0 to 11, and the scoring. The reply must match this shape:

```json
{
  "title": "Things fall",
  "program": [
    { "op": "gravity", "dir": "down" },
    { "op": "mirror", "axis": "left-right" }
  ],
  "examples": [0, 1, 3],
  "test": 8
}
```

**Break prompt:** the rules, the toolbox, the budget, the opponent's title (marked "may be a
bluff"), examples A to C as input → output, and the test input. The reply must match this shape:

```json
{
  "answer": "00000/00000/00000/50000/66600",
  "guess": "Cells fall, then the grid flips left to right."
}
```

**Time limit:** proposed at 10 minutes of wall clock per call.

## Showing the thinking

**What we can get:** both labs expose reasoning **summaries**, not raw thoughts.

| CLI | How | What we saw (2026-10-18) |
| --- | --- | --- |
| Claude Code 2.1.299 | `-p --output-format stream-json --verbose`, which streams assistant events with thinking blocks | Not checked yet: the CLI's sign-in has expired. Run `claude auth login`, then re-run the probe |
| Codex 0.163 | `exec --json -c model_reasoning_summary="detailed"`, which emits `item.completed` events of type `reasoning` | `gpt-6-luna` at high effort on a tiny puzzle gave two bold headings: "Inferring grid mapping", "Inferring grid rotation" |

**How we show it:**

- **Thought ticker:** each corner gets a feed of summary lines, timestamped from the start of the
  call, shown exactly as the lab returned them. They are never rewritten or shortened, apart from
  trimming over-long lines for the video.
- **Structured lines in every reply:** labs differ in how much they summarise (Codex can be just
  headings). So every reply also carries short fields both models must fill under the same limits:
  the maker's `title` and the breaker's `guess`. The reveal always has like-for-like text from
  both sides.
- **Dramatic irony:** viewers see the maker's hidden rule and thinking during the Forge phase, but
  the opponent never does.
- **Labelling:** every thinking panel says "Reasoning summary from Anthropic" or "…from OpenAI".
  Demo panels say they are written by hand.
- **Stored with the replay:** thinking is saved in the replay file with timestamps, so the video
  and the app play it back in sync with the phases.

## Screens

The live app shows these on the **Games** page, built from real engine output for seed 2026:

1. **Title:** Reasoning · Forge · "Build a trap. Break theirs." Tags for ARC-AGI-2, the budgets and
   "scored by code".
2. **The pool:** the 12 shared grids, numbered.
3. **Forge:** each corner's rule as move chips, its picks (A, B, C, test) and its bluff title,
   with its thought ticker. Viewers see the rule, labelled "hidden from GPT" / "hidden from Claude".
4. **Referee check:** "2,400 rules checked · 1 answer · Valid" for each trap, or "2 answers · Void".
5. **Break:** the puzzles cross the center line. Each breaker sees the title, the three pairs and
   the test input, and its answer paints in cell by cell.
6. **Reveal:** answer against truth, with wrong cells marked. The guess sits next to the real rule,
   then "Broken +3" or "Trap holds +1".
7. **Score:** the exchange tally, then what comes next (budget 3, and sudden death at 4 if tied).

## Cost per round

| | Calls per model |
| --- | --- |
| Two exchanges | 4: forge and break, twice |
| With sudden death | 6 |

A void trap skips the opponent's break call, so a round can cost less.

## Open questions

- **Ties for objects:** `paint` and `keep` treat a tie as "all of them". That's a fair trap, but is
  it too subtle for viewers?
- **Pool colors:** 3 per exchange keeps the solver fast. 4 would add about 30 more moves per level.
- **Time limit:** 10 minutes per call has not been tested at Ultra effort.
- **Title text:** the bluff title is free text, at most 5 words. Do we filter it for anything?

## Playing it live

Start on the arena plays a real round. The Vite dev server hosts the referee
([`server/`](../../server)): `POST /api/forge` streams the fight as server-sent events, and
`GET /api/status` says whether both CLIs are signed in. It only answers requests from this machine
and from the page's own origin.

- **The calls:** each call starts a fresh CLI process in an empty temporary folder. Claude Code
  runs with no tools. Codex runs read-only, and any tool call it makes is reported as a rules
  violation.
- **Effort:** Ultra maps to `--effort max` for Claude Code and `model_reasoning_effort="xhigh"`
  for Codex, each lab's top setting.
- **Replies:** a reply that can't be parsed gets one retry. A call that takes more than 10
  minutes counts as no answer.
- **First real call (2026-10-18):** GPT-6 Luna at xhigh forged
  `rotate(1) → fill(4)` with the title "Falling Squares" in 85 s. It streamed 16 reasoning
  updates, used no tools, and the referee checked 3,648 rules and found the trap valid.
