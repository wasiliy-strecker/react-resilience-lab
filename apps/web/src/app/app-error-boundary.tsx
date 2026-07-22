import { Component, type ErrorInfo, type ReactNode } from 'react'
import { QueryErrorResetBoundary } from '@tanstack/react-query'

interface ErrorBoundaryProps {
  children: ReactNode
  onReset: () => void
}

interface ErrorBoundaryState {
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // The boundary is the final local recovery point. Production telemetry can
    // attach here without coupling the component tree to a logging vendor.
  }

  override render(): ReactNode {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <main
        className="app-failure"
        role="alert"
        aria-labelledby="app-failure-title"
      >
        <p className="eyebrow">Recovery boundary</p>
        <h1 id="app-failure-title">The console stopped unexpectedly</h1>
        <p>
          Cached data and queued commands are kept. Reset the view to try the
          render again.
        </p>
        <button autoFocus onClick={this.#reset} type="button">
          Reset console
        </button>
      </main>
    )
  }

  readonly #reset = (): void => {
    this.props.onReset()
    this.setState({ error: null })
  }
}

export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => <ErrorBoundary onReset={reset}>{children}</ErrorBoundary>}
    </QueryErrorResetBoundary>
  )
}
