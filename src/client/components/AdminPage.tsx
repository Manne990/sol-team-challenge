import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  Field,
  FilterBar,
  OperationalState,
  PageHeader,
  Pagination,
  Select,
  TextInput,
  Toast,
  ToastRegion,
} from "./ui";
type Member = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "member" | "viewer";
  revokedAt: string | null;
  self: boolean;
};
type Org = { name: string; settings: { timezone?: string }; version: number };
type Event = {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  correlationId: string;
  summary: Record<string, unknown>;
  occurredAt: string;
};
export function AdminPage({ auditOnly = false }: { auditOnly?: boolean }) {
  const [organization, setOrganization] = useState<Org | null>(null),
    [members, setMembers] = useState<Member[]>([]),
    [events, setEvents] = useState<Event[]>([]),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [action, setAction] = useState(""),
    [state, setState] = useState<"loading" | "ready" | "error" | "forbidden">(
      "loading",
    ),
    [open, setOpen] = useState(false),
    [revokeTarget, setRevokeTarget] = useState<Member | null>(null),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    const endpoint = auditOnly
      ? `/api/admin/audit?page=${page}${action ? `&action=${encodeURIComponent(action)}` : ""}`
      : "/api/admin/organization";
    try {
      const response = await fetch(endpoint);
      if (response.status === 403) {
        setState("forbidden");
        return;
      }
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (auditOnly) {
        setEvents(body.items);
        setPages(body.totalPages);
      } else {
        setOrganization(body.organization);
        setMembers(body.members);
      }
      setState("ready");
    } catch {
      setState("error");
    }
  }, [auditOnly, page, action]);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget),
      response = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data)),
      });
    if (response.ok) {
      setOpen(false);
      setMessage("Member created");
      await load();
    } else
      setMessage(
        ((await response.json()) as { error: { message: string } }).error
          .message,
      );
  }
  async function role(member: Member, value: string) {
    const response = await fetch(`/api/admin/members/${member.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: value }),
    });
    if (response.ok) {
      setMessage("Role updated; active sessions were revoked");
      await load();
    } else
      setMessage(
        ((await response.json()) as { error: { message: string } }).error
          .message,
      );
  }
  async function revoke(member: Member) {
    const response = await fetch(`/api/admin/members/${member.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setRevokeTarget(null);
      setMessage("Access revoked");
      await load();
    } else
      setMessage(
        ((await response.json()) as { error: { message: string } }).error
          .message,
      );
  }
  async function settings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization) return;
    const data = new FormData(event.currentTarget),
      response = await fetch("/api/admin/organization", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          timezone: data.get("timezone"),
          version: organization.version,
        }),
      });
    if (response.ok) {
      setMessage("Organization settings saved");
      await load();
    } else
      setMessage(
        ((await response.json()) as { error: { message: string } }).error
          .message,
      );
  }
  if (state === "loading") return <OperationalState kind="loading" />;
  if (state === "forbidden") return <OperationalState kind="forbidden" />;
  if (state === "error")
    return (
      <OperationalState
        kind="error"
        action={<Button onClick={() => void load()}>Try again</Button>}
      />
    );
  if (auditOnly)
    return (
      <>
        <PageHeader
          eyebrow="Append-only record"
          title="Audit"
          description="Security and material CRM changes for this organization."
        />
        <FilterBar activeCount={action ? 1 : 0} onClear={() => setAction("")}>
          <label className="ns-field">
            <span>Action</span>
            <TextInput
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(1);
              }}
              placeholder="company.updated"
            />
          </label>
        </FilterBar>
        {events.length ? (
          <>
            <DataTable
              caption="Audit events"
              columns={[
                "Time",
                "Actor",
                "Action",
                "Entity",
                "Safe summary",
                "Correlation",
              ]}
            >
              {events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <time dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleString()}
                    </time>
                  </td>
                  <td>{event.actorName}</td>
                  <td>
                    <code>{event.action}</code>
                  </td>
                  <td>
                    {event.entityType}
                    {event.entityId && (
                      <>
                        <br />
                        <small>{event.entityId}</small>
                      </>
                    )}
                  </td>
                  <td>
                    {Object.entries(event.summary)
                      .map(
                        ([key, value]) =>
                          `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`,
                      )
                      .join(" · ") || "—"}
                  </td>
                  <td>
                    <small>{event.correlationId}</small>
                  </td>
                </tr>
              ))}
            </DataTable>
            <Pagination page={page} totalPages={pages} onPageChange={setPage} />
          </>
        ) : (
          <OperationalState
            kind="empty"
            title="No matching audit events"
            message="Change the filter or perform a material action."
          />
        )}
      </>
    );
  return (
    <>
      {organization && (
        <>
          <PageHeader
            eyebrow="Owner access"
            title="Administration"
            description="Manage organization settings, roles, and access."
            actions={
              <Button onClick={() => setOpen(true)}>Create member</Button>
            }
          />
          <form className="ns-admin-settings" onSubmit={settings}>
            <Field label="Organization name" required>
              <TextInput
                name="name"
                defaultValue={organization.name}
                required
              />
            </Field>
            <Field label="Display timezone">
              <TextInput
                name="timezone"
                defaultValue={organization.settings.timezone ?? "UTC"}
              />
            </Field>
            <Button type="submit">Save settings</Button>
          </form>
          <DataTable
            caption="Organization members"
            columns={["Member", "Email", "Role", "Access"]}
          >
            {members.map((member) => (
              <tr key={member.id}>
                <td>
                  <strong>{member.name}</strong>
                  {member.self && <small> (you)</small>}
                </td>
                <td>{member.email}</td>
                <td>
                  {member.revokedAt ? (
                    member.role
                  ) : (
                    <Select
                      aria-label={`Role for ${member.name}`}
                      value={member.role}
                      onChange={(event) =>
                        void role(member, event.target.value)
                      }
                    >
                      <option value="owner">Owner</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </Select>
                  )}
                </td>
                <td>
                  {member.revokedAt ? (
                    <span>Revoked</span>
                  ) : (
                    <Button
                      variant="danger"
                      disabled={member.self}
                      onClick={() => setRevokeTarget(member)}
                    >
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        </>
      )}
      <Dialog
        open={open}
        title="Create member"
        description="Create a local account in this organization."
        onClose={() => setOpen(false)}
      >
        <form onSubmit={create}>
          <Field label="Name" required>
            <TextInput name="name" required />
          </Field>
          <Field label="Email" required>
            <TextInput name="email" type="email" required />
          </Field>
          <Field label="Temporary password" hint="12–256 characters" required>
            <TextInput
              name="password"
              type="password"
              minLength={12}
              required
            />
          </Field>
          <Field label="Role">
            <Select name="role">
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </Select>
          </Field>
          <div className="ns-dialog-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Create member</Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title={`Revoke ${revokeTarget?.name ?? "member"}?`}
        consequences="This immediately removes organization access and revokes every active session for this member. Existing audit history remains preserved."
        confirmLabel="Revoke access"
        danger
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => revokeTarget && void revoke(revokeTarget)}
      />
      {message && (
        <ToastRegion>
          <Toast
            tone={
              message.includes("owner") || message.includes("valid")
                ? "error"
                : "success"
            }
            title={message}
            onDismiss={() => setMessage("")}
          />
        </ToastRegion>
      )}
    </>
  );
}
