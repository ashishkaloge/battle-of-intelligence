import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsRight,
  Coins,
  Lock,
  type LucideIcon,
  Shield,
  Zap,
} from 'lucide-react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { flag } from '../../lib/cx.ts'
import { Face } from '../Face.tsx'
import {
  FIGHTERS,
  type Fighter,
  leftCorner,
  type Move,
  other,
  posOf,
  type RingState,
  type Step,
  samePos,
} from './arena.ts'
import type { Mood } from './choreo.ts'

export const MOVE_ICON: Record<Move, LucideIcon> = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
  wait: Shield,
}

export const MOVE_LABEL: Record<Move, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  wait: 'Hold',
}

const BELT_TURN: Record<Step, string> = {
  right: '0deg',
  down: '90deg',
  left: '180deg',
  up: '270deg',
}

/** Three paint splats; each cell picks one and a rotation from its index so the floor looks hand-made. */
const SPLATS = [
  'M52 9c13-2 18 10 27 14 11 5 15 16 9 26-4 7 3 15-2 24-6 10-19 9-28 14-10 6-22 7-30-2-6-7-17-6-20-16-3-9 5-15 3-24-2-10 3-21 13-25 9-4 16-10 28-11Z',
  'M47 7c11-3 20 6 29 7 12 2 18 13 15 24-2 8 6 14 3 24-4 12-17 12-25 19-9 8-23 8-31 0-7-6-18-8-20-19-1-9 6-14 5-23-1-12 6-21 17-25 3-1 5-6 7-7Z',
  'M55 8c10 1 15 11 24 15 10 4 14 15 10 24-3 8 2 17-4 25-7 9-19 6-27 12-9 7-21 9-29 1-6-6-16-7-19-17-2-8 4-15 2-23-2-11 4-21 15-25 10-3 16-13 28-12Z',
]

export type Pop = { id: number; fighter: Fighter; text: string; tone: 'gain' | 'loss' | 'quiet' }
export type Spark = { id: number; x: number; y: number }
export type Badge = { kind: 'lock' } | { kind: 'move'; move: Move }

export type FighterRefs = {
  wrap: RefObject<Record<Fighter, HTMLDivElement | null>>
  shadow: RefObject<Record<Fighter, HTMLDivElement | null>>
  body: RefObject<Record<Fighter, HTMLDivElement | null>>
}

/**
 * The ring floor, seen from ringside: a tilted mat with ropes and corner posts, painted cells,
 * hidden tiles that show themselves once found, and the two fighters standing on it. Positions and
 * effects are driven from outside; this only draws.
 */
