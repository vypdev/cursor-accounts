import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type {
  EfficiencyStats,
  GitHubRepoSummary,
  Profile,
  ProfileQuota,
  WorkspaceInfo,
} from '../types';
import { ProfileCard } from './ProfileCard';

const profile: Profile = {
  id: 'profile-1',
  email: 'user@example.com',
  slug: 'user-example-com',
  displayName: 'User',
  userDataDir: '/tmp/profile-1',
  created: '2026-08-26T00:00:00.000Z',
};

const quotaData = {
  totalPercentUsed: 25,
  autoPercentUsed: 40,
  apiPercentUsed: 10,
  totalSpend: 750,
  includedSpend: 1_000,
  remaining: 250,
  limit: 2_000,
  billingCycleStart: '2026-08-01',
  billingCycleEnd: '2026-09-01',
  fetchedAt: 0,
} satisfies NonNullable<ProfileQuota['quota']>;

const workspace: WorkspaceInfo = {
  name: 'Cursor Accounts',
  path: '/work/cursor-accounts',
  lastModified: '2026-08-26T00:00:00.000Z',
  storageHash: 'workspace-hash',
};

const callbacks = {
  onLaunch: vi.fn(),
  onOpenProject: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onShowInExplorer: vi.fn(),
  onManageStorage: vi.fn(),
  onConfigureGithubToken: vi.fn(),
  onClearGithubToken: vi.fn(),
};

function renderCard(
  overrides: Partial<ComponentProps<typeof ProfileCard>> = {}
) {
  return render(
    <ProfileCard
      profile={profile}
      isCurrent={false}
      hasOpenWorkspaceInSession={true}
      isRunning={false}
      {...callbacks}
      {...overrides}
    />
  );
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('ProfileCard', () => {
  it('renders current and fallback identity states without requiring account data', () => {
    renderCard({ isCurrent: true, hasOpenWorkspaceInSession: false });

    expect(screen.getByRole('listitem')).toHaveClass('current');
    expect(screen.getByText('profileCard.noProjectOpen')).toBeInTheDocument();
    expect(screen.getByText('U')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'profileCard.currentWindow' })
    ).toBeDisabled();
  });

  it('offers sign-in for authentication quota failures and launches the profile', () => {
    renderCard({
      quota: {
        profileId: profile.id,
        quota: null,
        error: 'Authentication expired',
        fetchedAt: 0,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'profileCard.signIn' }));
    expect(callbacks.onLaunch).toHaveBeenCalledWith(profile.id);
  });

  it('expands personal quota details and clamps the rendered progress bars', () => {
    const { container } = renderCard({
      quota: { profileId: profile.id, quota: quotaData, fetchedAt: 0 },
    });

    const quotaToggle = container.querySelector('.quota-toggle');
    expect(quotaToggle).not.toBeNull();
    fireEvent.click(quotaToggle as HTMLElement);

    expect(
      container.querySelectorAll('.quota-bars-expanded .quota-bar-row')
    ).toHaveLength(2);
    expect(container.querySelector('.quota-fill')?.getAttribute('style')).toContain(
      'width: 25%'
    );
  });

  it('routes workspace and GitHub actions through the profile id boundary', () => {
    const summary: GitHubRepoSummary = {
      storageHash: workspace.storageHash,
      fullName: 'owner/cursor-accounts',
      visibility: 'public',
      branchCount: 2,
      openIssueCount: 1,
      openPullRequestCount: 1,
      commits: [
        {
          sha: 'abc',
          message: 'Improve test coverage',
          date: '2026-08-26T00:00:00.000Z',
        },
      ],
    };

    renderCard({
      workspaces: [workspace],
      repoSummaries: { [workspace.storageHash]: summary },
      githubTokenStatus: 'configured',
      profile: { ...profile, githubTokenPath: '/tmp/token' },
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'profileCard.openProject' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'profileCard.configureGithubToken' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'profileCard.clearGithubToken' })
    );

    expect(callbacks.onOpenProject).toHaveBeenCalledWith(
      profile.id,
      workspace.path
    );
    expect(callbacks.onConfigureGithubToken).toHaveBeenCalledWith(profile.id);
    expect(callbacks.onClearGithubToken).toHaveBeenCalledWith(profile.id);
    expect(screen.getByText('owner/cursor-accounts')).toBeInTheDocument();
  });

  it('keeps menu actions explicit and confirms deletion before invoking the host', () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    renderCard();

    fireEvent.click(
      screen.getByRole('button', { name: 'profileCard.profileActions' })
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'profileCard.edit' }));
    expect(callbacks.onEdit).toHaveBeenCalledWith(profile.id);

    fireEvent.click(
      screen.getByRole('button', { name: 'profileCard.profileActions' })
    );
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'profileCard.delete' })
    );
    expect(callbacks.onDelete).toHaveBeenCalledWith(profile.id);
  });

  it('renders and expands repository and branch efficiency breakdowns', () => {
    const efficiencyStats: EfficiencyStats = {
      profileId: profile.id,
      totalPrompts: 10,
      efficientPrompts: 8,
      inefficientPrompts: 2,
      lastUpdated: '2026-08-26T00:00:00.000Z',
      byRepository: {
        [workspace.path]: {
          repositoryPath: workspace.path,
          totalPrompts: 10,
          efficientPrompts: 8,
          inefficientPrompts: 2,
          lastAnalyzed: '2026-08-26T00:00:00.000Z',
          byBranch: {
            main: {
              branchName: 'main',
              totalPrompts: 10,
              efficientPrompts: 8,
              inefficientPrompts: 2,
              lastAnalyzed: '2026-08-26T00:00:00.000Z',
            },
          },
        },
      },
    };

    renderCard({
      profile: { ...profile, efficiencyAnalysisEnabled: true },
      workspaces: [workspace],
      efficiencyStats,
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'profileCard.efficiencyByRepository',
      })
    );
    expect(screen.getAllByText('Cursor Accounts').length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole('button', { name: 'profileCard.efficiencyByBranch' })
    );
    expect(screen.getByText('main')).toBeInTheDocument();
  });
});
