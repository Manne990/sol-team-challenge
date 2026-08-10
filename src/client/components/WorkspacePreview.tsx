import { AppShell, type UserRole } from "./AppShell";
import { CompaniesPage } from "./CompaniesPage";
import { useState } from "react";
import { TasksPage } from "./TasksPage";
import { SearchPage } from "./SearchPage";
import { DealsPage } from "../DealsPage";
import { NotificationsPage } from "../NotificationsPage";
import { DashboardPage } from "../DashboardPage";

export function WorkspacePreview({
  role = "owner",
  userId = "usr_northstar_owner",
  onSignOut,
}: {
  role?: UserRole;
  userId?: string;
  onSignOut?: () => void;
}) {
  const [path, setPath] = useState(
    location.pathname === "/workspace" ? "/" : location.pathname,
  );
  const navigate = (href: string) => {
    history.pushState(null, "", href);
    setPath(href);
  };
  return (
    <AppShell
      currentPath={path}
      navigate={navigate}
      role={role}
      organizationName="Northstar Demo"
      userName="Morgan Lee"
      userEmail="owner@northstar.test"
      onSignOut={onSignOut}
    >
      {path.startsWith("/companies") ? (
        <CompaniesPage role={role} />
      ) : path.startsWith("/tasks") ? (
        <TasksPage role={role} userId={userId} />
      ) : path.startsWith("/search") ? (
        <SearchPage navigate={navigate} />
      ) : path.startsWith("/deals") ? (
        <DealsPage role={role} userId={userId} />
      ) : path.startsWith("/notifications") ? (
        <NotificationsPage />
      ) : (
        <DashboardPage navigate={navigate} />
      )}
    </AppShell>
  );
}
