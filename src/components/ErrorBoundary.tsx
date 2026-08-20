import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  showDetails: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, showDetails: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, showDetails: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Logged locally only — nothing here is ever sent anywhere. This is the
    // only place the raw error is surfaced by default; the screen itself
    // shows a plain, friendly message so a normal user never has to look at
    // a stack trace (or anything it might incidentally contain, like a file
    // path) just because one screen hit a bug.
    console.error("PFOS crashed:", error, info.componentStack);
  }

  // Clears the crash and re-renders the same tree in place — the right
  // choice when the error might have been transient (a bad IndexedDB read
  // that would succeed on retry, a one-off render race).
  handleRetry = () => {
    this.setState({ error: null, showDetails: false });
  };

  // Clears the crash AND routes to Home — the right choice when the crash
  // is tied to whatever screen/data the person was on, so retrying in place
  // would just hit the same error again.
  handleGoHome = () => {
    this.setState({ error: null, showDetails: false });
    window.location.hash = "#/";
  };

  toggleDetails = () => {
    this.setState((s) => ({ showDetails: !s.showDetails }));
  };

  render() {
    const { error, showDetails } = this.state;
    if (error) {
      return (
        <div
          className="content"
          style={{ paddingTop: 70, textAlign: "center" }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 18,
              background: "var(--over-bg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 18px",
            }}
          >
            <AlertTriangle size={28} color="var(--over)" />
          </div>
          <h1
            style={{
              fontFamily: "var(--display)",
              fontSize: 22,
              margin: "0 0 10px",
            }}
          >
            Something went wrong
          </h1>
          <p className="muted" style={{ maxWidth: 320, margin: "0 auto 8px" }}>
            This screen hit a snag and couldn't load. Your data is untouched —
            everything is still safely in this browser's storage.
          </p>

          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "center",
              marginTop: 14,
              flexWrap: "wrap",
            }}
          >
            <button className="btn secondary" onClick={this.handleRetry}>
              Try again
            </button>
            <button className="btn" onClick={this.handleGoHome}>
              Back to Home
            </button>
          </div>

          <button
            onClick={this.toggleDetails}
            aria-expanded={showDetails}
            className="muted"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              margin: "22px auto 0",
              background: "none",
              border: "none",
              font: "inherit",
              fontSize: 12.5,
              cursor: "pointer",
              padding: 4,
            }}
          >
            Technical details
            <ChevronDown
              size={14}
              style={{
                transform: showDetails ? "rotate(180deg)" : undefined,
                transition: "transform 0.15s ease",
              }}
            />
          </button>
          {showDetails && (
            <div className="card" style={{ textAlign: "left", marginTop: 10 }}>
              <p
                className="muted"
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  wordBreak: "break-word",
                  margin: 0,
                }}
              >
                {error.message}
              </p>
            </div>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
