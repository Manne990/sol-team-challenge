import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type FormEvent,
  type ReactNode,
} from "react";
import type { HealthResponse } from "../shared/api";
import { AppShell, OperationalState, WorkspacePreview } from "./components";
import { ContactsPage } from "./ContactsPage";
import { ImportsPage } from "./ImportsPage";
import { ActivitiesPage } from "./ActivitiesPage";

type State = "loading" | "ready" | "unavailable";
type Session = {
  authenticated: true;
  userId: string;
  organizationId: string;
  organizationName: string;
  userName: string;
  userEmail: string;
  role: "owner" | "member" | "viewer";
  expiresAt: string;
};

export function App() {
  const [state, setState] = useState<State>("loading");
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Service unavailable");
        return response.json() as Promise<HealthResponse>;
      })
      .then(async () => {
        const response = await fetch("/api/auth/session");
        if (response.ok) {
          const body = (await response.json()) as
            Session | { authenticated: false };
          if (body.authenticated) setSession(body);
        }
        setState("ready");
      })
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
  if (!session)
    return (
      <main className="ns-auth-page">
        <section className="ns-auth-panel" aria-labelledby="product-title">
          <p className="ns-eyebrow">Northstar</p>
          <h1 id="product-title">CRM workspace</h1>
          <SignIn onSignedIn={setSession} />
        </section>
      </main>
    );
  if (window.location.pathname.startsWith("/contacts"))
    return (
      <AppShell
        currentPath="/contacts"
        role={session.role}
        organizationName={session.organizationName}
        userName={session.userName}
        userEmail={session.userEmail}
        onSignOut={() => void logoutSession(setSession)}
      >
        <ContactsPage role={session.role} />
      </AppShell>
    );
  if (window.location.pathname.startsWith("/imports"))
    return (
      <AppShell
        currentPath="/imports"
        role={session.role}
        organizationName={session.organizationName}
        userName={session.userName}
        userEmail={session.userEmail}
        onSignOut={() => void logoutSession(setSession)}
      >
        <ImportsPage role={session.role} />
      </AppShell>
    );
  if (window.location.pathname.startsWith("/activities"))
    return (
      <AppShell
        currentPath="/activities"
        role={session.role}
        organizationName={session.organizationName}
        userName={session.userName}
        userEmail={session.userEmail}
        onSignOut={() => void logoutSession(setSession)}
      >
        <ActivitiesPage role={session.role} userId={session.userId} />
      </AppShell>
    );
  return (
    <WorkspacePreview
      role={session.role}
      userId={session.userId}
      organizationName={session.organizationName}
      userName={session.userName}
      userEmail={session.userEmail}
      onSignOut={() => void logoutSession(setSession)}
    />
  );
}

async function logoutSession(setSession: (session: Session | null) => void) {
  try {
    await fetch("/api/auth/session", { method: "DELETE" });
  } finally {
    setSession(null);
  }
}

function SignIn({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
        }),
      });
      const body = (await response.json()) as
        Session | { error: { message: string } };
      if (!response.ok) {
        setError(
          "error" in body ? body.error.message : "Sign-in failed. Try again.",
        );
        return;
      }
      onSignedIn(body as Session);
    } catch {
      setError(
        "Northstar is unavailable. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} aria-busy={busy}>
      <h2>Sign in</h2>
      <p>Use your organization account to continue.</p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
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
