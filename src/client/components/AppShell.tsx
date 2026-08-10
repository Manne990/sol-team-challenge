import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type UserRole = "owner" | "member" | "viewer";

export interface NavigationItem {
  href: string;
  label: string;
  icon: ReactNode;
  ownerOnly?: boolean;
}

export interface AppShellProps {
  children: ReactNode;
  currentPath?: string;
  navigate?: (href: string) => void;
  organizationName?: string;
  role?: UserRole;
  userName?: string;
  userEmail?: string;
  onSignOut?: () => void;
}

const icons: Record<string, ReactNode> = {
  dashboard: (
    <path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" />
  ),
  companies: (
    <path d="M4 21V3h12v7h4v11h-7v-4h-2v4H4Zm3-13h2V6H7v2Zm4 0h2V6h-2v2Zm-4 4h2v-2H7v2Zm4 0h2v-2h-2v2Zm5 2v2h2v-2h-2Z" />
  ),
  contacts: (
    <path d="M16 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM8 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 0c-2.7 0-8 1.34-8 4v4h16v-4c0-2.66-5.3-4-8-4ZM8 15c-3.11 0-8 1.56-8 4v2h5.5v-4c0-.74.29-1.4.78-1.98A11.4 11.4 0 0 0 8 15Z" />
  ),
  activities: (
    <path d="M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-2.34-5.66L14 10h8V2l-2.93 2.93A9.96 9.96 0 0 0 12 2Zm-1 5v6l5 3 .9-1.45-4.2-2.55V7H11Z" />
  ),
  deals: (
    <path d="M20 6h-4V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2Zm-10-2h4v2h-4V4Zm10 9h-7v2h-2v-2H4V8h16v5Z" />
  ),
  tasks: (
    <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-9 14-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8Z" />
  ),
  notifications: (
    <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6v-5a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" />
  ),
  imports: <path d="M19 9h-4V3H9v6H5l7 7 7-7ZM5 18v2h14v-2H5Z" />,
  duplicates: (
    <path d="M7 7h10v10H7V7Zm-4 4h2V5h6V3H3v8Zm16 2v6h-6v2h8v-8h-2Z" />
  ),
  audit: (
    <path d="M12 2 4 5v6c0 5.05 3.41 9.74 8 11 4.59-1.26 8-5.95 8-11V5l-8-3Zm0 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 12.9a8.9 8.9 0 0 1-5-3.54c.05-1.66 3.34-2.58 5-2.58 1.65 0 4.95.92 5 2.58a8.92 8.92 0 0 1-5 3.54Z" />
  ),
  admin: (
    <path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.08-.98l2.11-1.65-2-3.46-2.49 1a7.08 7.08 0 0 0-1.69-.98L15 3.27h-4l-.4 2.66c-.61.25-1.17.59-1.69.98l-2.49-1-2 3.46 2.11 1.65c-.04.32-.08.66-.08.98s.03.66.08.98l-2.11 1.65 2 3.46 2.49-1c.52.4 1.08.73 1.69.98l.4 2.66h4l.4-2.66c.61-.25 1.17-.58 1.69-.98l2.49 1 2-3.46-2.15-1.65ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" />
  ),
};

const defaultNavigation: NavigationItem[] = [
  { href: "/", label: "Dashboard", icon: icons.dashboard },
  { href: "/companies", label: "Companies", icon: icons.companies },
  { href: "/contacts", label: "Contacts", icon: icons.contacts },
  { href: "/activities", label: "Activities", icon: icons.activities },
  { href: "/deals", label: "Deals", icon: icons.deals },
  { href: "/tasks", label: "Tasks", icon: icons.tasks },
  { href: "/notifications", label: "Notifications", icon: icons.notifications },
  { href: "/imports", label: "Imports", icon: icons.imports },
  { href: "/duplicates", label: "Duplicates", icon: icons.duplicates },
  { href: "/audit", label: "Audit", icon: icons.audit, ownerOnly: true },
  {
    href: "/admin",
    label: "Administration",
    icon: icons.admin,
    ownerOnly: true,
  },
];

function NavLink({
  item,
  active,
  navigate,
  close,
}: {
  item: NavigationItem;
  active: boolean;
  navigate?: (href: string) => void;
  close: () => void;
}) {
  return (
    <a
      className="ns-nav-link"
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        if (navigate) {
          event.preventDefault();
          navigate(item.href);
        }
        close();
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        {item.icon}
      </svg>
      <span>{item.label}</span>
    </a>
  );
}

export function AppShell({
  children,
  currentPath = "/",
  navigate,
  organizationName = "Northstar Demo",
  role = "owner",
  userName = "Demo Owner",
  userEmail = "owner@northstar.test",
  onSignOut,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const accountMenuId = useId();
  const navigation = defaultNavigation.filter(
    (item) => !item.ownerOnly || role === "owner",
  );
  const closeMobile = () => setMobileOpen(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  return (
    <div className="ns-app-shell">
      <a className="ns-skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="ns-mobile-header">
        <button
          ref={menuButton}
          className="ns-icon-button"
          type="button"
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z" />
          </svg>
        </button>
        <Brand compact />
        <span className="ns-mobile-spacer" />
      </header>
      {mobileOpen && (
        <button
          className="ns-scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => {
            closeMobile();
            menuButton.current?.focus();
          }}
        />
      )}
      <aside
        className={`ns-sidebar${mobileOpen ? " is-open" : ""}`}
        aria-label="Primary navigation"
      >
        <Brand />
        <div className="ns-org-context">
          <span className="ns-eyebrow">Workspace</span>
          <strong>{organizationName}</strong>
        </div>
        <nav className="ns-primary-nav">
          {navigation.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={
                currentPath === item.href ||
                (item.href !== "/" && currentPath.startsWith(`${item.href}/`))
              }
              navigate={navigate}
              close={closeMobile}
            />
          ))}
        </nav>
        <div className="ns-account">
          <button
            ref={accountButton}
            className="ns-account-button"
            type="button"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            aria-controls={accountMenuId}
            onClick={() => setAccountOpen((value) => !value)}
          >
            <span className="ns-avatar" aria-hidden="true">
              {initials(userName)}
            </span>
            <span className="ns-account-copy">
              <strong>{userName}</strong>
              <small>{role}</small>
            </span>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m7 10 5 5 5-5H7Z" />
            </svg>
          </button>
          {accountOpen && (
            <div
              className="ns-account-menu"
              role="menu"
              id={accountMenuId}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setAccountOpen(false);
                  accountButton.current?.focus();
                }
              }}
            >
              <div>
                <strong>{userName}</strong>
                <small>{userEmail}</small>
              </div>
              <button role="menuitem" type="button" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>
      <main className="ns-main" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`ns-brand${compact ? " is-compact" : ""}`}>
      <span className="ns-brand-mark" aria-hidden="true">
        N
      </span>
      <span>
        Northstar <small>CRM</small>
      </span>
    </div>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U"
  );
}
