import {
  Brain,
  Flag,
  Hash,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Search,
  Settings2,
  Share2,
  Swords,
  Trophy,
} from 'lucide-react'
import { type CSSProperties, type ReactNode, useState } from 'react'
import {
  type CornerKey,
  EFFORT_OPTIONS,
  type Effort,
  TIER_OPTIONS,
  type Tier,
} from '../arena/corners.ts'
import {
  Badge,
  Button,
  IconButton,
  Kbd,
  Segmented,
  Select,
  type SelectOption,
  Stat,
  Status,
  Switch,
  TextField,
} from '../ui/index.ts'

type Lab = CornerKey | 'gemini' | 'grok'

type Speed = '0.5' | '1' | '2'

const SPEED_OPTIONS: readonly SelectOption<Speed>[] = [
  { value: '0.5', label: '0.5× speed' },
  { value: '1', label: '1× speed' },
  { value: '2', label: '2× speed' },
]

const LAB_OPTIONS: readonly SelectOption<Lab>[] = [
  { value: 'claude', label: 'Claude', description: 'Anthropic' },
  { value: 'gpt', label: 'GPT', description: 'OpenAI' },
  { value: 'gemini', label: 'Gemini', description: 'Coming later', disabled: true },
  { value: 'grok', label: 'Grok', description: 'Coming later', disabled: true },
]

