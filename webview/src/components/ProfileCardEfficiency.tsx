import { useState } from 'react';
import { useL10n } from '../l10n/context';
import type { EfficiencyStats, WorkspaceInfo } from '../types';
import { getEfficiencyFillStatus, getEfficiencyPercentage } from '../types';
import { getRepositoryName } from './profileCardPresentation';
import { QuotaBarRow } from './ProfileCardIndicators';

interface ProfileCardEfficiencyProps {
  enabled: boolean;
  stats?: EfficiencyStats;
  workspaces: WorkspaceInfo[];
}

export function ProfileCardEfficiency({
  enabled,
  stats,
  workspaces,
}: ProfileCardEfficiencyProps) {
  const { t } = useL10n();
  const [repositoriesExpanded, setRepositoriesExpanded] = useState(false);
  const [expandedBranchRepos, setExpandedBranchRepos] = useState<Set<string>>(
    () => new Set()
  );

  if (!enabled) {
    return null;
  }

  if (!stats || stats.totalPrompts === 0) {
    return (
      <div className="efficiency-section">
        <p className="efficiency-empty">{t('profileCard.efficiencyEmpty')}</p>
      </div>
    );
  }

  const toggleBranchExpanded = (repoPath: string) => {
    setExpandedBranchRepos((previous) => {
      const next = new Set(previous);
      if (next.has(repoPath)) {
        next.delete(repoPath);
      } else {
        next.add(repoPath);
      }
      return next;
    });
  };

  const repositoryEntries = Object.entries(stats.byRepository).sort(
    (a, b) => b[1].totalPrompts - a[1].totalPrompts
  );

  return (
    <div className="efficiency-section">
      <div className="efficiency-header">
        <span className="efficiency-title">{t('profileCard.efficiencyTitle')}</span>
        <span className="efficiency-percentage">
          {getEfficiencyPercentage(stats)}%
        </span>
      </div>
      <QuotaBarRow
        percent={getEfficiencyPercentage(stats)}
        fillStatus={getEfficiencyFillStatus(stats)}
      />
      <div className="efficiency-details">
        <span>
          {t('profileCard.efficientPrompts', {
            count: stats.efficientPrompts,
          })}
        </span>
        <span>
          {t('profileCard.totalPrompts', { count: stats.totalPrompts })}
        </span>
      </div>

      {repositoryEntries.length > 0 ? (
        <div className="efficiency-by-repo">
          <button
            type="button"
            className="efficiency-repo-toggle"
            onClick={() => setRepositoriesExpanded((expanded) => !expanded)}
            aria-expanded={repositoriesExpanded}
          >
            <span>
              {t('profileCard.efficiencyByRepository', {
                count: repositoryEntries.length,
              })}
            </span>
            <span className="chevron" aria-hidden="true">
              {repositoriesExpanded ? '▼' : '▶'}
            </span>
          </button>
          {repositoriesExpanded ? (
            <ul className="efficiency-repo-list">
              {repositoryEntries.map(([repoPath, repoStats]) => {
                const repoName = getRepositoryName(repoPath, workspaces);
                const branchEntries = Object.entries(repoStats.byBranch).sort(
                  (a, b) => b[1].totalPrompts - a[1].totalPrompts
                );
                const branchesExpanded = expandedBranchRepos.has(repoPath);

                return (
                  <li key={repoPath} className="efficiency-repo-item">
                    <div className="efficiency-repo-header">
                      <span className="efficiency-repo-name" title={repoPath}>
                        {repoName}
                      </span>
                      <span className="efficiency-repo-percent">
                        {getEfficiencyPercentage(repoStats)}%
                      </span>
                    </div>
                    <div className="efficiency-repo-stats">
                      <span className="efficiency-repo-count">
                        {repoStats.efficientPrompts}/{repoStats.totalPrompts}
                      </span>
                    </div>

                    {branchEntries.length > 0 ? (
                      <div className="efficiency-by-branch">
                        <button
                          type="button"
                          className="efficiency-branch-toggle"
                          onClick={() => toggleBranchExpanded(repoPath)}
                          aria-expanded={branchesExpanded}
                        >
                          <span className="efficiency-branch-label">
                            {t('profileCard.efficiencyByBranch', {
                              count: branchEntries.length,
                            })}
                          </span>
                          <span className="chevron-small" aria-hidden="true">
                            {branchesExpanded ? '▼' : '▶'}
                          </span>
                        </button>
                        {branchesExpanded ? (
                          <ul className="efficiency-branch-list">
                            {branchEntries.map(([branchName, branchStats]) => (
                              <li
                                key={branchName}
                                className="efficiency-branch-item"
                              >
                                <div className="efficiency-branch-header">
                                  <span className="efficiency-branch-name">
                                    {branchName}
                                  </span>
                                  <span className="efficiency-branch-percent">
                                    {getEfficiencyPercentage(branchStats)}%
                                  </span>
                                </div>
                                <div className="efficiency-branch-count">
                                  {branchStats.efficientPrompts}/
                                  {branchStats.totalPrompts}
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
