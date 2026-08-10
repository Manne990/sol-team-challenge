import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="ns-page-header">
      <div>
        {eyebrow && <span className="ns-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ns-page-actions">{actions}</div>}
    </header>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "quiet";
}) {
  return (
    <button
      className={`ns-button ns-button-${variant} ${className}`.trim()}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`ns-field${error ? " has-error" : ""}`}>
      <span>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {children}
      {error ? (
        <small className="ns-field-error">{error}</small>
      ) : hint ? (
        <small>{hint}</small>
      ) : null}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="ns-input" {...props} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="ns-select" {...props} />;
}

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "positive" | "warning" | "danger" | "info";
  children: ReactNode;
}) {
  return <span className={`ns-badge ns-badge-${tone}`}>{children}</span>;
}

export function FilterBar({
  children,
  activeCount = 0,
  onClear,
}: {
  children: ReactNode;
  activeCount?: number;
  onClear?: () => void;
}) {
  return (
    <section className="ns-filter-bar" aria-label="Filters">
      <div className="ns-filter-fields">{children}</div>
      {activeCount > 0 && (
        <Button variant="quiet" type="button" onClick={onClear}>
          Clear all <span className="ns-count">{activeCount}</span>
        </Button>
      )}
    </section>
  );
}

export function DataTable({
  caption,
  columns,
  children,
}: {
  caption: string;
  columns: string[];
  children: ReactNode;
}) {
  return (
    <div
      className="ns-table-wrap"
      tabIndex={0}
      role="region"
      aria-label={`${caption}, scrollable`}
    >
      <table className="ns-table">
        <caption className="ns-sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <nav className="ns-pagination" aria-label="Pagination">
      <Button
        variant="secondary"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <span>
        Page <strong>{page}</strong> of {Math.max(totalPages, 1)}
      </span>
      <Button
        variant="secondary"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

type StateKind =
  "loading" | "empty" | "error" | "forbidden" | "not-found" | "conflict";
const stateDefaults: Record<StateKind, { title: string; message: string }> = {
  loading: { title: "Loading", message: "Fetching the latest information…" },
  empty: {
    title: "Nothing here yet",
    message: "Records will appear here when they are added.",
  },
  error: {
    title: "Something went wrong",
    message: "We couldn’t load this information. Try again.",
  },
  forbidden: {
    title: "Access restricted",
    message: "Your role does not allow access to this area.",
  },
  "not-found": {
    title: "Record not found",
    message: "It may have been removed, or the link may be incorrect.",
  },
  conflict: {
    title: "Changes need review",
    message:
      "Someone else updated this record. Refresh and compare before saving again.",
  },
};
export function OperationalState({
  kind,
  title,
  message,
  action,
}: {
  kind: StateKind;
  title?: string;
  message?: string;
  action?: ReactNode;
}) {
  const copy = stateDefaults[kind];
  return (
    <section
      className={`ns-state ns-state-${kind}`}
      aria-live={kind === "loading" ? "polite" : undefined}
      role={kind === "error" ? "alert" : undefined}
    >
      <span className="ns-state-icon" aria-hidden="true">
        {kind === "loading" ? (
          <span className="ns-spinner" />
        ) : kind === "empty" ? (
          "＋"
        ) : kind === "conflict" ? (
          "↻"
        ) : (
          "!"
        )}
      </span>
      <h2>{title ?? copy.title}</h2>
      <p>{message ?? copy.message}</p>
      {action}
    </section>
  );
}

export function Dialog({
  open,
  title,
  description,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement;
    const focusable = panel.current?.querySelector<HTMLElement>(
      "button, input, select, textarea, [href], [tabindex]:not([tabindex='-1'])",
    );
    focusable?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panel.current) return;
      const items = [
        ...panel.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
        ),
      ];
      if (!items.length) return;
      const first = items[0]!;
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    document.body.classList.add("ns-dialog-open");
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.classList.remove("ns-dialog-open");
      previousFocus.current?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="ns-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="ns-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button
            className="ns-icon-button"
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  consequences,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  consequences: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConfirm();
  };
  return (
    <Dialog
      open={open}
      title={title}
      description={consequences}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="ns-dialog-actions">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} type="submit">
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ToastRegion({ children }: { children: ReactNode }) {
  return (
    <div className="ns-toast-region" aria-live="polite" aria-atomic="true">
      {children}
    </div>
  );
}
export function Toast({
  tone = "success",
  title,
  message,
  onDismiss,
}: {
  tone?: "success" | "error";
  title: string;
  message?: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={`ns-toast ns-toast-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <div>
        <strong>{title}</strong>
        {message && <p>{message}</p>}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={onDismiss}
        >
          ×
        </button>
      )}
    </div>
  );
}
