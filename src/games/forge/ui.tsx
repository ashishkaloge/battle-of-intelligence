import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  Crop,
  Crown,
  Droplet,
  FlipHorizontal2,
  type LucideIcon,
  Maximize2,
  Move as MoveIcon,
  MoveRight,
  PaintBucket,
  Paintbrush,
  RotateCw,
  SquareDashed,
  SquareSplitHorizontal,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { flag } from '../../lib/cx.ts'
import type { Grid } from './grid.ts'
import { describeMove, type Move, type Op } from './moves.ts'

/** A grid of colored cells. `truth` marks wrong cells; `paint` animates the cells in. */
export function GridView({
  grid,
  cell = 10,
  truth,
  paint = false,
  label,
}: {
  grid: Grid
  cell?: number
  truth?: Grid | undefined
  paint?: boolean
  label?: string
}) {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  const sizeMismatch = truth !== undefined && (truth.length !== rows || truth[0]?.length !== cols)
  return (
    <figure
      className="gv"
      data-paint={flag(paint)}
      data-wrong={flag(sizeMismatch)}
      style={{ '--rows': rows, '--cols': cols, '--cell': `${cell}px` } as CSSProperties}
    >
      <figcaption className="sr-only">{label ?? `${rows} by ${cols} grid`}</figcaption>
      {grid.flatMap((row, y) =>
        row.map((value, x) => {
          const wrong = truth !== undefined && !sizeMismatch && truth[y]?.[x] !== value
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: cells never reorder, so position is a stable key
              key={`${y}.${x}`}
              className="gv__cell"
              data-c={value}
              data-wrong={flag(wrong)}
              style={paint ? ({ '--i': y * cols + x } as CSSProperties) : undefined}
              aria-hidden="true"
            />
          )
        }),
      )}
    </figure>
  )
}

/** An example: input, arrow, output, with a letter. */
export function Pair({
  letter,
  input,
  output,
  cell = 7,
}: {
  letter: string
  input: Grid
  output: Grid
  cell?: number
}) {
  return (
    <div className="pair">
      <span className="pair__letter">{letter}</span>
      <GridView grid={input} cell={cell} label={`Example ${letter} input`} />
      <ArrowRight className="pair__arrow" aria-hidden="true" size={14} strokeWidth={1.75} />
      <GridView grid={output} cell={cell} label={`Example ${letter} output`} />
    </div>
  )
}

const MOVE_ICON: Record<Op, LucideIcon> = {
  rotate: RotateCw,
  mirror: FlipHorizontal2,
  shift: MoveIcon,
  gravity: ArrowDownToLine,
  extend: MoveRight,
  recolor: Paintbrush,
  swap: ArrowLeftRight,
  paint: PaintBucket,
  keep: Crown,
  outline: SquareDashed,
  fill: Droplet,
  crop: Crop,
  scale: Maximize2,
  symmetry: SquareSplitHorizontal,
}

const colorOf = (move: Move) =>
  'color' in move ? move.color : move.op === 'recolor' && move.to !== 0 ? move.to : undefined

/** One toolbox move as a chip, with a swatch for its color. */
export function MoveChip({ move }: { move: Move }) {
  const Glyph = MOVE_ICON[move.op]
  const color = colorOf(move)
  return (
    <span className="chip">
      <Glyph aria-hidden="true" size={13} strokeWidth={1.75} />
      {describeMove(move)}
      {color !== undefined && <span className="chip__swatch" data-c={color} aria-hidden="true" />}
    </span>
  )
}

export function RuleChips({ program }: { program: readonly Move[] }) {
  return (
    <ol className="rule-chips" aria-label="Rule">
      {program.map((move, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a rule can repeat a move and never reorders, so position is part of the key
        <li key={`${index}.${move.op}`} className="rule-chips__step">
          {index > 0 && (
            <ArrowRight
              className="rule-chips__then"
              aria-hidden="true"
              size={12}
              strokeWidth={1.75}
            />
          )}
          <MoveChip move={move} />
        </li>
      ))}
    </ol>
  )
}
