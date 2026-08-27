import type { QuotaStatus } from '../types';

interface QuotaBarRowProps {
  percent: number;
  label?: string;
  fillStatus?: QuotaStatus;
}

export function QuotaBarRow({
  percent,
  label,
  fillStatus = 'ok',
}: QuotaBarRowProps) {
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <div className={label ? 'quota-bar-row' : undefined}>
      {label ? <span className="quota-bar-label">{label}</span> : null}
      <div className="quota-bar" aria-hidden="true">
        <div
          className={`quota-fill ${fillStatus}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export function QuotaStatusIcons({
  quotaStatus,
  t,
}: {
  quotaStatus: QuotaStatus;
  t: (key: string) => string;
}) {
  return (
    <>
      {quotaStatus === 'warning' && (
        <span className="warning-icon" aria-label={t('profileCard.warning')}>
          ⚠️
        </span>
      )}
      {quotaStatus === 'critical' && (
        <span className="error-icon" aria-label={t('profileCard.critical')}>
          🔴
        </span>
      )}
    </>
  );
}
