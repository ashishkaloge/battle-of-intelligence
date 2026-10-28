import { AGREED_RULES, PROPOSED_RULES, type Rule } from '../content/rules.ts'
import { Badge } from '../ui/index.ts'

export function Rules() {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the reading pane scrolls independently and must be keyboard reachable
    <main className="page" tabIndex={0} aria-label="Rules">
      <div className="page__inner">
        <header className="page__head">
          <p className="eyebrow">Rules</p>
          <h1 className="page__title">How a fight works</h1>
          <p className="page__lede">
            A draft we lock one rule at a time. Agreed rules hold today. Proposed ones need a yes
            before they count.
          </p>
        </header>

        <RuleGroup title="Agreed" tone="positive" rules={AGREED_RULES} />
        <RuleGroup title="Proposed" tone="neutral" rules={PROPOSED_RULES} />
      </div>
    </main>
  )
}

function RuleGroup({
  title,
  tone,
  rules,
}: {
  title: string
  tone: 'positive' | 'neutral'
  rules: readonly Rule[]
}) {
  return (
    <section className="group" aria-label={`${title} rules`}>
      <div className="group__head">
        <h2 className="group__title">{title}</h2>
        <Badge tone={tone}>{`${rules.length} rules`}</Badge>
      </div>
      <ol className="rules">
        {rules.map((rule, index) => (
          <li key={rule.title} className="rule">
            <span className="rule__num" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <h3 className="rule__title">{rule.title}</h3>
            <p className="rule__body">{rule.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
