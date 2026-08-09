import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import type { HealthResponse } from "./shared/api";
import { OperationalState, WorkspacePreview } from "./client/components";
import "./styles.css";
import "./client/styles.css";

type Status = "loading" | "ready" | "unavailable";

export function App() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Health check failed");
        const health = (await response.json()) as HealthResponse;
        if (health.status !== "ok") throw new Error("Service unavailable");
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setStatus("unavailable");
        }
      });
    return () => controller.abort();
  }, []);

  if (status === "loading")
    return (
      <main aria-busy="true">
        <OperationalState kind="loading" message="Loading Northstar CRM…" />
      </main>
    );
  if (status === "unavailable") {
    return (
      <main>
        <OperationalState
          kind="error"
          title="Northstar CRM is unavailable"
          message="Check the server connection, then refresh this page."
        />
      </main>
    );
  }
  return <WorkspacePreview />;
}

interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state = { failed: false };
  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unexpected interface failure", {
      name: error.name,
      componentStack: info.componentStack,
    });
  }
  render() {
    if (this.state.failed) {
      return (
        <main>
          <OperationalState
            kind="error"
            title="Something went wrong"
            message="Refresh the page to try again."
          />
        </main>
      );
    }
    return this.props.children;
  }
}
