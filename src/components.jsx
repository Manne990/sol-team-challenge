import React, { useEffect, useId, useRef } from 'react';

export function Button({ variant = 'primary', className = '', ...props }) {
  return <button className={`button button--${variant} ${className}`} {...props} />;
}

export function Field({ label, hint, error, children }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(children, {
        id,
        'aria-describedby': [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {hint && <span className="field__hint" id={hintId}>{hint}</span>}
      {error && <span className="field__error" id={errorId}>{error}</span>}
    </div>
  );
}

const stateContent = {
  loading: ['Loading records', 'This should only take a moment.'],
  empty: ['No records yet', 'Create the first record to begin building this view.'],
  error: ['We couldn’t load this view', 'Check your connection and try again.'],
  forbidden: ['Access restricted', 'Your role does not allow access to this area.'],
  'not-found': ['Record not found', 'It may have been archived or the link may be incorrect.'],
  conflict: ['This record changed', 'Review the latest version before saving your changes again.'],
};

export function OperationalState({ type, title, message, action }) {
  const content = stateContent[type] || stateContent.error;
  return (
    <section className="state" aria-live={type === 'loading' ? 'polite' : undefined} aria-busy={type === 'loading'}>
      <span className={`state__mark state__mark--${type}`} aria-hidden="true" />
      <div><h2>{title || content[0]}</h2><p>{message || content[1]}</p>{action}</div>
    </section>
  );
}

export function Dialog({ open, title, description, confirmLabel = 'Confirm', destructive, onConfirm, onClose }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    dialogRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
      if (event.key !== 'Tab') return;
      const controls = [...dialogRef.current.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} ref={dialogRef} tabIndex={-1}>
        <h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p>
        <div className="dialog__actions"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button></div>
      </div>
    </div>
  );
}

export function ToastRegion({ messages = [], onDismiss }) {
  return <div className="toasts" aria-live="polite" aria-label="Notifications">{messages.map((item) => <div className={`toast toast--${item.tone || 'success'}`} key={item.id}><span>{item.message}</span><button aria-label="Dismiss notification" onClick={() => onDismiss?.(item.id)}>×</button></div>)}</div>;
}

export function DataTable({ caption, columns, rows, rowKey = 'id' }) {
  return <div className="table-scroll" tabIndex="0" role="region" aria-label={`${caption} table`}><table><caption>{caption}</caption><thead><tr>{columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row[rowKey]}>{columns.map((column) => <td key={column.key} data-label={column.label}>{column.render ? column.render(row) : row[column.key]}</td>)}</tr>)}</tbody></table></div>;
}