export function Board({
  positions,
  floor,
  moods,
  says,
  badges,
  counting,
  pops,
  sparks,
  glide,
  refs,
  shakeRef,
  children,
}: {
  /** Where the fighters stand when no animation is running. */
  positions: RingState
  /** What the floor shows: paint, discovered tiles. Lags `positions` until fighters land. */
  floor: RingState
  moods: Record<Fighter, Mood>
  says: Partial<Record<Fighter, string>>
  badges: Partial<Record<Fighter, Badge>>
  /** Fighters who are down and hearing the count. */
  counting: Partial<Record<Fighter, boolean>>
  pops: Pop[]
  sparks: Spark[]
  /** Slide fighters between cells with a plain transition (used when the bell sends them home). */
  glide: boolean
  refs: FighterRefs
  shakeRef: RefObject<HTMLDivElement | null>
  children?: ReactNode
}) {
  const { arena } = floor
  // The center holder's bounty sits on the center, so viewers can watch the prize grow.
  const holder = floor.rules.centerBounty
    ? FIGHTERS.find(
        (f) => floor.fighters[f].bounty > 0 && samePos(floor.fighters[f].pos, arena.center),
      )
    : undefined
  const cellPct = (x: number, y: number) => ({
    left: `${(x / arena.width) * 100}%`,
    top: `${(y / arena.height) * 100}%`,
  })

  return (
    <div className="ring__shake" ref={shakeRef}>
      <div
        className="ring__board"
        style={
          {
            '--cols': arena.width,
            '--rows': arena.height,
            // Corner posts wear the colour of whoever starts in that corner this bout.
            '--corner-left': `var(--${leftCorner(arena)})`,
            '--corner-right': `var(--${other(leftCorner(arena))})`,
          } as CSSProperties
        }
      >
        <span className="ring__ropes" aria-hidden="true" />
        {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
          <span key={corner} className="ring__post" data-corner={corner} aria-hidden="true" />
        ))}

        {arena.tiles.map((tile, i) => {
          const { x, y } = posOf(arena, i)
          const owner = floor.owner[i]
          const shown = floor.revealed[i]
          const center = x === arena.center.x && y === arena.center.y
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: the tile index is the cell's identity
              key={i}
              className="ring__cell"
              data-kind={shown || tile.kind === 'wall' ? tile.kind : 'empty'}
              data-center={flag(center)}
              style={
                {
                  ...cellPct(x, y),
                  '--belt-turn': tile.kind === 'conveyor' ? BELT_TURN[tile.dir] : undefined,
                } as CSSProperties
              }
            >
              {owner && (
                <svg
                  key={owner}
                  className="ring__paint"
                  data-owner={owner}
                  viewBox="0 0 100 100"
                  style={{ rotate: `${(i * 67) % 360}deg` }}
                  aria-hidden="true"
                >
                  <path d={SPLATS[i % SPLATS.length]} />
                </svg>
              )}
              {center && <span className="ring__mark" aria-hidden="true" />}
              {center && holder && (
                <span className="ring__bounty" data-owner={holder}>
                  <Coins size={11} strokeWidth={2.5} aria-hidden="true" />
                  <span className="num">{floor.fighters[holder].bounty}</span>
                  <span className="sr-only"> bounty on the center</span>
                </span>
              )}
              {shown && tile.kind === 'conveyor' && (
                <span className="ring__belt" aria-hidden="true">
                  <ChevronsRight size={18} strokeWidth={2.25} />
                </span>
              )}
              {shown && tile.kind === 'trap' && (
                <span className="ring__trap" aria-hidden="true">
                  <Zap size={16} strokeWidth={2.4} />
                </span>
              )}
              {tile.kind === 'wall' && <span className="ring__pillar" aria-hidden="true" />}
            </div>
          )
        })}

        {FIGHTERS.map((fighter) => {
          const { x, y } = positions.fighters[fighter].pos
          const at = cellPct(x + 0.5, y + 0.5)
          return (
            <div
              key={fighter}
              className="ring__shadow"
              data-fighter={fighter}
              data-glide={flag(glide)}
              ref={(el) => {
                refs.shadow.current[fighter] = el
              }}
              style={at}
            />
          )
        })}

        {FIGHTERS.map((fighter) => {
          const { x, y } = positions.fighters[fighter].pos
          const foe = positions.fighters[other(fighter)].pos
          const badge = badges[fighter]
          const say = says[fighter]
          return (
            <div
              key={fighter}
              className="ring__fighter"
              data-fighter={fighter}
              data-mood={moods[fighter]}
              data-glide={flag(glide)}
              ref={(el) => {
                refs.wrap.current[fighter] = el
              }}
              style={{ ...cellPct(x + 0.5, y + 0.5), zIndex: 10 + y }}
            >
              <div
                className="ring__body"
                ref={(el) => {
                  refs.body.current[fighter] = el
                }}
              >
                <Face mood={moods[fighter]} look={{ x: foe.x - x, y: foe.y - y }} />
              </div>
              {badge && (
                <span className="ring__badge" key={badge.kind === 'move' ? badge.move : 'lock'}>
                  <BadgeIcon badge={badge} />
                </span>
              )}
              {counting[fighter] && (
                <span className="ring__count" aria-hidden="true">
                  <b>1</b>
                  <b>2</b>
                  <b>3</b>
                </span>
              )}
              {say && (
                <span className="ring__say" key={say}>
                  {say}
                </span>
              )}
              {pops
                .filter((pop) => pop.fighter === fighter)
                .map((pop) => (
                  <span key={pop.id} className="ring__pop" data-tone={pop.tone}>
                    {pop.text}
                  </span>
                ))}
            </div>
          )
        })}

        {sparks.map((spark) => (
          <span
            key={spark.id}
            className="ring__spark"
            style={cellPct(spark.x, spark.y)}
            aria-hidden="true"
          >
            <svg viewBox="-50 -50 100 100" aria-hidden="true">
              {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
                <line key={angle} x1="0" y1="-14" x2="0" y2="-44" transform={`rotate(${angle})`} />
              ))}
            </svg>
          </span>
        ))}
      </div>
      {children}
    </div>
  )
}

function BadgeIcon({ badge }: { badge: Badge }) {
  const Glyph = badge.kind === 'lock' ? Lock : MOVE_ICON[badge.move]
  return (
    <Glyph
      size={14}
      strokeWidth={2.5}
      aria-label={badge.kind === 'lock' ? 'Locked' : MOVE_LABEL[badge.move]}
    />
  )
}
