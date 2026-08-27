import { useL10n } from '../l10n/context';
import type { ActivityLeaderboardEntry } from '../types';
import { formatCompactNumber } from '../types';

interface ProfileCardLeaderboardProps {
  entries: ActivityLeaderboardEntry[];
  profileEmail: string;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export function ProfileCardLeaderboard({
  entries,
  profileEmail,
  expanded,
  onToggleExpanded,
}: ProfileCardLeaderboardProps) {
  const { t } = useL10n();

  if (entries.length === 0) {
    return null;
  }

  const isInTopActivity = entries.some(
    (entry) => entry.email.toLowerCase() === profileEmail.toLowerCase()
  );

  return (
    <div className="leaderboard-section">
      <button
        type="button"
        className="leaderboard-toggle"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
      >
        <span className="leaderboard-status">
          {isInTopActivity
            ? t('profileCard.topActivity')
            : t('profileCard.notTopActivity')}
        </span>
        <span className="leaderboard-period">
          {t('profileCard.leaderboardPeriod')}
        </span>
        <span className="leaderboard-chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded ? (
        <ol className="leaderboard-list">
          {entries.map((entry) => (
            <li
              key={entry.email}
              className={
                entry.email.toLowerCase() === profileEmail.toLowerCase()
                  ? 'leaderboard-item self'
                  : 'leaderboard-item'
              }
            >
              <span className="rank">#{entry.rank}</span>
              <span className="name">{entry.displayName}</span>
              <span className="metric">
                {formatCompactNumber(entry.composerLinesAccepted)}{' '}
                {t('profileCard.lines')}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
