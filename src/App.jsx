import React, { useState } from 'react';
import { Button, DataTable, Dialog, Field, OperationalState, ToastRegion } from './components.jsx';

export const navigation = [
  ['Dashboard', 'dashboard'], ['Companies', 'companies'], ['Contacts', 'contacts'],
  ['Activities', 'activities'], ['Deals', 'deals'], ['Tasks', 'tasks'], ['Imports', 'imports'],
  ['Audit', 'audit', 'owner'], ['Administration', 'administration', 'owner'],
];

const icons = { dashboard: '⌂', companies: '▦', contacts: '♙', activities: '◷', deals: '◇', tasks: '✓', imports: '⇧', audit: '≣', administration: '⚙' };
const rows = [
  { id: 1, company: 'Aster & Co.', owner: 'Maya Chen', stage: 'Proposal', value: '$84,000', activity: '2 hours ago' },
  { id: 2, company: 'Beacon Works', owner: 'Jon Bell', stage: 'Qualified', value: '$41,500', activity: 'Yesterday' },
  { id: 3, company: 'Cedar Systems', owner: 'Maya Chen', stage: 'Discovery', value: '$26,000', activity: '3 days ago' },
];
const columns = [
  { key: 'company', label: 'Company', render: (row) => <a href={`#company-${row.id}`}>{row.company}</a> },
  { key: 'owner', label: 'Owner' }, { key: 'stage', label: 'Stage' }, { key: 'value', label: 'Pipeline value' }, { key: 'activity', label: 'Last activity' },
];

export function App({ role = 'owner', onSignOut }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState([]);
  const visibleNavigation = navigation.filter(([, , requiredRole]) => !requiredRole || role === requiredRole);
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="menu-button" aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen(!menuOpen)}>☰</button>
        <a className="brand" href="#dashboard" aria-label="Northstar CRM dashboard"><span aria-hidden="true">✦</span> Northstar</a>
        <label className="global-search"><span className="sr-only">Search CRM</span><span aria-hidden="true">⌕</span><input type="search" placeholder="Search companies, contacts, deals…" /></label>
        <button className="icon-button" aria-label="View notifications">♢<span className="notification-dot" /></button>
        <button className="profile-button" aria-label={onSignOut ? 'Sign out' : 'Open profile menu'} onClick={onSignOut}><span>MC</span><span className="profile-copy">Maya Chen<small>{onSignOut ? 'Sign out' : role}</small></span></button>
      </header>
      <aside id="primary-navigation" className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`} aria-label="Primary navigation">
        <nav>{visibleNavigation.map(([label, id]) => <a href={`#${id}`} className={id === 'dashboard' ? 'active' : ''} aria-current={id === 'dashboard' ? 'page' : undefined} key={id}><span aria-hidden="true">{icons[id]}</span>{label}</a>)}</nav>
        <div className="workspace"><span>NS</span><div>Northstar Demo<small>Team workspace</small></div></div>
      </aside>
      {menuOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <main id="main-content" className="content">
        <div className="page-heading"><div><p className="eyebrow">Wednesday, 5 August</p><h1>Dashboard</h1><p>Here’s what needs attention across your team.</p></div><Button onClick={() => setDialogOpen(true)}>+ Add company</Button></div>
        <section className="metrics" aria-label="Sales overview">
          {[['Open pipeline', '$428,500', '18 active deals'], ['Closing this month', '$126,000', '5 deals'], ['Overdue tasks', '7', '3 assigned to you'], ['Stale accounts', '12', 'No activity in 30 days']].map(([label, value, detail], index) => <a className={index > 1 ? 'metric metric--alert' : 'metric'} href={index === 2 ? '#tasks?due=overdue' : '#deals'} key={label}><span>{label}</span><strong>{value}</strong><small>{detail} →</small></a>)}
        </section>
        <section className="panel">
          <div className="panel__heading"><div><h2>Pipeline requiring attention</h2><p>Open deals ordered by recent activity</p></div><a href="#deals">View pipeline →</a></div>
          <div className="filters"><label><span className="sr-only">Filter deals</span><input type="search" placeholder="Filter deals…" /></label><label>Stage <select defaultValue="all"><option value="all">All stages</option><option>Discovery</option><option>Proposal</option></select></label><button>Clear filters</button></div>
          <DataTable caption="Deals requiring attention" columns={columns} rows={rows} />
        </section>
        <div className="dashboard-grid">
          <section className="panel"><div className="panel__heading"><div><h2>Create a follow-up</h2><p>Browser and server validation share this language.</p></div></div><form onSubmit={(event) => { event.preventDefault(); setToast([{ id: 1, message: 'Task created successfully.' }]); }}><Field label="Task title" hint="Be specific about the next action."><input required maxLength="120" /></Field><div className="form-actions"><Button type="submit">Create task</Button></div></form></section>
          <section className="panel"><div className="panel__heading"><div><h2>Operational states</h2><p>Deliberate feedback for every outcome</p></div></div><OperationalState type="conflict" action={<Button variant="quiet">Review latest version</Button>} /></section>
        </div>
      </main>
      <Dialog open={dialogOpen} title="Discard unsaved company?" description="The company details entered in this form will be permanently lost." confirmLabel="Discard changes" destructive onClose={() => setDialogOpen(false)} onConfirm={() => setDialogOpen(false)} />
      <ToastRegion messages={toast} onDismiss={() => setToast([])} />
    </div>
  );
}
