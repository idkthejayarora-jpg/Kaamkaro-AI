import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message ?? 'Unknown error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught runtime error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0f0f0f',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 24,
            }}
          >
            <span style={{ fontSize: 24 }}>⚠</span>
          </div>
          <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Something went wrong
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, marginBottom: 8, maxWidth: 320 }}>
            An unexpected error occurred. Your data is safe — tap below to reload the app.
          </p>
          {this.state.message && (
            <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, marginBottom: 24, maxWidth: 360, wordBreak: 'break-word' }}>
              {this.state.message}
            </p>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#c9a227',
              color: '#0f0f0f',
              border: 'none',
              borderRadius: 12,
              padding: '10px 28px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
