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

  it('renders non-authentication quota failures without offering sign-in', () => {
    renderCard({
      quota: {
        profileId: profile.id,
        quota: null,
        error: 'Quota service unavailable',
        fetchedAt: 0,
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Quota service unavailable'
    );
    expect(
      screen.queryByRole('button', { name: 'profileCard.signIn' })
    ).not.toBeInTheDocument();
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

  it('renders enterprise spend and expands the activity leaderboard', () => {
    renderCard({
      quota: {
        profileId: profile.id,
        quota: {
          ...quotaData,
          membershipType: 'enterprise',
          limitType: 'team',
          displayMode: 'monthlySpend',
          monthlySpend: 9_000,
          monthlyLimit: 10_000,
          teamMonthlySpend: 5_000,
          teamMonthlyLimit: 10_000,
        },
        activityLeaderboard: {
          entries: [
            {
              rank: 1,
              displayName: 'User',
              email: profile.email,
              composerLinesAccepted: 12_345,
            },
          ],
          periodStart: '2026-08-01',
          periodEnd: '2026-08-31',
          fetchedAt: 0,
        },
        fetchedAt: 0,
      },
    });

    expect(screen.getByText('profileCard.teamBudgetLabel')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /profileCard\.leaderboardPeriod/ })
    );
    expect(screen.getByText('User')).toBeInTheDocument();
  });

  it('renders repository privacy states and avatar fallback after an image error', () => {
    const privateWorkspace = {
      ...workspace,
      storageHash: 'private-hash',
      name: 'Private project',
    };
    const rateLimitedWorkspace = {
      ...workspace,
      storageHash: 'rate-limited-hash',
      name: 'Rate limited project',
    };
    const { container } = renderCard({
      account: {
        profileId: profile.id,
        accountName: 'Account',
        pictureUrl: 'https://example.test/avatar',
        fetchedAt: 0,
      },
      workspaces: [privateWorkspace, rateLimitedWorkspace],
      repoSummaries: {
        [privateWorkspace.storageHash]: {
          storageHash: privateWorkspace.storageHash,
          fullName: 'owner/private-project',
          visibility: 'private',
        },
        [rateLimitedWorkspace.storageHash]: {
          storageHash: rateLimitedWorkspace.storageHash,
          visibility: 'rate_limited',
        },
      },
    });

    expect(screen.getByText('profileCard.privateRepoHint')).toBeInTheDocument();
    expect(screen.getByText('profileCard.rateLimited')).toBeInTheDocument();

    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(screen.getByText('A')).toBeInTheDocument();
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
      screen.getByRole('menuitem', { name: 'profileCard.showInExplorer' })
    );
    expect(callbacks.onShowInExplorer).toHaveBeenCalledWith(profile.id);

    fireEvent.click(
      screen.getByRole('button', { name: 'profileCard.profileActions' })
    );
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'profileCard.manageStorage' })
    );
    expect(callbacks.onManageStorage).toHaveBeenCalledWith(profile.id);

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
