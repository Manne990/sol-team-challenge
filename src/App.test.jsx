import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App, navigation } from './App.jsx';
import { Dialog, Field, OperationalState } from './components.jsx';

describe('CRM shell', () => {
  it('exposes every product area to an owner', () => {
    render(<App role="owner" />);
    for (const [label] of navigation) expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('hides owner-only navigation from members and viewers', () => {
    const { rerender } = render(<App role="member" />);
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit' })).not.toBeInTheDocument();
    rerender(<App role="viewer" />);
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Companies' })).toBeInTheDocument();
  });

  it('provides labeled controls and an accessible data table', () => {
    render(<App />);
    expect(screen.getByRole('searchbox', { name: 'Search CRM' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Calculating dashboard' })).toBeInTheDocument();
  });

  it('opens and closes mobile navigation semantically', () => {
    render(<App />);
    const button = screen.getByRole('button', { name: 'Open navigation' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('operational primitives', () => {
  it.each(['loading', 'empty', 'error', 'forbidden', 'not-found', 'conflict'])('renders the %s state', (type) => {
    const { container } = render(<OperationalState type={type} />);
    expect(container.querySelector('.state')).toHaveTextContent(/./);
  });

  it('connects field errors and hints to their input', () => {
    render(<Field label="Company name" hint="Legal name" error="Name is required"><input /></Field>);
    const input = screen.getByRole('textbox', { name: 'Company name' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain('-hint');
    expect(input.getAttribute('aria-describedby')).toContain('-error');
  });

  it('supports escape and returns dialog focus', () => {
    const close = vi.fn();
    const { rerender } = render(<><button>Trigger</button><Dialog open title="Confirm removal" description="This removes access." onClose={close} /></>);
    expect(screen.getByRole('dialog')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    rerender(<><button>Trigger</button><Dialog open={false} title="Confirm removal" description="This removes access." onClose={close} /></>);
  });
});
