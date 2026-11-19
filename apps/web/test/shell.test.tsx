import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../src/router.js';

describe('app shell', () => {
  it('renders sidebar navigation and redirects / to the Inbox', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const label of ['Inbox', 'Pipeline', 'CVs', 'Settings', 'Runs']) {
      expect(nav).toHaveTextContent(label);
    }
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
  });
});
