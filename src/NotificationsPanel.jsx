import React, { useEffect, useRef, useState } from "react";

async function api(path, options) {
  const response = await fetch(path, { credentials: "same-origin", headers: { "content-type": "application/json" }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || "Notifications are unavailable.");
  return body;
}

export function NotificationsPanel() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [state, setState] = useState({ status: "loading", items: [], unread: 0 });
  const panel = useRef(null);
  const load = async () => {
    try { setState({ status: "ready", ...(await api(`/api/notifications${filter === "unread" ? "?unread=true" : ""}`)) }); }
    catch { setState((current) => ({ ...current, status: "error" })); }
  };
  useEffect(() => { load(); }, [filter]);
  useEffect(() => { if (open) load(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event) => { if (!panel.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  async function read(notification) {
    if (!notification.readAt) await api(`/api/notifications/${notification.id}/read`, { method: "POST", body: "{}" });
    setOpen(false);
    if (notification.href) location.hash = notification.href.slice(1);
    await load();
  }
  async function readAll() { await api("/api/notifications/read-all", { method: "POST", body: "{}" }); await load(); }
  return <div className="notification-center" ref={panel}>
    <button className="icon-button" aria-label={`Notifications${state.unread ? `, ${state.unread} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      ♢{state.unread > 0 && <span className="notification-dot"><span className="sr-only">{state.unread} unread</span></span>}
    </button>
    {open && <section className="notification-panel" aria-label="Notifications panel">
      <div className="notification-panel__heading"><h2>Notifications</h2><button onClick={readAll} disabled={!state.unread}>Mark all read</button></div>
      <div className="notification-tabs" role="group" aria-label="Notification filter"><button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button><button aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>Unread</button></div>
      {state.status === "loading" ? <p role="status">Loading notifications…</p> : state.status === "error" ? <div role="alert">Notifications could not be loaded. <button onClick={load}>Try again</button></div> : state.items.length === 0 ? <p>No notifications here.</p> :
        <ul className="notification-list">{state.items.map((item) => <li className={item.readAt ? "" : "unread"} key={item.id}><button onClick={() => read(item)}><strong>{item.title}</strong><span>{item.body}</span><small>{new Date(item.createdAt).toLocaleString(undefined, { timeZone: "UTC" })} UTC{!item.href ? " · Related record unavailable" : ""}</small></button></li>)}</ul>}
    </section>}
  </div>;
}
