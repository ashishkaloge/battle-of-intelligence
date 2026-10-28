import type { Mood } from './ring/choreo.ts'

export type { Mood }

/**
 * A fighter's face. It carries a boxer's resting glare, lowers its brows hard when locked in,
 * bares a snarl the instant it throws a shove, scrunches on a hit, and crosses out — dazed — when
 * knocked down. That glare is most of what makes a viewer pick a side.
 */
export function Face({ mood, look }: { mood: Mood; look: { x: number; y: number } }) {
  const length = Math.hypot(look.x, look.y) || 1
  const gaze =
    mood === 'think'
      ? { x: 2.5, y: -3.5 }
      : { x: (look.x / length) * 3.4, y: (look.y / length) * 2.4 }
  const xEyes = mood === 'down' || mood === 'ko'
  // Brows are always on for a resting glare; they steepen as the fighter means more harm.
  const brows =
    mood === 'scowl'
      ? ['M-28 -24 L-7 -13', 'M28 -24 L7 -13']
      : mood === 'locked'
        ? ['M-26 -23 L-8 -17', 'M26 -23 L8 -17']
        : mood === 'idle'
          ? ['M-25 -24 L-9 -21', 'M25 -24 L9 -21']
          : null
  return (
    <svg className="face" data-mood={mood} viewBox="-50 -50 100 100" aria-hidden="true">
      <circle className="face__skin" r="46" />
      <ellipse className="face__shine" cx="-14" cy="-24" rx="16" ry="9" />
      {xEyes ? (
        <g className="face__x">
          <path d="M-22 -14 L-10 -2 M-10 -14 L-22 -2" />
          <path d="M10 -14 L22 -2 M22 -14 L10 -2" />
        </g>
      ) : mood === 'hit' ? (
        <g className="face__x">
          <path d="M-22 -14 L-11 -8 L-22 -2" />
          <path d="M22 -14 L11 -8 L22 -2" />
        </g>
      ) : mood === 'happy' ? (
        <g className="face__x">
          <path d="M-23 -5 Q-16 -15 -9 -5" />
          <path d="M9 -5 Q16 -15 23 -5" />
        </g>
      ) : (
        <g className="face__eyes">
          {[-16, 16].map((cx) => (
            <g key={cx}>
              <ellipse className="face__white" cx={cx} cy="-8" rx="9" ry="10.5" />
              <circle className="face__pupil" cx={cx + gaze.x} cy={-8 + gaze.y} r="4.6" />
            </g>
          ))}
          {(mood === 'think' || mood === 'locked') && (
            <g className="face__lids">
              <path d="M-27 -19 L-5 -19 L-5 -10 Q-16 -14 -27 -10 Z" />
              <path d="M5 -19 L27 -19 L27 -10 Q16 -14 5 -10 Z" />
            </g>
          )}
          {brows && (
            <g className="face__x">
              <path d={brows[0]} />
              <path d={brows[1]} />
            </g>
          )}
        </g>
      )}
      <path
        className="face__mouth"
        d={
          mood === 'happy'
            ? 'M-14 12 Q0 26 14 12'
            : mood === 'hit' || mood === 'ko'
              ? 'M-6 17 Q0 9 6 17 Q0 23 -6 17'
              : mood === 'down'
                ? 'M-12 18 Q-6 13 0 18 Q6 23 12 18'
                : mood === 'scowl'
                  ? 'M-13 15 L-7 20 L0 15 L7 20 L13 15'
                  : mood === 'think'
                    ? 'M-5 17 L7 15'
                    : mood === 'locked'
                      ? 'M-9 16 L9 16'
                      : 'M-10 16 Q0 12 10 16'
        }
      />
    </svg>
  )
}
