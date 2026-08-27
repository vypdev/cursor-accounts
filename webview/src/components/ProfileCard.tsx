import React, { useState } from 'react';
import type {
  EfficiencyStats,
  GitHubRepoSummary,
  Profile,
  ProfileAccountView,
  ProfileGithubTokenStatus,
  ProfileQuota,
  WorkspaceInfo,
} from '../types';
import { getQuotaStatus, isEnterpriseUsage } from '../types';
import { ProfileCardActions } from './ProfileCardActions';
import { ProfileCardEfficiency } from './ProfileCardEfficiency';
import { ProfileCardIdentity } from './ProfileCardIdentity';
import { ProfileCardLeaderboard } from './ProfileCardLeaderboard';
import { ProfileCardQuota } from './ProfileCardQuota';
import { ProfileCardWorkspaces } from './ProfileCardWorkspaces';

interface ProfileCardProps {
  profile: Profile;
  isCurrent: boolean;
  hasOpenWorkspaceInSession: boolean;
  account?: ProfileAccountView;
  workspaces?: WorkspaceInfo[];
  repoSummaries?: Record<string, GitHubRepoSummary>;
  githubTokenStatus?: ProfileGithubTokenStatus;
  quota?: ProfileQuota;
  isRunning: boolean;
  proxyTemporary?: boolean;
  onLaunch: (id: string) => void;
  onOpenProject: (profileId: string, projectPath: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onShowInExplorer: (id: string) => void;
  onManageStorage: (id: string) => void;
  onConfigureGithubToken: (id: string) => void;
  onClearGithubToken: (id: string) => void;
  efficiencyStats?: EfficiencyStats;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({
  profile,
  isCurrent,
  hasOpenWorkspaceInSession,
  account,
  workspaces = [],
  repoSummaries = {},
  githubTokenStatus = 'not_configured',
  quota,
  isRunning,
  proxyTemporary = false,
  onLaunch,
  onOpenProject,
  onEdit,
  onDelete,
  onShowInExplorer,
  onManageStorage,
  onConfigureGithubToken,
  onClearGithubToken,
  efficiencyStats,
}) => {
  const [leaderboardExpanded, setLeaderboardExpanded] = useState(false);
  const [quotaExpanded, setQuotaExpanded] = useState(false);

  const quotaStatus = quota?.quota ? getQuotaStatus(quota.quota) : 'unavailable';
  const leaderboardEntries = isEnterpriseUsage(quota?.quota)
    ? quota?.activityLeaderboard?.entries ?? []
    : [];

  React.useEffect(() => {
    setLeaderboardExpanded(false);
    setQuotaExpanded(false);
  }, [profile.id]);

  const borderColor = profile.color ?? 'var(--vscode-button-background)';

  return (
    <div
      className={`profile-card ${isCurrent ? 'current' : ''} ${isRunning ? 'running' : ''} quota-${quotaStatus}`}
      style={{ borderLeftColor: borderColor }}
      role="listitem"
    >
      <ProfileCardIdentity
        profile={profile}
        isCurrent={isCurrent}
        hasOpenWorkspaceInSession={hasOpenWorkspaceInSession}
        account={account}
        quota={quota}
        isRunning={isRunning}
        proxyTemporary={proxyTemporary}
      />

      <ProfileCardQuota
        quota={quota}
        expanded={quotaExpanded}
        onToggleExpanded={() => setQuotaExpanded((expanded) => !expanded)}
        onLaunch={() => onLaunch(profile.id)}
      />

      <ProfileCardLeaderboard
        entries={leaderboardEntries}
        profileEmail={profile.email}
        expanded={leaderboardExpanded}
        onToggleExpanded={() =>
          setLeaderboardExpanded((expanded) => !expanded)
        }
      />

      <ProfileCardEfficiency
        key={profile.id}
        enabled={Boolean(profile.efficiencyAnalysisEnabled)}
        stats={efficiencyStats}
        workspaces={workspaces}
      />

      <ProfileCardWorkspaces
        profile={profile}
        workspaces={workspaces}
        repoSummaries={repoSummaries}
        githubTokenStatus={githubTokenStatus}
        onOpenProject={(projectPath) => onOpenProject(profile.id, projectPath)}
        onConfigureGithubToken={() => onConfigureGithubToken(profile.id)}
        onClearGithubToken={() => onClearGithubToken(profile.id)}
      />

      <ProfileCardActions
        profile={profile}
        isCurrent={isCurrent}
        isRunning={isRunning}
        onLaunch={() => onLaunch(profile.id)}
        onEdit={() => onEdit(profile.id)}
        onDelete={() => onDelete(profile.id)}
        onShowInExplorer={() => onShowInExplorer(profile.id)}
        onManageStorage={() => onManageStorage(profile.id)}
      />
    </div>
  );
};
