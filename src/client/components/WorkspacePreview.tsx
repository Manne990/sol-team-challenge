import { AppShell, type UserRole } from "./AppShell";
import {
  Button,
  DataTable,
  FilterBar,
  PageHeader,
  Select,
  StatusBadge,
  TextInput,
} from "./ui";
import { CompaniesPage } from "./CompaniesPage";
import { useState } from "react";
import { TasksPage } from "./TasksPage";
import { SearchPage } from "./SearchPage";
import { DealsPage } from "../DealsPage";
import { NotificationsPage } from "../NotificationsPage";
import { AdminPage } from "./AdminPage";

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
      ) : path.startsWith("/admin") ? (
        <AdminPage />
      ) : path.startsWith("/audit") ? (
        <AdminPage auditOnly />
      ) : (
        <>
          <PageHeader
            eyebrow="Today"
            title="Dashboard"
            description="Your operational view of customer work and sales activity."
            actions={
              <>
                <Button variant="secondary">Export</Button>
                <Button>Add activity</Button>
              </>
            }
          />
          <FilterBar activeCount={0}>
            <label className="ns-field">
              <span>Search the CRM</span>
              <TextInput
                type="search"
                placeholder="Company, contact, deal or task"
                onKeyDown={(event) => {
                  if (event.key === "Enter")
                    navigate(
                      `/search?q=${encodeURIComponent(event.currentTarget.value)}`,
                    );
                }}
              />
            </label>
            <label className="ns-field">
              <span>Lifecycle</span>
              <Select defaultValue="customer">
                <option value="">All lifecycles</option>
                <option value="customer">Customer</option>
                <option value="prospect">Prospect</option>
              </Select>
            </label>
          </FilterBar>
          <DataTable
            caption="Companies"
            columns={["Company", "Industry", "Owner", "Lifecycle", "Updated"]}
          >
            <tr>
              <td>
                <strong>Acme Nordic AB</strong>
                <br />
                <small>SE-559001-1200</small>
              </td>
              <td>Manufacturing</td>
              <td>Morgan Lee</td>
              <td>
                <StatusBadge tone="positive">Customer</StatusBadge>
              </td>
              <td>
                <time dateTime="2026-08-09T13:15:00Z">
                  9 Aug 2026, 15:15 CEST
                </time>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Brightpath Studio</strong>
                <br />
                <small>EXT-1042</small>
              </td>
              <td>Professional services</td>
              <td>Jamie Chen</td>
              <td>
                <StatusBadge tone="info">Prospect</StatusBadge>
              </td>
              <td>
                <time dateTime="2026-08-08T09:30:00Z">
                  8 Aug 2026, 11:30 CEST
                </time>
              </td>
            </tr>
          </DataTable>
        </>
      )}
    </AppShell>
  );
}
