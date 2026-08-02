import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Logged locally only — nothing here is ever sent anywhere.
    console.error('PFOS crashed:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
    window.location.hash = '#/';
  };

  render() {
    if (this.state.error) {
      return (
        <div className="content" style={{ paddingTop: 70, textAlign: 'center' }}>
          <div style={{
            width: 60, height: 60, borderRadius: 18, background: 'var(--over-bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px',
          }}>
            <AlertTriangle size={28} color="var(--over)" />
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 22, margin: '0 0 10px' }}>Something went wrong</h1>
          <p className="muted" style={{ maxWidth: 320, margin: '0 auto 8px' }}>
            This screen hit an error and couldn't render. Your data is untouched — everything is still safely in
            this browser's storage.
          </p>
          <div className="card" style={{ textAlign: 'left', marginTop: 20 }}>
            <p className="muted" style={{ fontFamily: 'var(--mono)', fontSize: 11, wordBreak: 'break-word', margin: 0 }}>
              {this.state.error.message}
            </p>
          </div>
          <button className="btn" onClick={this.handleReset}>Back to dashboard</button>
        </div>
      );
    }
    return this.props.children;
  }
}
