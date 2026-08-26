import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Profile } from '../types';
import { EditProfileForm } from './EditProfileForm';

const profile: Profile = {
  id: 'profile-1',
  email: 'user@example.com',
  slug: 'user-example-com',
  displayName: 'User',
  userDataDir: '/tmp/profile-1',
  created: '2026-08-26T00:00:00.000Z',
  theme: 'light',
  color: '#3b82f6',
  emoji: '👤',
  metadata: { notes: 'Initial notes' },
  efficiencyAnalysisEnabled: false,
  proxyEnabled: true,
  proxyJsonlLoggingEnabled: false,
};

describe('EditProfileForm', () => {
  it('updates profile settings and submits a normalized patch', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(
      <EditProfileForm
        profile={profile}
        isCurrent={true}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );

    fireEvent.change(screen.getByLabelText('editProfile.displayNameLabel'), {
      target: { value: ' Updated profile ' },
    });
    fireEvent.click(screen.getByRole('option', { name: '🚀' }));
    fireEvent.change(screen.getByLabelText('editProfile.themeLabel'), {
      target: { value: 'dark' },
    });
    fireEvent.change(screen.getByLabelText('editProfile.colorLabel'), {
      target: { value: '#ff0000' },
    });
    fireEvent.change(screen.getByLabelText('editProfile.notesLabel'), {
      target: { value: ' Updated notes ' },
    });
    fireEvent.click(screen.getByLabelText('editProfile.proxyJsonlLabel'));
    fireEvent.click(screen.getByLabelText('editProfile.efficiencyLabel'));
    fireEvent.click(screen.getByRole('button', { name: 'editProfile.save' }));

    expect(onSubmit).toHaveBeenCalledWith({
      displayName: 'Updated profile',
      theme: 'dark',
      color: '#ff0000',
      emoji: '🚀',
      metadata: { notes: 'Updated notes' },
      proxyEnabled: true,
      proxyJsonlLoggingEnabled: true,
      efficiencyAnalysisEnabled: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'editProfile.cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('clears dependent proxy logging when proxy support is disabled', () => {
    const onSubmit = vi.fn();

    render(
      <EditProfileForm
        profile={{ ...profile, proxyJsonlLoggingEnabled: true }}
        isCurrent={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText('editProfile.proxyLabel'));
    fireEvent.click(screen.getByRole('button', { name: 'editProfile.save' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyEnabled: false,
        proxyJsonlLoggingEnabled: false,
      })
    );
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty(
      'efficiencyAnalysisEnabled'
    );
  });
});
