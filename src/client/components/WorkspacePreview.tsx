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

interface WorkspacePreviewProps {
  role?: UserRole;
  organizationName?: string;
  userName?: string;
  userEmail?: string;
  onSignOut?: () => void;
}

export function WorkspacePreview({
  role = "owner",
  organizationName,
  userName,
  userEmail,
  onSignOut,
}: WorkspacePreviewProps) {
  return (
    <AppShell
      currentPath="/"
      role={role}
      organizationName={organizationName}
      userName={userName}
      userEmail={userEmail}
      onSignOut={onSignOut}
    >
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
      <FilterBar activeCount={1}>
        <label className="ns-field">
          <span>Search the CRM</span>
          <TextInput
            type="search"
            placeholder="Company, contact, deal or task"
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
            <time dateTime="2026-08-09T13:15:00Z">9 Aug 2026, 15:15 CEST</time>
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
            <time dateTime="2026-08-08T09:30:00Z">8 Aug 2026, 11:30 CEST</time>
          </td>
        </tr>
      </DataTable>
    </AppShell>
  );
}
