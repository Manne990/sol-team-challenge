import { Component, type ErrorInfo, type ReactNode } from "react";
import { AuthGate } from "./AuthGate";
import { OperationalState, WorkspacePreview } from "./client/components";
import "./styles.css";
import "./client/styles.css";

export function App() {
  return (
    <AuthGate>
      {(user, signOut) => (
        <WorkspacePreview
          role={user.role}
          organizationName={user.organization.name}
          userName={user.name}
          userEmail={user.email}
          onSignOut={() => void signOut()}
        />
      )}
    </AuthGate>
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
