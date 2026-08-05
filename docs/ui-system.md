# Operational UI system

The shell uses one dense, responsive application frame. Desktop and tablet keep persistent navigation; below 640px it becomes a labeled modal-style drawer. All content columns use `minmax(0, 1fr)`, and tables become labeled record rows at the 390px acceptance viewport, preventing page-level horizontal scrolling.

Reusable primitives live in `src/components.jsx`: buttons, labeled fields, semantic data tables, focus-managed dialogs, live-region toasts, and deliberate loading, empty, validation, forbidden, not-found, conflict, and unexpected-error states. Domain screens should compose these rather than introduce page-specific versions.

Navigation accepts the authenticated role and omits owner-only Audit and Administration destinations for members and viewers. This is a presentation rule only; the server remains responsible for authorization.

Colors maintain at least WCAG AA contrast for normal text. Every interactive control has a visible keyboard focus ring, mobile navigation exposes expanded state, dialogs trap focus and close on Escape, animations respect reduced-motion preferences, and inputs pair visible labels with hints/errors through accessible descriptions.
