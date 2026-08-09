# Northstar interface system

The product shell is intentionally quiet and dense: one persistent navigation
rail, a neutral work canvas, restrained teal actions, compact tables, and no
decorative card nesting. Import `src/client/styles.css` once and consume the
exports from `src/client/components`.

`AppShell` accepts the current role, user and organization labels, current path,
an optional client-router callback, and sign-out callback. Owner-only Audit and
Administration links are filtered in the shell; the server remains responsible
for authorization. Feature pages compose `PageHeader`, `FilterBar`, `DataTable`,
`Pagination`, fields, badges, dialogs, toasts, and `OperationalState` variants.

Breakpoints preserve a fixed rail above 760px and use an accessible drawer below
it. Wide tables scroll inside a labelled region rather than expanding the page.
The system is designed for 1440x900, 1024x768, and 390x844 viewports.

Focus uses a visible amber ring. Dialogs receive focus, trap Tab navigation,
close with Escape, and restore focus. Buttons and navigation maintain at least
38px targets, primary text and action colors meet WCAG AA on their backgrounds,
and reduced-motion and forced-color preferences are respected.
