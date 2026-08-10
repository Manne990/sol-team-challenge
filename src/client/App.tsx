import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type { HealthResponse } from "../shared/api";

type State = "loading" | "ready" | "unavailable";

export function App() {
  const [state, setState] = useState<State>("loading");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Service unavailable");
        return response.json() as Promise<HealthResponse>;
      })
      .then(() => setState("ready"))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setState("unavailable");
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <section
        className="panel"
        aria-labelledby="product-title"
        aria-busy={state === "loading"}
      >
        <p className="eyebrow">Northstar</p>
        <h1 id="product-title">CRM workspace</h1>
        {state === "loading" && (
          <p role="status">Connecting to your workspace…</p>
        )}
        {state === "ready" && <p role="status">Your workspace is ready.</p>}
        {state === "unavailable" && (
          <div role="alert">
            <h2>Workspace unavailable</h2>
            <p>
              Check your connection, then reload the page. Your saved data has
              not been changed.
            </p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unexpected interface failure", error, info);
  }
  render() {
    if (this.state.failed)
      return (
        <main>
          <section className="panel" role="alert">
            <h1>Something went wrong</h1>
            <p>
              Reload the page to try again. Your saved data has not been
              changed.
            </p>
            <button onClick={() => window.location.reload()}>Reload</button>
          </section>
        </main>
      );
    return this.props.children;
  }
}
