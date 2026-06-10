// Catches any render-time error in the React tree so a single bad component can't
// blank the entire app. Shows the error (recoverable) instead of an empty window.
import { Component, ReactNode } from "react";

interface State { error: Error | null; info: string }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Surface to the main process log too.
    console.error("[renderer] React error:", error, info.componentStack);
    this.setState({ info: info.componentStack });
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: "fixed", inset: 0, background: "#0D0D0F", color: "#F4F5F7",
          padding: 32, fontFamily: "monospace", fontSize: 13, overflow: "auto",
        }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
            Something broke in the UI
          </div>
          <div style={{ color: "#ff8080", whiteSpace: "pre-wrap", marginBottom: 16 }}>
            {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
          </div>
          <div style={{ color: "#9BA0AA", whiteSpace: "pre-wrap", fontSize: 11, marginBottom: 20 }}>
            {this.state.info}
          </div>
          <button
            onClick={() => this.setState({ error: null, info: "" })}
            style={{
              background: "linear-gradient(135deg,#23C6A2,#15BC9C)", color: "#fff",
              border: "none", borderRadius: 999, padding: "8px 20px", cursor: "pointer", fontWeight: 600,
            }}
          >Reload UI</button>
        </div>
      );
    }
    return this.props.children;
  }
}
