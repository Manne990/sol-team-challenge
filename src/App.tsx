import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { AuthGate } from "./AuthGate";
import {
  AppShell,
  OperationalState,
  WorkspacePreview,
} from "./client/components";
import { ContactsPage } from "./client/ContactsPage";
import { CompaniesWorkspace } from "./client/components/CompaniesWorkspace";
import { TasksPage } from "./TasksPage.jsx";
import "./styles.css";
import "./client/styles.css";

export function App() {
  return (
    <AuthGate>
      {(user, signOut) => (
        <Workspace user={user} onSignOut={() => void signOut()} />
      )}
    </AuthGate>
  );
}

function Workspace({
  user,
  onSignOut,
}: {
  user: import("./shared/auth").AuthenticatedUser;
  onSignOut: () => void;
}) {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const changed = () => setPath(location.pathname);
    addEventListener("popstate", changed);
    return () => removeEventListener("popstate", changed);
  }, []);
  const navigate = (href: string) => {
    history.pushState(null, "", href);
    setPath(href);
  };
  if (
    path.startsWith("/contacts") ||
    path.startsWith("/companies") ||
    path.startsWith("/tasks")
  )
    return (
      <AppShell
        currentPath={
          path.startsWith("/contacts")
            ? "/contacts"
            : path.startsWith("/tasks")
              ? "/tasks"
              : "/companies"
        }
        navigate={navigate}
        role={user.role}
        organizationName={user.organization.name}
        userName={user.name}
        userEmail={user.email}
        onSignOut={onSignOut}
      >
        {path.startsWith("/contacts") ? (
          <ContactsPage role={user.role} />
        ) : path.startsWith("/tasks") ? (
          <TasksPage role={user.role} />
        ) : (
          <CompaniesWorkspace role={user.role} />
        )}
      </AppShell>
    );
  return (
    <WorkspacePreview
      role={user.role}
      organizationName={user.organization.name}
      userName={user.name}
      userEmail={user.email}
      onSignOut={onSignOut}
    />
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
