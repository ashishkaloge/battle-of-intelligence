import type { CSSProperties, RefObject } from 'react'
import { flag } from '../../lib/cx.ts'
import { Face, type Mood } from '../Face.tsx'
import { FIGHTERS, type Fighter } from '../ring/arena.ts'
import { DELTA, type MapSpec } from './cycles.ts'
import { type Frames, recentSay } from './frames.ts'

/**
 * The Bot Brawl floor, seen from the stands like the Ring: a tilted grid, pillars, glowing trails,
 * and each cycle's rider standing up off its head. It draws one tick of one match; the player
 * decides which tick.
 */
export function Floor({
  map,
  frames,
  tick,
  moods,
  shakeRef,
}: {
  map: MapSpec
  frames: Frames | null
  tick: number
  moods: Record<Fighter, Mood>
  shakeRef: RefObject<HTMLDivElement | null>
}) {
  const { width: w, height: h } = map
  const closed = frames?.closed[tick] ?? 0
  const pct = (x: number, y: number) => ({ left: `${(x / w) * 100}%`, top: `${(y / h) * 100}%` })

  return (
    <div className="brawl__shake" ref={shakeRef}>
      <div className="brawl__floor" style={{ '--cols': w, '--rows': h } as CSSProperties}>
        <svg className="brawl__svg" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <defs>
            <pattern id="brawl-grid" width="1" height="1" patternUnits="userSpaceOnUse">
              <path d="M 1 0 L 0 0 0 1" className="brawl__gridline" />
            </pattern>
          </defs>
          <rect width={w} height={h} fill="url(#brawl-grid)" />
          {Array.from({ length: closed }, (_, ring) => (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: rings close in order and never reopen
              key={ring}
              className="brawl__ring"
              fillRule="evenodd"
              d={`M${ring} ${ring}h${w - 2 * ring}v${h - 2 * ring}h${-(w - 2 * ring)}Z M${ring + 1} ${ring + 1}v${h - 2 * ring - 2}h${w - 2 * ring - 2}v${-(h - 2 * ring - 2)}Z`}
            />
          ))}
          {map.walls.map((wall) => (
            <rect
              key={`${wall.x},${wall.y}`}
              className="brawl__wall"
              x={wall.x + 0.08}
              y={wall.y + 0.08}
              width={0.84}
              height={0.84}
              rx={0.16}
            />
          ))}
          {frames &&
            FIGHTERS.map((fighter) => {
              const cells = frames.paths[fighter].slice(0, frames.shown[fighter][tick] ?? 1)
              const points = cells.map((c) => `${c.x + 0.5},${c.y + 0.5}`).join(' ')
              return (
                <g key={fighter} className="brawl__trail" data-fighter={fighter}>
                  <polyline className="brawl__glow" points={points} />
                  <polyline className="brawl__line" points={points} />
                </g>
              )
            })}
          {frames &&
            FIGHTERS.map((fighter) => {
              const crash = frames.crashes[fighter]
              if (!crash || crash.tick > tick) return null
              return (
                <g
                  key={`crash-${fighter}`}
                  className="brawl__burst"
                  data-fighter={fighter}
                  data-bug={flag(crash.cause === 'bug')}
                  transform={`translate(${crash.at.x + 0.5} ${crash.at.y + 0.5})`}
                >
                  <circle r="0.9" />
                  {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
                    <line
                      key={angle}
                      x1="0"
                      y1="-0.7"
                      x2="0"
                      y2="-1.6"
                      transform={`rotate(${angle})`}
                    />
                  ))}
                </g>
              )
            })}
        </svg>

        {frames &&
          FIGHTERS.map((fighter) => {
            const cells = frames.paths[fighter]
            const head = cells[(frames.shown[fighter][tick] ?? 1) - 1] ?? cells[0]
            if (!head) return null
            const dir = frames.facing[fighter][tick] ?? 'right'
            const [lx, ly] = DELTA[dir]
            const say = recentSay(frames, fighter, tick)
            return (
              <div
                key={fighter}
                className="brawl__rider"
                data-fighter={fighter}
                data-boost={flag(frames.boosted[fighter][tick])}
                style={pct(head.x + 0.5, head.y + 0.5)}
              >
                <div className="brawl__body">
                  <Face mood={moods[fighter]} look={{ x: lx, y: ly }} />
                </div>
                {say && (
                  <span className="brawl__say" key={say.at}>
                    {say.text}
                  </span>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}
