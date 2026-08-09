import React from "react";

export function Button({ variant = "primary", className = "", ...props }) {
  return (
    <button
      className={`ns-button ns-button-${variant === "quiet" ? "quiet" : variant} ${className}`}
      {...props}
    />
  );
}

export function DataTable({ caption, columns, rows }) {
  return (
    <div
      className="ns-table-wrap"
      tabIndex="0"
      role="region"
      aria-label={`${caption}, scrollable`}
    >
      <table className="ns-table">
        <caption className="ns-sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.key} data-label={column.label}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OperationalState({ type, action }) {
  const copy = {
    loading: ["Loading", "Fetching tasks…"],
    empty: ["No tasks found", "Adjust the filters or add a task."],
    forbidden: ["Access restricted", "Your role cannot access these tasks."],
    error: ["Tasks could not be loaded", "Try again."],
  }[type] ?? ["Tasks unavailable", "Try again."];
  return (
    <section
      className={`ns-state ns-state-${type}`}
      role={type === "error" ? "alert" : undefined}
    >
      <h2>{copy[0]}</h2>
      <p>{copy[1]}</p>
      {action}
    </section>
  );
}

export function ToastRegion({ messages, onDismiss }) {
  return (
    <div className="ns-toast-region" aria-live="polite">
      {messages.map((message) => (
        <div className="ns-toast" key={message.id}>
          {message.message}
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={onDismiss}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
