import { Play } from 'lucide-react'
import { useMemo } from 'react'
import { lineupFor, missing, recordedEffort, totals } from '../show/lineup.ts'
import { Button, Select } from '../ui/index.ts'
import { CornerCard, CornerStats } from './Corner.tsx'
import { CORNERS, EFFORT_OPTIONS, type FightSettings, ROUNDS, TIER_OPTIONS } from './corners.ts'

/**
 * Claude | GPT across the top, the battleground in the middle, the fight's totals along the
 * bottom. Tier and power are shared settings for both corners. Start plays only recordings
 * matching both selected models and their power settings across all five rounds.
 */
export function Arena({
  settings,
  onSettings,
  onStart,
}: {
  settings: FightSettings
  onSettings: (patch: Partial<FightSettings>) => void
  onStart: () => void
}) {
  const { claude, gpt } = CORNERS
  const lineup = useMemo(() => lineupFor(settings), [settings])
  const gaps = missing(lineup)
  const ready = gaps.length === 0
  const { calls } = totals(lineup)
  const label = ready ? 'Ready' : `${ROUNDS - gaps.length} of ${ROUNDS} recorded`

  return (
    <main className="arena">
      <h1 className="sr-only">
        {`${claude.models[settings.tier].name} vs ${gpt.models[settings.tier].name}`}
      </h1>

      <CornerCard
        corner={claude}
        side="left"
        tier={settings.tier}
        status={ready ? 'ready' : 'error'}
        statusLabel={label}
      />
      <span className="arena__rule" aria-hidden="true" />
      <CornerCard
        corner={gpt}
        side="right"
        tier={settings.tier}
        status={ready ? 'ready' : 'error'}
        statusLabel={label}
      />

      <section className="battleground" data-view="idle" aria-label="Battleground">
        <span className="battleground__frame" aria-hidden="true" />
        <div className="battleground__settings">
          <span className="battleground__fixed">Tier</span>
          <Select
            label="Tier for both corners"
            value={settings.tier}
            options={TIER_OPTIONS}
            onChange={(tier) => onSettings({ tier, broadcast: undefined })}
          />
          <span className="battleground__dot" aria-hidden="true" />
          <span className="battleground__fixed">Power</span>
          <Select
            label="Power for both corners"
            value={settings.effort}
            options={EFFORT_OPTIONS}
            onChange={(effort) => onSettings({ effort, broadcast: undefined })}
          />
          <span className="battleground__dot" aria-hidden="true" />
          <span className="battleground__fixed">{`${ROUNDS} rounds`}</span>
        </div>
        <h2 className="battleground__title">Battleground</h2>
        <div className="battleground__actions">
          <Button
            className="battleground__start"
            size="lg"
            tone="strong"
            outline
            icon={Play}
            disabled={!ready}
            onClick={onStart}
          >
            Start
          </Button>
        </div>
        <p className={`battleground__note${ready ? '' : ' battleground__note--warn'}`}>
          {ready
            ? `Replays all five recorded rounds. ${recordedEffort(lineup)}`
            : `Not recorded for the selected models and power: ${gaps.map((r) => r.name).join(', ')}.`}
        </p>
      </section>

      <CornerStats corner={claude} side="left" calls={calls.claude} />
      <span className="arena__rule" aria-hidden="true" />
      <CornerStats corner={gpt} side="right" calls={calls.gpt} />
    </main>
  )
}
