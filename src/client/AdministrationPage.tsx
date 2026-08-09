import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AuthenticatedUser, Role } from "../shared/auth";
import {
  Button,
  ConfirmDialog,
  OperationalState,
  PageHeader,
  Select,
  TextInput,
} from "./components";
type Member = { id: string; name: string; email: string; role: Role };
type Organization = {
  id: string;
  name: string;
  settings: { currency?: string; timezone?: string; staleAccountDays?: number };
  updatedAt: string;
  version: number;
};
export function AdministrationPage({ user }: { user: AuthenticatedUser }) {
  const [members, setMembers] = useState<Member[]>([]),
    [organization, setOrganization] = useState<Organization | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [remove, setRemove] = useState<Member | null>(null),
    [form, setForm] = useState({
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      role: "member" as Role,
    });
  const request = async (path: string, options?: RequestInit) => {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
    const body =
      response.status === 204
        ? {}
        : ((await response.json()) as { error?: { message: string } });
    if (!response.ok)
      throw new Error(body.error?.message ?? "Administration request failed.");
    return body;
  };
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [membersBody, orgBody] = (await Promise.all([
        request("/api/auth/members"),
        request("/api/governance/organization"),
      ])) as [{ members: Member[] }, { organization: Organization }];
      setMembers(membersBody.members);
      setOrganization(orgBody.organization);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Administration could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (user.role === "owner") void load();
    else setBusy(false);
  }, [load, user.role]);
  if (user.role !== "owner")
    return (
      <OperationalState
        kind="forbidden"
        message="Only organization owners can manage members and settings."
      />
    );
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await request("/api/auth/members", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({
        firstName: "",
        lastName: "",
        email: "",
        password: "",
        role: "member",
      });
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Member could not be created.",
      );
    }
  };
  const role = async (member: Member, next: Role) => {
    setError("");
    try {
      await request(`/api/auth/members/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: next }),
      });
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Role could not be changed.",
      );
    }
  };
  const revoke = async () => {
    if (!remove) return;
    setError("");
    try {
      await request(`/api/auth/members/${remove.id}`, { method: "DELETE" });
      setRemove(null);
      await load();
    } catch (reason) {
      setRemove(null);
      setError(
        reason instanceof Error
          ? reason.message
          : "Access could not be revoked.",
      );
    }
  };
  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!organization) return;
    setError("");
    try {
      const body = (await request("/api/governance/organization", {
        method: "PATCH",
        body: JSON.stringify({
          name: organization.name,
          currency: organization.settings.currency ?? "SEK",
          timezone: organization.settings.timezone ?? "UTC",
          staleAccountDays: organization.settings.staleAccountDays ?? 30,
          version: organization.version,
        }),
      })) as { organization: Organization };
      setOrganization(body.organization);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Settings could not be saved.",
      );
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Owner controls"
        title="Administration"
        description="Manage organization settings, roles, and access."
      />
      {error && (
        <div className="ns-inline-error" role="alert">
          {error}
        </div>
      )}
      {busy ? (
        <OperationalState kind="loading" />
      ) : (
        <>
          <section className="ns-admin-panel">
            <h2>Organization settings</h2>
            {organization && (
              <form
                className="ns-admin-form"
                onSubmit={(event) => void saveSettings(event)}
              >
                <label className="ns-field">
                  <span>Organization name</span>
                  <TextInput
                    required
                    value={organization.name}
                    onChange={(event) =>
                      setOrganization({
                        ...organization,
                        name: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="ns-field">
                  <span>Reporting currency</span>
                  <TextInput
                    required
                    maxLength={3}
                    value={organization.settings.currency ?? "SEK"}
                    onChange={(event) =>
                      setOrganization({
                        ...organization,
                        settings: {
                          ...organization.settings,
                          currency: event.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label className="ns-field">
                  <span>Timezone</span>
                  <TextInput
                    required
                    value={organization.settings.timezone ?? "UTC"}
                    onChange={(event) =>
                      setOrganization({
                        ...organization,
                        settings: {
                          ...organization.settings,
                          timezone: event.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label className="ns-field">
                  <span>Stale after days</span>
                  <TextInput
                    required
                    type="number"
                    min={1}
                    max={365}
                    value={organization.settings.staleAccountDays ?? 30}
                    onChange={(event) =>
                      setOrganization({
                        ...organization,
                        settings: {
                          ...organization.settings,
                          staleAccountDays: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
                <Button type="submit">Save settings</Button>
              </form>
            )}
          </section>
          <section className="ns-admin-panel">
            <h2>Active members</h2>
            <div
              className="ns-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Members, scrollable"
            >
              <table className="ns-table">
                <thead>
                  <tr>
                    <th scope="col">Member</th>
                    <th scope="col">Role</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <strong>{member.name}</strong>
                        <br />
                        <small>{member.email}</small>
                        {member.id === user.membershipId && " (you)"}
                      </td>
                      <td>
                        <Select
                          aria-label={`Role for ${member.name}`}
                          value={member.role}
                          onChange={(event) =>
                            void role(member, event.target.value as Role)
                          }
                        >
                          <option value="owner">Owner</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </Select>
                      </td>
                      <td>
                        <Button
                          variant="danger"
                          onClick={() => setRemove(member)}
                        >
                          Revoke access
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="ns-admin-panel">
            <h2>Add member</h2>
            <p>A temporary password is required and is never shown again.</p>
            <form
              className="ns-admin-form"
              onSubmit={(event) => void create(event)}
            >
              <label className="ns-field">
                <span>First name</span>
                <TextInput
                  required
                  value={form.firstName}
                  onChange={(event) =>
                    setForm({ ...form, firstName: event.target.value })
                  }
                />
              </label>
              <label className="ns-field">
                <span>Last name</span>
                <TextInput
                  required
                  value={form.lastName}
                  onChange={(event) =>
                    setForm({ ...form, lastName: event.target.value })
                  }
                />
              </label>
              <label className="ns-field">
                <span>Email</span>
                <TextInput
                  type="email"
                  required
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                />
              </label>
              <label className="ns-field">
                <span>Temporary password</span>
                <TextInput
                  type="password"
                  minLength={12}
                  required
                  value={form.password}
                  onChange={(event) =>
                    setForm({ ...form, password: event.target.value })
                  }
                />
              </label>
              <label className="ns-field">
                <span>Role</span>
                <Select
                  value={form.role}
                  onChange={(event) =>
                    setForm({ ...form, role: event.target.value as Role })
                  }
                >
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                  <option value="owner">Owner</option>
                </Select>
              </label>
              <Button type="submit">Add member</Button>
            </form>
          </section>
        </>
      )}
      <ConfirmDialog
        open={Boolean(remove)}
        title={`Revoke ${remove?.name ?? "member"}?`}
        consequences="They will be signed out immediately and lose access. Their historical activity remains attributed."
        confirmLabel="Revoke access"
        danger
        onConfirm={() => void revoke()}
        onClose={() => setRemove(null)}
      />
    </>
  );
}
