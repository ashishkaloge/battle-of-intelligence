import { BENCHMARKS } from '../content/benchmarks.ts'
import { Badge, Status } from '../ui/index.ts'

export function Benchmarks() {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the reading pane scrolls independently and must be keyboard reachable
    <main className="page" tabIndex={0} aria-label="Benchmarks">
      <div className="page__inner">
        <header className="page__head">
          <p className="eyebrow">Benchmarks</p>
          <h1 className="page__title">What every fight tests</h1>
          <p className="page__lede">
            Five original games, each inspired by a skill measured in public AI benchmarks. These
            fights use their own rules and scoring. Results are not official benchmark scores or a
            substitute for those evaluations.
          </p>
        </header>

        <ol className="benchmarks" aria-label="Benchmarks">
          {BENCHMARKS.map((benchmark, index) => (
            <li key={benchmark.skill} className="benchmark">
              <span className="benchmark__num" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <h2 className="benchmark__skill">{benchmark.skill}</h2>
                <p className="benchmark__tests">{benchmark.tests}</p>
              </div>
              <div className="benchmark__names">
                {benchmark.names.map((name) => (
                  <Badge key={name}>{name}</Badge>
                ))}
              </div>
              <Status state="ready" label={benchmark.game} />
            </li>
          ))}
        </ol>
      </div>
    </main>
  )
}
