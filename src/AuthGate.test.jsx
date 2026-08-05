import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate.jsx';

afterEach(() => vi.unstubAllGlobals());

describe('authentication flow', () => {
  it('shows a keyboard-usable sign-in after an anonymous session check', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    render(<AuthGate>{() => <p>Workspace</p>}</AuthGate>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByRole('heading', { name: 'Sign in to Northstar' })).toBeVisible();
    expect(screen.getByLabelText('Email address')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('keeps generic credential failures actionable and permits retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'Email or password is incorrect.' } }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthGate>{() => <p>Workspace</p>}</AuthGate>);
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'missing@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
  });
});
