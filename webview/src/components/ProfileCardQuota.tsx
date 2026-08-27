import { useL10n } from '../l10n/context';
import type { ProfileQuota } from '../types';
import {
  formatEnterpriseUsageLabel,
  formatMonthlySpendLabel,
  formatTeamBudgetLabel,
  getEffectiveUsagePercent,
  getPersonalModeAveragePercent,
  getQuotaStatus,
  hasDistinctTeamBudget,
  isEnterpriseUsage,
} from '../types';
import {
  formatRemainingLabel,
  formatResetDate,
  isAuthError,
} from './profileCardPresentation';
import { QuotaBarRow, QuotaStatusIcons } from './ProfileCardIndicators';

interface ProfileCardQuotaProps {
  quota?: ProfileQuota;
  expanded: boolean;
  onToggleExpanded: () => void;
  onLaunch: () => void;
}

export function ProfileCardQuota({
  quota,
  expanded,
  onToggleExpanded,
  onLaunch,
}: ProfileCardQuotaProps) {
  const { t } = useL10n();

  if (!quota) {
    return null;
  }

  const quotaStatus = quota.quota ? getQuotaStatus(quota.quota) : 'unavailable';

  if (quota.error) {
    return (
      <div className="quota-section">
        {isAuthError(quota.error) ? (
          <div className="quota-auth-required">
            <span className="icon" aria-hidden="true">
              🔒
            </span>
            <span>{quota.error}</span>
            <button type="button" onClick={onLaunch}>
              {t('profileCard.signIn')}
            </button>
          </div>
        ) : (
          <div className="quota-error" role="alert">
            <span className="icon" aria-hidden="true">
              ⚠️
            </span>
            <span>{quota.error}</span>
          </div>
        )}
      </div>
    );
  }

  if (!quota.quota) {
    return (
      <div className="quota-section">
        <div className="quota-unavailable">{t('profileCard.quotaUnavailable')}</div>
      </div>
    );
  }

  const quotaData = quota.quota;
  const isMonthlySpend = quotaData.displayMode === 'monthlySpend';
  const isEnterprise = isEnterpriseUsage(quotaData);
  const isPersonalPercent = !isEnterprise && !isMonthlySpend;
  const usagePercent = getEffectiveUsagePercent(quotaData);

  return (
    <div className="quota-section">
      {isPersonalPercent ? (
        <>
          <button
            type="button"
            className="quota-toggle"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
          >
            <div className="quota-toggle-main">
              <QuotaBarRow
                percent={getPersonalModeAveragePercent(quotaData)}
                fillStatus={quotaStatus}
              />
              <div className="quota-text">
                <span className="percent">
                  {getPersonalModeAveragePercent(quotaData)}%
                </span>
                <span className="label">{t('profileCard.used')}</span>
                <QuotaStatusIcons quotaStatus={quotaStatus} t={t} />
              </div>
            </div>
            <span className="quota-chevron" aria-hidden="true">
              {expanded ? '▾' : '▸'}
            </span>
          </button>
          {expanded ? (
            <div className="quota-bars-expanded">
              <QuotaBarRow
                percent={quotaData.autoPercentUsed}
                label={t('profileCard.autoMode')}
              />
              <QuotaBarRow
                percent={quotaData.apiPercentUsed}
                label={t('profileCard.apiMode')}
              />
            </div>
          ) : null}
          <div className="quota-details">
            <span>{formatRemainingLabel(quotaData, t)}</span>
            <span>
              {t('profileCard.resets', {
                date: formatResetDate(quotaData.billingCycleEnd, t),
              })}
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="quota-bar" aria-hidden="true">
            <div
              className={`quota-fill ${quotaStatus}`}
              style={{
                width: `${Math.min(100, Math.max(0, usagePercent))}%`,
              }}
            />
          </div>
          <div className="quota-text">
            {isEnterprise && isMonthlySpend ? (
              <>
                <span className="percent">{formatEnterpriseUsageLabel(quotaData)}</span>
                <span className="label">{t('profileCard.used')}</span>
              </>
            ) : isMonthlySpend ? (
              <>
                <span className="percent">{formatMonthlySpendLabel(quotaData)}</span>
                <span className="label">{t('profileCard.monthly')}</span>
              </>
            ) : (
              <>
                <span className="percent">
                  {quotaData.totalPercentUsed.toFixed(0)}%
                </span>
                <span className="label">{t('profileCard.used')}</span>
              </>
            )}
            <QuotaStatusIcons quotaStatus={quotaStatus} t={t} />
          </div>
          <div className="quota-details">
            {isEnterprise && isMonthlySpend ? (
              hasDistinctTeamBudget(quotaData) ? (
                <span>
                  {t('profileCard.teamBudgetLabel', {
                    value: formatTeamBudgetLabel(quotaData),
                  })}
                </span>
              ) : null
            ) : isMonthlySpend ? (
              <span>
                {t('profileCard.monthlyLabel', {
                  value: formatMonthlySpendLabel(quotaData),
                })}
              </span>
            ) : (
              <span>{formatRemainingLabel(quotaData, t)}</span>
            )}
            <span>
              {t('profileCard.resets', {
                date: formatResetDate(quotaData.billingCycleEnd, t),
              })}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
