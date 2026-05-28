import React from 'react';

interface EmptyStateProps {
  onAddProfile: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onAddProfile }) => {
  return (
    <div className="empty-state">
      <div className="icon" aria-hidden="true">
        👤
      </div>
      <h3>No profiles yet</h3>
      <p>Create a profile to manage multiple Cursor accounts</p>
      <button type="button" className="btn-primary" onClick={onAddProfile}>
        Add Your First Profile
      </button>
    </div>
  );
};
