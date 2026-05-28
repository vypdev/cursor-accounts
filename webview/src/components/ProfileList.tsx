import React from 'react';
import { Profile } from '../types';
import { ProfileCard } from './ProfileCard';

interface ProfileListProps {
  profiles: Profile[];
  currentProfileId?: string;
  onLaunch: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onShowInExplorer: (id: string) => void;
}

export const ProfileList: React.FC<ProfileListProps> = ({
  profiles,
  currentProfileId,
  onLaunch,
  onEdit,
  onDelete,
  onShowInExplorer,
}) => {
  return (
    <div className="profile-list" role="list">
      {profiles.map((profile) => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          isCurrent={profile.id === currentProfileId}
          onLaunch={onLaunch}
          onEdit={onEdit}
          onDelete={onDelete}
          onShowInExplorer={onShowInExplorer}
        />
      ))}
    </div>
  );
};
