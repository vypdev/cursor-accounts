import React from 'react';
import { useL10n } from '../l10n/context';
import type {
  InstanceInfoMap,
  Profile,
  ProfileAccountMap,
  ProfileQuotaMap,
  WorkspaceInfo,
} from '../types';
import { ProfileCard } from './ProfileCard';

interface ProfileListProps {
  profiles: Profile[];
  currentProfileId?: string;
  profileAccounts: ProfileAccountMap;
  profileWorkspaces: Record<string, WorkspaceInfo[]>;
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
}

export const ProfileList: React.FC<ProfileListProps> = ({
  profiles,
  currentProfileId,
  profileAccounts,
  profileWorkspaces,
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
          quota={quotas[profile.id]}
          isRunning={profile.id in runningInstances}
          onLaunch={onLaunch}
          onOpenProject={onOpenProject}
          onEdit={onEdit}
          onDelete={onDelete}
          onShowInExplorer={onShowInExplorer}
          onToggleEfficiency={onToggleEfficiency}
          onManageStorage={onManageStorage}
        />
      ))}
      </div>
    </div>
  );
};
