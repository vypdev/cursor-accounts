import React from 'react';
import { InstanceInfoMap, Profile, ProfileQuotaMap } from '../types';
import { ProfileCard } from './ProfileCard';

interface ProfileListProps {
  profiles: Profile[];
  currentProfileId?: string;
  quotas: ProfileQuotaMap;
  runningInstances: InstanceInfoMap;
  onLaunch: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onShowInExplorer: (id: string) => void;
  onExport: (profileIds: string[], includeSettings: boolean) => void;
}

export const ProfileList: React.FC<ProfileListProps> = ({
  profiles,
  currentProfileId,
  quotas,
  runningInstances,
  onLaunch,
  onEdit,
  onDelete,
  onShowInExplorer,
  onExport,
}) => {
  return (
    <div className="profile-list-container">
      <div className="list-header">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => onExport(profiles.map((p) => p.id), false)}
          title="Export all profiles"
        >
          Export All
        </button>
      </div>
      <div className="profile-list" role="list">
      {profiles.map((profile) => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          isCurrent={profile.id === currentProfileId}
          quota={quotas[profile.id]}
          isRunning={profile.id in runningInstances}
          onLaunch={onLaunch}
          onEdit={onEdit}
          onDelete={onDelete}
          onShowInExplorer={onShowInExplorer}
        />
      ))}
      </div>
    </div>
  );
};
