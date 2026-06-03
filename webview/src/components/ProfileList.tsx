import React from 'react';
import { useL10n } from '../l10n/context';
import type {
  EfficiencyStatsMap,
  InstanceInfoMap,
  Profile,
  ProfileAccountMap,
  ProfileGithubSummariesMap,
  ProfileGithubTokenStatusMap,
  ProfileQuotaMap,
  WorkspaceInfo,
} from '../types';
import { ProfileCard } from './ProfileCard';

interface ProfileListProps {
  profiles: Profile[];
  currentProfileId?: string;
  hasOpenWorkspaceInSession: boolean;
  profileAccounts: ProfileAccountMap;
  profileWorkspaces: Record<string, WorkspaceInfo[]>;
  profileGithubSummaries: ProfileGithubSummariesMap;
  profileGithubTokenStatus: ProfileGithubTokenStatusMap;
  quotas: ProfileQuotaMap;
  efficiencyStats: EfficiencyStatsMap;
  runningInstances: InstanceInfoMap;
  profileProxyTemporary: Record<string, boolean>;
  showProxyIndicators: boolean;
  onLaunch: (id: string) => void;
  onOpenProject: (profileId: string, projectPath: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onShowInExplorer: (id: string) => void;
  onExport: (profileIds: string[], includeSettings: boolean) => void;
  onManageStorage: (id: string) => void;
  onConfigureGithubToken: (id: string) => void;
  onClearGithubToken: (id: string) => void;
}

export const ProfileList: React.FC<ProfileListProps> = ({
  profiles,
  currentProfileId,
  hasOpenWorkspaceInSession,
  profileAccounts,
  profileWorkspaces,
  profileGithubSummaries,
  profileGithubTokenStatus,
  quotas,
  efficiencyStats,
  runningInstances,
  profileProxyTemporary,
  showProxyIndicators,
  onLaunch,
  onOpenProject,
  onEdit,
  onDelete,
  onShowInExplorer,
  onExport,
  onManageStorage,
  onConfigureGithubToken,
  onClearGithubToken,
}) => {
  const { t } = useL10n();

  return (
    <div className="profile-list-container">
      <div className="list-header">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => onExport(profiles.map((p) => p.id), false)}
          title={t('profileList.exportAllTitle')}
        >
          {t('profileList.exportAll')}
        </button>
      </div>
      <div className="profile-list" role="list">
      {profiles.map((profile) => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          isCurrent={profile.id === currentProfileId}
          hasOpenWorkspaceInSession={hasOpenWorkspaceInSession}
          account={profileAccounts[profile.id]}
          workspaces={profileWorkspaces[profile.id] ?? []}
          repoSummaries={profileGithubSummaries[profile.id] ?? {}}
          githubTokenStatus={
            profileGithubTokenStatus[profile.id] ?? 'not_configured'
          }
          quota={quotas[profile.id]}
          efficiencyStats={efficiencyStats[profile.id]}
          isRunning={profile.id in runningInstances}
          proxyTemporary={
            showProxyIndicators && profileProxyTemporary[profile.id] === true
          }
          onLaunch={onLaunch}
          onOpenProject={onOpenProject}
          onEdit={onEdit}
          onDelete={onDelete}
          onShowInExplorer={onShowInExplorer}
          onManageStorage={onManageStorage}
          onConfigureGithubToken={onConfigureGithubToken}
          onClearGithubToken={onClearGithubToken}
        />
      ))}
      </div>
    </div>
  );
};
