import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import type { HealthResponse } from "./shared/api";
import "./styles.css";

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
    return <main aria-busy="true">Loading Northstar CRM…</main>;
  if (status === "unavailable") {
    return (
      <main>
        <h1>Northstar CRM is unavailable</h1>
        <p>Check the server connection, then refresh this page.</p>
      </main>
    );
  }
  return (
    <main>
      <p className="eyebrow">Northstar CRM</p>
      <h1>Your operational workspace is ready</h1>
      <p>The application foundation is connected and ready for CRM features.</p>
    </main>
  );
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
          <h1>Something went wrong</h1>
          <p>Refresh the page to try again.</p>
        </main>
      );
    }
    return this.props.children;
  }
}
