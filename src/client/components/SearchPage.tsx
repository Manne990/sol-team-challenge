import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  Field,
  OperationalState,
  PageHeader,
  Select,
  TextInput,
  Toast,
  ToastRegion,
} from "./ui";
type Result = { id: string; name: string; context: string | null };
type Groups = Record<"companies" | "contacts" | "deals" | "tasks", Result[]>;
type View = {
  id: string;
  resource: string;
  name: string;
  definition: Record<string, string>;
  version: number;
};
const empty: Groups = { companies: [], contacts: [], deals: [], tasks: [] };
export function SearchPage({ navigate }: { navigate: (href: string) => void }) {
  const initial = new URLSearchParams(location.search).get("q") ?? "",
    [query, setQuery] = useState(initial),
    [groups, setGroups] = useState(empty),
    [total, setTotal] = useState(0),
    [state, setState] = useState<"ready" | "loading" | "error">(
      initial ? "loading" : "ready",
    ),
    [views, setViews] = useState<View[]>([]),
    [dialog, setDialog] = useState(false),
    [message, setMessage] = useState("");
  const loadViews = useCallback(async () => {
    const response = await fetch("/api/search/views");
    if (response.ok)
      setViews(((await response.json()) as { items: View[] }).items);
  }, []);
  useEffect(() => {
    void loadViews();
  }, [loadViews]);
  async function search(event?: FormEvent) {
    event?.preventDefault();
    const value = query.trim();
    history.replaceState(
      null,
      "",
      value ? `/search?q=${encodeURIComponent(value)}` : "/search",
    );
    if (!value) {
      setGroups(empty);
      setTotal(0);
      return;
    }
    setState("loading");
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(value)}`,
      );
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { groups: Groups; total: number };
      setGroups(body.groups);
      setTotal(body.total);
      setState("ready");
    } catch {
      setState("error");
    }
  }
  useEffect(() => {
    if (initial) void search();
    // Search once from the initial shareable URL; later searches are explicit submissions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // initial URL only
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget),
      resource = String(data.get("resource")),
      response = await fetch("/api/search/views", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          resource,
          definition: { q: query },
        }),
      });
    if (response.ok) {
      setDialog(false);
      setMessage("View saved");
      await loadViews();
    } else
      setMessage(
        ((await response.json()) as { error: { message: string } }).error
          .message,
      );
  }
  async function remove(id: string) {
    await fetch(`/api/search/views/${id}`, { method: "DELETE" });
    await loadViews();
  }
  return (
    <>
      <PageHeader
        eyebrow="Across the CRM"
        title="Search"
        description="Find companies, contacts, deals, and tasks in your organization."
        actions={
          <Button
            variant="secondary"
            disabled={!query.trim()}
            onClick={() => setDialog(true)}
          >
            Save this search
          </Button>
        }
      />
      <form className="ns-global-search" onSubmit={search} role="search">
        <label className="ns-field">
          <span>Search records</span>
          <TextInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, email, reference, or task"
            autoFocus
          />
        </label>
        <Button type="submit">Search</Button>
      </form>
      {state === "loading" ? (
        <OperationalState kind="loading" />
      ) : state === "error" ? (
        <OperationalState
          kind="error"
          action={<Button onClick={() => void search()}>Try again</Button>}
        />
      ) : query && total === 0 ? (
        <OperationalState
          kind="empty"
          title="No matching records"
          message="Try a broader name, email, or reference."
        />
      ) : (
        <div className="ns-search-layout">
          <section
            className="ns-search-results"
            aria-label={`${total} search results`}
          >
            {(Object.entries(groups) as [keyof Groups, Result[]][]).map(
              ([resource, items]) => (
                <section key={resource}>
                  <h2>
                    {resource.charAt(0).toUpperCase() + resource.slice(1)}{" "}
                    <small>{items.length}</small>
                  </h2>
                  {items.length ? (
                    <ul>
                      {items.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => navigate(`/${resource}/${item.id}`)}
                          >
                            <strong>{item.name}</strong>
                            {item.context && <small>{item.context}</small>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No matches</p>
                  )}
                </section>
              ),
            )}
          </section>
          <aside className="ns-saved-views">
            <h2>Personal saved views</h2>
            {views.length ? (
              <ul>
                {views.map((view) => (
                  <li key={view.id}>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          `/${view.resource}?${new URLSearchParams(view.definition)}`,
                        )
                      }
                    >
                      {view.name}
                      <small>{view.resource}</small>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${view.name}`}
                      onClick={() => void remove(view.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Your reusable list filters will appear here.</p>
            )}
          </aside>
        </div>
      )}
      <Dialog
        open={dialog}
        title="Save personal view"
        description="Only you can see this saved filter."
        onClose={() => setDialog(false)}
      >
        <form onSubmit={save}>
          <Field label="View name" required>
            <TextInput name="name" required maxLength={80} />
          </Field>
          <Field label="List">
            <Select name="resource">
              <option value="companies">Companies</option>
              <option value="contacts">Contacts</option>
              <option value="deals">Deals</option>
              <option value="tasks">Tasks</option>
            </Select>
          </Field>
          <div className="ns-dialog-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setDialog(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Save view</Button>
          </div>
        </form>
      </Dialog>
      {message && (
        <ToastRegion>
          <Toast
            tone={message === "View saved" ? "success" : "error"}
            title={message}
            onDismiss={() => setMessage("")}
          />
        </ToastRegion>
      )}
    </>
  );
}
