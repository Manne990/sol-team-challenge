import React, { useEffect, useId, useRef } from "react";

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

export function OperationalState({ type, title, message, action }) {
  const copy = {
    loading: ["Loading", "Fetching the latest information…"],
    empty: ["Nothing here yet", "Adjust filters or add the first record."],
    forbidden: ["Access restricted", "Your role cannot access this view."],
    error: ["We couldn’t load this view", "Try again."],
    "not-found": [
      "Record not found",
      "It may have been archived or the link may be incorrect.",
    ],
    conflict: [
      "This record changed",
      "Review the latest version before saving again.",
    ],
  }[type] ?? ["Tasks unavailable", "Try again."];
  return (
    <section
      className={`ns-state ns-state-${type}`}
      role={type === "error" ? "alert" : undefined}
    >
      <h2>{title ?? copy[0]}</h2>
      <p>{message ?? copy[1]}</p>
      {action}
    </section>
  );
}

export function Dialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  onConfirm,
  onClose,
  children,
}) {
  const panel = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    panel.current?.focus();
    const keydown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose?.()
      }
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panel}
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        {description && <p>{description}</p>}
        {children}
        <div className="dialog__actions">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
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
