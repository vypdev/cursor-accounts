import React from 'react';
import { useL10n } from '../l10n/context';
import type {
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
  profileAccounts: ProfileAccountMap;
  profileWorkspaces: Record<string, WorkspaceInfo[]>;
  profileGithubSummaries: ProfileGithubSummariesMap;
  profileGithubTokenStatus: ProfileGithubTokenStatusMap;
  quotas: ProfileQuotaMap;
  runningInstances: InstanceInfoMap;
  onLaunch: (id: string) => void;
  onOpenProject: (profileId: string, projectPath: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onShowInExplorer: (id: string) => void;
  onExport: (profileIds: string[], includeSettings: boolean) => void;
  onToggleEfficiency: (id: string, enabled: boolean) => void;
  onManageStorage: (id: string) => void;
  onConfigureGithubToken: (id: string) => void;
  onClearGithubToken: (id: string) => void;
}

export const ProfileList: React.FC<ProfileListProps> = ({
  profiles,
  currentProfileId,
  profileAccounts,
  profileWorkspaces,
  profileGithubSummaries,
  profileGithubTokenStatus,
  quotas,
  runningInstances,
  onLaunch,
  onOpenProject,
  onEdit,
  onDelete,
  onShowInExplorer,
  onExport,
  onToggleEfficiency,
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
          account={profileAccounts[profile.id]}
          workspaces={profileWorkspaces[profile.id] ?? []}
          repoSummaries={profileGithubSummaries[profile.id] ?? {}}
          githubTokenStatus={
            profileGithubTokenStatus[profile.id] ?? 'not_configured'
          }
          quota={quotas[profile.id]}
          isRunning={profile.id in runningInstances}
          onLaunch={onLaunch}
          onOpenProject={onOpenProject}
          onEdit={onEdit}
          onDelete={onDelete}
          onShowInExplorer={onShowInExplorer}
          onToggleEfficiency={onToggleEfficiency}
          onManageStorage={onManageStorage}
          onConfigureGithubToken={onConfigureGithubToken}
          onClearGithubToken={onClearGithubToken}
        />
      ))}
      </div>
    </div>
  );
};
