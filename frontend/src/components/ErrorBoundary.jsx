import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

// A customer never sees a raw stack trace or a blank white screen from an
// uncaught render error -- this is the last line of defense the rest of the
// app's own try/catch-around-axios-calls pattern doesn't cover (those guard
// data fetching; this guards rendering itself). Logs the real error to the
// console for support/devtools, shows a calm, actionable screen to the user.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("XAUCLOUD_UI_CRASH", error, info?.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060609] px-4 text-white">
        <div className="w-full max-w-sm rounded-3xl border border-white/[0.08] bg-white/[0.03] p-7 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-300/[0.08]">
            <AlertTriangle className="h-5 w-5 text-amber-300" />
          </div>
          <h1 className="mt-4 text-[16px] font-bold">Something went wrong</h1>
          <p className="mt-2 text-[13px] leading-5 text-white/50">
            This page hit an unexpected error. Your account, license, and trading data are unaffected — try reloading.
          </p>
          <button onClick={this.handleReload}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-amber-300 py-3 text-[13px] font-bold text-black hover:bg-amber-200">
            <RefreshCw className="h-4 w-4" /> Reload
          </button>
          {process.env.NODE_ENV === "development" && this.state.error && (
            <pre className="mt-4 max-h-40 overflow-auto rounded-lg border border-white/[0.06] bg-black/30 p-3 text-left font-mono text-[10px] text-rose-300/80">
              {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
