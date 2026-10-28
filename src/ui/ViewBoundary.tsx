import { Component, type ReactNode } from 'react'
import { Button } from './Button.tsx'

/** A failed view or download leaves navigation available and offers an explicit retry. */
export class ViewBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch() {
    this.props.onError()
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="replay-error" role="alert">
        <h1>This view could not load</h1>
        <p>Reload to try again, or choose another section.</p>
        <Button outline onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </main>
    )
  }
}
