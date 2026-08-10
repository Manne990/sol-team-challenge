import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type { HealthResponse } from "../shared/api";
import { OperationalState, WorkspacePreview } from "./components";

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

  if (state === "loading")
    return (
      <main aria-busy="true">
        <OperationalState kind="loading" message="Loading Northstar CRM…" />
      </main>
    );
  if (state === "unavailable")
    return (
      <main>
        <OperationalState
          kind="error"
          title="Northstar CRM is unavailable"
          message="Check the server connection, then refresh this page. Your saved data has not been changed."
        />
      </main>
    );
  return <WorkspacePreview />;
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
          <OperationalState
            kind="error"
            title="Something went wrong"
            message="Reload the page to try again. Your saved data has not been changed."
          />
        </main>
      );
    return this.props.children;
  }
}
