import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Profile } from '../types';
import { ProfileList } from './ProfileList';

vi.mock('./ProfileCard', () => ({
  ProfileCard: ({
    profile,
    isCurrent,
    isRunning,
    proxyTemporary,
    onLaunch,
  }: {
    profile: Profile;
    isCurrent: boolean;
    isRunning: boolean;
    proxyTemporary: boolean;
    onLaunch: (profileId: string) => void;
  }) => (
    <div role="listitem" data-testid={`profile-card-${profile.id}`}>
      <span>{`${profile.id}:${isCurrent}:${isRunning}:${proxyTemporary}`}</span>
      <button type="button" onClick={() => onLaunch(profile.id)}>
        launch
      </button>
    </div>
  ),
}));

const profiles: Profile[] = [
  {
    id: 'profile-1',
    email: 'one@example.com',
    slug: 'one-example-com',
    displayName: 'One',
    userDataDir: '/tmp/profile-1',
    created: '2026-08-26T00:00:00.000Z',
  },
  {
    id: 'profile-2',
    email: 'two@example.com',
    slug: 'two-example-com',
    displayName: 'Two',
    userDataDir: '/tmp/profile-2',
    created: '2026-08-26T00:00:00.000Z',
  },
];

describe('ProfileList', () => {
  it('maps profile state into cards and exports all profiles', () => {
    const onExport = vi.fn();
    const onLaunch = vi.fn();

    render(
      <ProfileList
        profiles={profiles}
        currentProfileId="profile-1"
        hasOpenWorkspaceInSession={true}
        profileAccounts={{}}
        profileWorkspaces={{}}
        profileGithubSummaries={{}}
        profileGithubTokenStatus={{}}
        quotas={{}}
        efficiencyStats={{}}
        runningInstances={{
          instance: {
            profileId: 'profile-1',
            pid: 123,
            userDataDir: '/tmp/profile-1',
            detectedAt: Date.now(),
          },
        }}
        profileProxyTemporary={{ 'profile-1': true }}
        showProxyIndicators={true}
        onLaunch={onLaunch}
        onOpenProject={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onShowInExplorer={vi.fn()}
        onExport={onExport}
        onManageStorage={vi.fn()}
        onConfigureGithubToken={vi.fn()}
        onClearGithubToken={vi.fn()}
      />
    );

    expect(screen.getByRole('list')).toHaveClass('profile-list');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('profile-1:true:true:true')).toBeInTheDocument();
    expect(screen.getByText('profile-2:false:false:false')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('profileList.exportAllTitle'));
    fireEvent.click(screen.getAllByRole('button', { name: 'launch' })[1]!);

    expect(onExport).toHaveBeenCalledWith(['profile-1', 'profile-2'], false);
    expect(onLaunch).toHaveBeenCalledWith('profile-2');
  });
});