/** A living reference of every ghost primitive, with working state. */
export function Primitives() {
  const [tier, setTier] = useState<Tier>('frontier')
  const [effort, setEffort] = useState<Effort>('ultra')
  const [speed, setSpeed] = useState<Speed>('1')
  const [lab, setLab] = useState<Lab>('claude')
  const [section, setSection] = useState<'arena' | 'replays' | 'ladder'>('arena')
  const [layout, setLayout] = useState<'duel' | 'four'>('duel')
  const [reasoning, setReasoning] = useState(true)
  const [sound, setSound] = useState(false)

  return (
    <main className="page">
      <div className="page__inner">
        <header className="page__head">
          <p className="eyebrow">Design system</p>
          <h1 className="page__title">Ghost primitives</h1>
          <p className="page__lede">
            Transparent at rest, a soft wash on hover, a hairline when focused. Color shows up only
            where it carries meaning: a fighter's corner, a live state, a result.
          </p>
        </header>

        <div className="specimens">
          <Specimen name="Button" tag="<Button>">
            <Row>
              <Button>Cancel</Button>
              <Button tone="strong" icon={Play}>
                Start
              </Button>
              <Button tone="strong" outline icon={Swords}>
                Start fight
              </Button>
            </Row>
            <Row>
              <Button tone="accent" icon={Trophy}>
                Rematch
              </Button>
              <Button tone="danger" icon={Flag}>
                Forfeit
              </Button>
              <Button disabled>Disabled</Button>
            </Row>
            <Row>
              <Button size="sm" outline>
                Small
              </Button>
              <Button outline>Medium</Button>
              <Button size="lg" outline>
                Large
              </Button>
            </Row>
          </Specimen>

          <Specimen name="Icon button" tag="<IconButton>" note="Hover or focus for the tooltip.">
            <Row>
              <IconButton icon={Play} label="Play" />
              <IconButton icon={Pause} label="Pause" />
              <IconButton icon={RotateCcw} label="Reset" />
              <IconButton icon={Share2} label="Share" />
              <IconButton icon={Settings2} label="Settings" outline />
            </Row>
            <Row>
              <Tint side="claude">
                <IconButton icon={Brain} label="Claude's reasoning" tone="side" outline />
              </Tint>
              <Tint side="gpt">
                <IconButton icon={Brain} label="GPT's reasoning" tone="side" outline />
              </Tint>
              <IconButton icon={Settings2} label="Settings" size="sm" />
            </Row>
          </Specimen>

          <Specimen
            name="Dropdown"
            tag="<Select>"
            note="Arrows, Home and End move. Enter picks. Esc closes."
          >
            <Row>
              <Select label="Tier" value={tier} options={TIER_OPTIONS} onChange={setTier} />
              <Select label="Effort" value={effort} options={EFFORT_OPTIONS} onChange={setEffort} />
              <Select
                label="Replay speed"
                icon={Layers}
                outline
                value={speed}
                options={SPEED_OPTIONS}
                onChange={setSpeed}
              />
              <Select label="Lab" value={lab} options={LAB_OPTIONS} onChange={setLab} />
            </Row>
            <Row>
              <Tint side="claude">
                <Select
                  className="gallery__xl"
                  size="xl"
                  label="Headline model"
                  value={tier}
                  options={TIER_OPTIONS}
                  onChange={setTier}
                />
              </Tint>
            </Row>
          </Specimen>

          <Specimen name="Segmented" tag="<Segmented>">
            <Row>
              <Segmented
                label="Section"
                value={section}
                onChange={setSection}
                options={[
                  { value: 'arena', label: 'Arena' },
                  { value: 'replays', label: 'Replays' },
                  { value: 'ladder', label: 'Ladder' },
                ]}
              />
            </Row>
            <Row>
              <Segmented
                label="Layout"
                outline
                value={layout}
                onChange={setLayout}
                options={[
                  { value: 'duel', label: '2 fighters' },
                  { value: 'four', label: '4 fighters' },
                ]}
              />
            </Row>
          </Specimen>

          <Specimen name="Switch" tag="<Switch>">
            <Row>
              <Switch label="Show reasoning" checked={reasoning} onChange={setReasoning} />
              <Switch label="Sound" checked={sound} onChange={setSound} />
              <Switch label="Spectators" checked={false} onChange={() => {}} disabled />
            </Row>
          </Specimen>

          <Specimen name="Text field" tag="<TextField>">
            <Row>
              <TextField
                label="Search fights"
                placeholder="Search fights"
                icon={Search}
                trailing={<Kbd>⌘K</Kbd>}
              />
              <TextField label="Seed" placeholder="Seed" icon={Hash} outline />
            </Row>
          </Specimen>

          <Specimen name="Badge" tag="<Badge>">
            <Row>
              <Badge>Claude Code</Badge>
              <Badge>Codex</Badge>
              <Tint side="claude">
                <Badge tone="side">Max effort</Badge>
              </Tint>
              <Tint side="gpt">
                <Badge tone="side" icon={Brain}>
                  Max effort
                </Badge>
              </Tint>
            </Row>
          </Specimen>

          <Specimen name="Status" tag="<Status>">
            <Row>
              <Status state="ready" />
              <Tint side="claude">
                <Status state="thinking" />
              </Tint>
              <Tint side="gpt">
                <Status state="thinking" />
              </Tint>
              <Status state="done" label="Won" />
              <Status state="error" label="Timed out" />
            </Row>
          </Specimen>

          <Specimen name="Stat" tag="<Stat>">
            <Row wide>
              <Stat label="Score" value="12" />
              <Stat label="Moves" value="31" />
              <Stat label="Think" value="48.2s" />
            </Row>
          </Specimen>

          <Specimen name="Keys" tag="<Kbd>">
            <Row>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
              <Kbd>Space</Kbd>
              <Kbd>Esc</Kbd>
            </Row>
          </Specimen>
        </div>
      </div>
    </main>
  )
}

function Specimen({
  name,
  tag,
  note,
  children,
}: {
  name: string
  tag: string
  note?: string
  children: ReactNode
}) {
  return (
    <section className="specimen" aria-label={name}>
      <div className="specimen__head">
        <h2 className="specimen__name">{name}</h2>
        <code className="specimen__tag">{tag}</code>
      </div>
      {note && <p className="specimen__note">{note}</p>}
      {children}
    </section>
  )
}

function Row({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <div className="specimen__demo" data-wide={wide ? '' : undefined}>
      {children}
    </div>
  )
}

/** Scopes `--side` so side-toned primitives pick up a fighter's color. */
function Tint({ side, children }: { side: CornerKey; children: ReactNode }) {
  return (
    <span className="tint" style={{ '--side': `var(--${side})` } as CSSProperties}>
      {children}
    </span>
  )
}
