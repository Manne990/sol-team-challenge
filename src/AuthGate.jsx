import React, { useEffect, useState } from 'react';

function SignIn({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ email, password }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || 'Email or password is incorrect.');
      onSignedIn(body.user);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Sign-in failed. Try again.'); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><section className="auth-panel" aria-labelledby="sign-in-title">
    <div className="auth-brand" aria-label="Northstar CRM"><span aria-hidden="true">✦</span> Northstar</div>
    <p className="eyebrow">Secure workspace</p><h1 id="sign-in-title">Sign in to Northstar</h1><p>Use your organization account to continue.</p>
    {error && <div className="auth-error" role="alert">{error}</div>}
    <form onSubmit={submit}>
      <label className="field"><span>Email address</span><input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></label>
      <label className="field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>
      <button className="button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </section></main>;
}

export function AuthGate({ children }) {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/session', { credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => response.status === 204 ? { status: 'anonymous' } : response.ok ? { status: 'ready', user: (await response.json()).user } : { status: 'anonymous' })
      .then(setState).catch((error) => { if (error.name !== 'AbortError') setState({ status: 'unavailable' }); });
    return () => controller.abort();
  }, []);
  if (state.status === 'loading') return <main className="auth-page"><p role="status">Loading your workspace…</p></main>;
  if (state.status === 'unavailable') return <main className="auth-page"><section className="auth-panel" role="alert"><h1>Northstar is unavailable</h1><p>Check your connection and reload. Your saved CRM data is not affected.</p></section></main>;
  if (state.status === 'anonymous') return <SignIn onSignedIn={(user) => setState({ status: 'ready', user })} />;
  async function signOut() {
    await fetch('/api/auth/session', { method: 'DELETE', credentials: 'same-origin' });
    setState({ status: 'anonymous' });
  }
  return children(state.user, signOut);
}
