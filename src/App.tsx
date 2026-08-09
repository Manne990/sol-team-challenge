import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { AuthGate } from "./AuthGate";
import { ActivitiesPage } from "./ActivitiesPage";
import { AppShell, OperationalState } from "./client/components";
import { ContactsPage } from "./client/ContactsPage";
import { ImportsPage } from "./client/ImportsPage";
import { NotificationsPage } from "./client/NotificationsPage";
import { AdministrationPage } from "./client/AdministrationPage";
import { AuditPage } from "./client/AuditPage";
import { CompaniesWorkspace } from "./client/components/CompaniesWorkspace";
import { TasksPage } from "./TasksPage.jsx";
// @ts-expect-error This shared JSX surface is validated by ESLint and browser tests.
import { DealsPage } from "./DealsPage.jsx";
import { DuplicatesPage } from "./DuplicatesPage.jsx";
// @ts-expect-error This shared JSX surface is validated by component and browser tests.
import { DashboardPage } from "./DashboardPage.jsx";
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
    path.startsWith("/tasks") ||
    path.startsWith("/activities") ||
    path.startsWith("/imports") ||
    path.startsWith("/notifications") ||
    path.startsWith("/deals") ||
    path.startsWith("/duplicates") ||
    path.startsWith("/admin") ||
    path.startsWith("/audit")
  )
    return (
      <AppShell
        currentPath={
          path.startsWith("/contacts")
            ? "/contacts"
            : path.startsWith("/activities")
              ? "/activities"
              : path.startsWith("/tasks")
                ? "/tasks"
                : path.startsWith("/imports")
                  ? "/imports"
                  : path.startsWith("/duplicates")
                    ? "/duplicates"
                    : path.startsWith("/deals")
                      ? "/deals"
                      : path.startsWith("/notifications")
                        ? "/notifications"
                        : path.startsWith("/admin")
                          ? "/admin"
                          : path.startsWith("/audit")
                            ? "/audit"
                            : "/companies"
        }
        navigate={navigate}
        role={user.role}
        organizationName={user.organization.name}
        userName={user.name}
        userEmail={user.email}
        onSignOut={onSignOut}
      >
        {path.startsWith("/imports") ? (
          <ImportsPage role={user.role} />
        ) : path.startsWith("/notifications") ? (
          <NotificationsPage />
        ) : path.startsWith("/admin") ? (
          <AdministrationPage user={user} />
        ) : path.startsWith("/audit") ? (
          <AuditPage role={user.role} />
        ) : path.startsWith("/duplicates") ? (
          <DuplicatesPage role={user.role} />
        ) : path.startsWith("/contacts") ? (
          <ContactsPage role={user.role} />
        ) : path.startsWith("/activities") ? (
          <ActivitiesPage role={user.role} user={user} />
        ) : path.startsWith("/tasks") ? (
          <TasksPage role={user.role} />
        ) : path.startsWith("/deals") ? (
          <DealsPage role={user.role} user={user} dealId={path.split("/")[2]} />
        ) : (
          <CompaniesWorkspace role={user.role} />
        )}
      </AppShell>
    );
  return (
    <AppShell
      currentPath="/"
      navigate={navigate}
      role={user.role}
      organizationName={user.organization.name}
      userName={user.name}
      userEmail={user.email}
      onSignOut={onSignOut}
    >
      <DashboardPage />
    </AppShell>
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
