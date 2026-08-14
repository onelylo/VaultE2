import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 flex items-center justify-center p-4"
          style={{ backgroundColor: 'var(--bg-app, #0f0f14)', color: 'var(--text-main, #e2e8f0)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6 text-center"
            style={{ backgroundColor: 'var(--bg-surface, #1a1a24)', border: '1px solid var(--border-color, #2a2a3a)' }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <svg className="w-8 h-8" style={{ color: '#ef4444' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold mb-2">Something went wrong</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted, #94a3b8)' }}>
              An unexpected error occurred. Please reload the page.
            </p>
            <button
              onClick={this.handleReload}
              className="px-6 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
              style={{ backgroundColor: 'var(--accent-primary, #6366f1)', color: 'var(--accent-text, #fff)' }}>
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
