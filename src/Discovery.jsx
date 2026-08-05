import React, { useEffect, useState } from "react";
import { Button } from "./components.jsx";

async function request(path, options) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (response.status === 204) return {};
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body?.error?.message || "Could not complete the request.");
  return body;
}

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState({ status: "idle", groups: {} });
  useEffect(() => {
    if (query.trim().length < 2) {
      setState({ status: "idle", groups: {} });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState((value) => ({ ...value, status: "loading" }));
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
        credentials: "same-origin",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Search is unavailable.");
          return response.json();
        })
        .then((body) => setState({ status: "ready", groups: body.groups }))
        .catch((error) => {
          if (error.name !== "AbortError")
            setState({ status: "error", groups: {} });
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  const href = (resource, item) =>
    resource === "companies" || resource === "deals"
      ? `#${resource}/${item.id}`
      : `#${resource}?q=${encodeURIComponent(item.name)}`;
  const count = Object.values(state.groups).reduce(
    (sum, items) => sum + items.length,
    0,
  );
  return (
    <div className="global-search discovery-search">
      <label>
        <span className="sr-only">Search CRM</span>
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search companies, contacts, deals…"
          aria-controls={
            query.trim().length >= 2 ? "global-search-results" : undefined
          }
        />
      </label>
      {query.trim().length >= 2 && (
        <div
          className="search-results"
          id="global-search-results"
          role="region"
          aria-label="Search results"
        >
          {state.status === "loading" ? (
            <p role="status">Searching…</p>
          ) : state.status === "error" ? (
            <p role="alert">Search is temporarily unavailable.</p>
          ) : state.status === "ready" && count === 0 ? (
            <p>No matching CRM records.</p>
          ) : (
            Object.entries(state.groups).map(
              ([resource, items]) =>
                items.length > 0 && (
                  <section key={resource}>
                    <h2>{resource}</h2>
                    <ul>
                      {items.map((item) => (
                        <li key={item.id}>
                          <a
                            href={href(resource, item)}
                            onClick={() => setQuery("")}
                          >
                            <strong>{item.name}</strong>
                            <small>{item.context || ""}</small>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                ),
            )
          )}
        </div>
      )}
    </div>
  );
}

export function SavedViews({ resource, definition, onApply }) {
  const [views, setViews] = useState([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const load = () =>
    request(`/api/views?resource=${resource}`)
      .then((body) => setViews(Array.isArray(body.views) ? body.views : []))
      .catch((failure) => setError(failure.message));
  useEffect(() => {
    load();
  }, [resource]);
  const current = views.find((view) => view.id === selected);
  async function create() {
    const name = window.prompt("Name this personal view");
    if (!name) return;
    try {
      const body = await request("/api/views", {
        method: "POST",
        body: JSON.stringify({ resource, name, definition }),
      });
      await load();
      setSelected(body.view.id);
    } catch (failure) {
      setError(failure.message);
    }
  }
  async function update(rename = false) {
    if (!current) return;
    const name = rename
      ? window.prompt("Rename this view", current.name)
      : current.name;
    if (!name) return;
    try {
      await request(`/api/views/${current.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name,
          definition: rename ? current.definition : definition,
          version: current.version,
        }),
      });
      await load();
    } catch (failure) {
      setError(failure.message);
    }
  }
  async function remove() {
    if (!current || !window.confirm(`Delete personal view “${current.name}”?`))
      return;
    try {
      await request(`/api/views/${current.id}`, { method: "DELETE" });
      setSelected("");
      await load();
    } catch (failure) {
      setError(failure.message);
    }
  }
  return (
    <div className="saved-views" aria-label={`${resource} saved views`}>
      <label>
        Personal view{" "}
        <select
          value={selected}
          onChange={(event) => {
            const id = event.target.value;
            setSelected(id);
            const view = views.find((item) => item.id === id);
            if (view) onApply(view.definition);
          }}
        >
          <option value="">Current filters</option>
          {views.map((view) => (
            <option value={view.id} key={view.id}>
              {view.name}
            </option>
          ))}
        </select>
      </label>
      <Button variant="quiet" onClick={create}>
        Save new
      </Button>
      {current && (
        <>
          <Button variant="quiet" onClick={() => update(false)}>
            Update
          </Button>
          <Button variant="quiet" onClick={() => update(true)}>
            Rename
          </Button>
          <Button variant="quiet" onClick={remove}>
            Delete
          </Button>
        </>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
