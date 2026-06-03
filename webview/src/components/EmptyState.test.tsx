import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from './EmptyState';
import { L10nProvider } from '../l10n/context';

const messages = {
  'emptyState.title': 'No profiles yet',
  'emptyState.description': 'Add a profile to get started.',
  'emptyState.button': 'Add profile',
};

describe('EmptyState', () => {
  it('renders title and calls onAddProfile when button is clicked', () => {
    const onAddProfile = vi.fn();

    render(
      <L10nProvider locale="en" messages={messages}>
        <EmptyState onAddProfile={onAddProfile} />
      </L10nProvider>
    );

    expect(screen.getByRole('heading', { name: 'No profiles yet' })).toBeInTheDocument();
    expect(screen.getByText('Add a profile to get started.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }));
    expect(onAddProfile).toHaveBeenCalledOnce();
  });
});
