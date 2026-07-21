import React from "react";

/**
 * Top-level error boundary.
 *
 * If anything throws during render in production the user sees a friendly
 * message + Reload button instead of React's cryptic minified error code.
 *
 * Keep this component small and dependency-free — it must work even when
 * the rest of the app has crashed.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Visible in dev tools / CI logs; intentionally a no-op in production UI.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  handleReload = () => {
    try {
      window.location.reload();
    } catch {
      /* ignore */
    }
  };

  render() {
    if (this.state.error) {
      return (
        <div
          data-testid="app-error-boundary"
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            fontFamily:
              "'Cabinet Grotesk', 'Outfit', system-ui, -apple-system, sans-serif",
            background: "#ffffff",
            color: "#0F172A",
          }}
        >
          <div style={{ maxWidth: 480, textAlign: "left" }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "#475569",
                marginBottom: 12,
              }}
            >
              Swim · Coach Tool
            </div>
            <h1
              style={{
                fontSize: 32,
                fontWeight: 900,
                lineHeight: 1,
                margin: 0,
                marginBottom: 16,
                letterSpacing: "-0.02em",
              }}
            >
              Something went wrong loading the planner.
            </h1>
            <p
              style={{
                color: "#475569",
                fontSize: 16,
                lineHeight: 1.5,
                marginBottom: 24,
              }}
            >
              The app encountered an unexpected error. Reloading the page should
              fix it. If it keeps happening, try a hard refresh (Cmd/Ctrl+Shift+R).
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              data-testid="error-reload"
              style={{
                background: "#003366",
                color: "#fff",
                border: "none",
                padding: "12px 20px",
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
                borderRadius: 2,
              }}
            >
              Reload
            </button>
            {this.state.error?.message && (
              <details style={{ marginTop: 24, color: "#475569" }}>
                <summary
                  style={{ cursor: "pointer", fontSize: 13, fontWeight: 700 }}
                >
                  Technical details
                </summary>
                <pre
                  style={{
                    marginTop: 8,
                    padding: 12,
                    background: "#F1F5F9",
                    borderRadius: 2,
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {String(this.state.error.message)}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
